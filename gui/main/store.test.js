import { promises as fs } from 'fs'
import * as os from 'os'
import * as path from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { defaultConfig } from '../../core/index.js'
import { SettingsStore } from './store.js'

const reverse = text => text.split('').reverse().join('')

const keychain = (available = true, { backend = 'keychain', rotated = false } = {}) => ({
	encrypted: 0,
	isAsyncEncryptionAvailable: async () => available,
	getSelectedStorageBackend: () => backend,
	async encryptStringAsync(text) {
		this.encrypted++
		return Buffer.from(reverse(text))
	},
	decryptStringAsync: async buffer => ({ result: reverse(buffer.toString()), shouldReEncrypt: rotated })
})

let root, file

beforeEach(async () => {
	root = await fs.mkdtemp(path.join(os.tmpdir(), 'tracker-store-'))
	file = path.join(root, 'settings.json')
})

afterEach(async () => {
	await fs.rm(root, { recursive: true, force: true })
})

describe('settings store', () => {
	it('loads settings saved before some were renamed', async () => {
		const config = defaultConfig('/media')
		const { token, foldersTable, filesTable, ...airtable } = config.settings.airtable
		config.settings.airtable = { ...airtable, api: token, foldersID: foldersTable, filesID: filesTable }
		await fs.writeFile(file, JSON.stringify({ config }))

		const store = new SettingsStore(file, keychain())
		await store.load()
		expect(store.view().config.settings.airtable).toMatchObject({ foldersTable: 'Folders', filesTable: 'Files' })
		expect(store.view().config.settings.airtable.foldersID).toBeUndefined()
	})

	it('starts blank', async () => {
		const store = new SettingsStore(file, keychain())
		await store.load()
		expect(store.view()).toMatchObject({ hasToken: false, tokenKept: true })
		expect(store.view().config.settings.files.dirs).toEqual([])
	})

	it('refuses a settings file that is not its own, rather than overwrite it', async () => {
		await fs.writeFile(file, JSON.stringify({ settings: {}, premiere: {} }))
		await expect(new SettingsStore(file, keychain()).load()).rejects.toThrow('isn\'t this app\'s settings')
	})

	it('keeps the token encrypted and out of the view', async () => {
		const store = new SettingsStore(file, keychain())
		await store.load()
		await store.save(defaultConfig('/media'), 'secret-token')

		expect(await fs.readFile(file, 'utf8')).not.toContain('secret-token')
		expect(JSON.stringify(store.view())).not.toContain('secret-token')
		expect(store.view().hasToken).toBe(true)

		const reopened = new SettingsStore(file, keychain())
		await reopened.load()
		expect(reopened.full().settings.airtable.token).toBe('secret-token')
	})

	it('keeps the token when saving without a new one', async () => {
		const store = new SettingsStore(file, keychain())
		await store.load()
		await store.save(defaultConfig('/media'), 'secret-token')
		await store.save(defaultConfig('/other'))
		expect(store.full().settings.airtable.token).toBe('secret-token')
	})

	it('moves a token out of an imported config', async () => {
		const config = defaultConfig('/media')
		config.settings.airtable.token = 'imported-token'
		const store = new SettingsStore(file, keychain())
		await store.load()
		await store.save(config)
		expect(await fs.readFile(file, 'utf8')).not.toContain('imported-token')
		expect(store.full().settings.airtable.token).toBe('imported-token')
	})

	it('never stores a token without encryption', async () => {
		const store = new SettingsStore(file, keychain(false))
		await store.load()
		await store.save(defaultConfig('/media'), 'secret-token')
		expect(await fs.readFile(file, 'utf8')).not.toContain('secret-token')
		expect(store.view().tokenKept).toBe(false)
		expect(store.full().settings.airtable.token).toBe('secret-token')
	})

	it('treats Linux without a keyring as having no encryption', async () => {
		const store = new SettingsStore(file, keychain(true, { backend: 'basic_text' }))
		await store.load()
		await store.save(defaultConfig('/media'), 'secret-token')
		expect(store.view().tokenKept).toBe(false)
		expect(JSON.parse(await fs.readFile(file, 'utf8')).secrets).toBeUndefined()
	})

	it('encrypts the token again when the keychain asks', async () => {
		const store = new SettingsStore(file, keychain())
		await store.load()
		await store.save(defaultConfig('/media'), 'secret-token')

		const rotated = keychain(true, { rotated: true })
		const reopened = new SettingsStore(file, rotated)
		await reopened.load()
		expect(rotated.encrypted).toBe(1)
		expect(reopened.full().settings.airtable.token).toBe('secret-token')
	})

	it('keeps sign ins encrypted, saying only who as', async () => {
		const store = new SettingsStore(file, keychain())
		await store.load()
		await store.setSignIn('google', { accessToken: 'secret-access', refreshToken: 'secret-refresh', account: 'someone@example.com' })

		expect(await fs.readFile(file, 'utf8')).not.toContain('secret-')
		expect(store.view().signedIn).toEqual({ google: 'someone@example.com' })
		expect(JSON.stringify(store.view())).not.toContain('secret-')

		const reopened = new SettingsStore(file, keychain())
		await reopened.load()
		expect(reopened.signIns().google.refreshToken).toBe('secret-refresh')

		await reopened.setSignIn('google', undefined)
		expect(reopened.view().signedIn).toEqual({})
	})

	it('remembers whether it was watching', async () => {
		const store = new SettingsStore(file, keychain())
		await store.load()
		expect(store.watching).toBe(false)
		await store.save(defaultConfig('/media'))
		await store.setWatching(true)

		const reopened = new SettingsStore(file, keychain())
		await reopened.load()
		expect(reopened.watching).toBe(true)

		await reopened.setWatching(false)
		const again = new SettingsStore(file, keychain())
		await again.load()
		expect(again.watching).toBe(false)
	})

	it('forgets the token', async () => {
		const store = new SettingsStore(file, keychain())
		await store.load()
		await store.save(defaultConfig('/media'), 'secret-token')
		await store.clearToken()
		expect(store.view().hasToken).toBe(false)

		const reopened = new SettingsStore(file, keychain())
		await reopened.load()
		expect(reopened.view().hasToken).toBe(false)
	})
})

import { promises as fs } from 'fs'
import * as path from 'path'
import { defaultConfig, renameOld } from '../../core/index.js'

/**
 * Keeps the app's config. The Airtable token and the sign ins are held apart
 * from the rest, encrypted by the operating system's keychain, and stay in the
 * main process: the page is only ever told whether there are any.
 */
export class SettingsStore {
	#token = ''
	#signIns = {}
	#config
	#canEncrypt = false

	// whether it was left watching, to carry on when it's next opened
	watching = false

	/**
	 * @param {string} file where it's stored
	 * @param {object} encryption Electron's safeStorage
	 */
	constructor(file, encryption) {
		this.file = file
		this.encryption = encryption
	}

	async load() {
		// Linux without a keyring 'encrypts' with a fixed key, which is no better than plain text
		this.#canEncrypt = await this.encryption.isAsyncEncryptionAvailable()
			&& this.encryption.getSelectedStorageBackend?.() != 'basic_text'
		this.#config = blankConfig()

		let stored
		try {
			stored = JSON.parse(await fs.readFile(this.file, 'utf8'))
		}
		catch(err) {
			if(err.code != 'ENOENT')
				throw err
			return
		}

		if(!stored?.config?.settings?.files)
			throw new Error(`${this.file} isn't this app's settings`)

		this.#config = renameOld(stored.config)
		this.watching = stored.watching === true
		if(!stored.secrets || !this.#canEncrypt)
			return

		const { result, shouldReEncrypt } = await this.encryption.decryptStringAsync(Buffer.from(stored.secrets, 'base64'))
		const secrets = JSON.parse(result)
		this.#token = secrets.token ?? ''
		this.#signIns = secrets.signIns ?? {}
		if(shouldReEncrypt)
			await this.#write()
	}

	/**
	 * @returns {object} .config without the token, .hasToken, .signedIn (who as,
	 * by provider) & .tokenKept, which is false if they won't survive the app closing
	 */
	view() {
		const signedIn = Object.fromEntries(Object.entries(this.#signIns).map(([name, tokens]) => [name, tokens.account || 'you']))
		return {
			config: this.#config,
			hasToken: Boolean(this.#token),
			signedIn,
			tokenKept: this.#canEncrypt
		}
	}

	/**
	 * @returns {object} the sign ins' tokens, by provider
	 */
	signIns() {
		return structuredClone(this.#signIns)
	}

	/**
	 * Keep a sign in's tokens, as it signs in and whenever they change
	 * @param {object} tokens nothing to sign out
	 */
	async setSignIn(name, tokens) {
		if(tokens)
			this.#signIns[name] = tokens
		else
			delete this.#signIns[name]
		await this.#write()
	}

	/**
	 * @returns {object} the config with its token, for connecting
	 */
	full() {
		const config = structuredClone(this.#config)
		config.settings.airtable.token = this.#token
		return config
	}

	/**
	 * @param {object} config
	 * @param {string} token a new token, nothing to keep the one there is
	 */
	async save(config, token) {
		const { token: inConfig, ...airtable } = config.settings.airtable ?? {}
		const newToken = token || inConfig
		if(newToken)
			this.#token = newToken

		this.#config = structuredClone(config)
		this.#config.settings.airtable = { ...airtable, token: '' }
		await this.#write()
	}

	async #write() {
		const stored = { config: this.#config }
		if(this.watching)
			stored.watching = true
		const secrets = { token: this.#token, signIns: this.#signIns }
		if((this.#token || Object.keys(this.#signIns).length) && this.#canEncrypt)
			stored.secrets = (await this.encryption.encryptStringAsync(JSON.stringify(secrets))).toString('base64')

		await fs.mkdir(path.dirname(this.file), { recursive: true })
		await fs.writeFile(this.file, JSON.stringify(stored, null, 2), { mode: 0o600 })
	}

	/**
	 * @param {boolean} watching whether to carry on watching when it's next opened
	 */
	async setWatching(watching) {
		this.watching = watching
		await this.#write()
	}

	async clearToken() {
		this.#token = ''
		await this.#write()
	}
}

function blankConfig() {
	const config = defaultConfig('')
	config.settings.files.dirs = []
	return config
}

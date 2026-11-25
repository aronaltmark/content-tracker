import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AirtableTarget, GoogleSheetsTarget } from './index.js'
import { OAuthSession, canSignIn, chooseSpreadsheet, signIn } from './oauth.js'
import { spreadsheetId } from './config.js'
import { fakeOAuth } from '../e2e/fake-google.mjs'
import { fakeAirtable } from '../e2e/fake-airtable.mjs'

let oauth, airtable, env

// what a browser does with the sign in page: the provider sends it straight back
const browser = url => fetch(url).then(response => response.text())

beforeEach(async () => {
	oauth = await fakeOAuth()
	airtable = await fakeAirtable({ accepts: token => oauth.isValid(token) })
	env = {
		CONTENT_TRACKER_OAUTH_ENDPOINT: oauth.url,
		CONTENT_TRACKER_GOOGLE_CLIENT_ID: 'google-client',
		CONTENT_TRACKER_GOOGLE_CLIENT_SECRET: 'google-secret',
		CONTENT_TRACKER_AIRTABLE_CLIENT_ID: 'airtable-client',
		AIRTABLE_ENDPOINT_URL: airtable.url,
		GOOGLE_SHEETS_ENDPOINT_URL: oauth.url
	}
})

afterEach(async () => {
	await oauth.close()
	await airtable.close()
})

describe('signing in', () => {
	it('signs in with Google, and says who as', async () => {
		const opened = vi.fn(browser)
		const tokens = await signIn('google', { openBrowser: opened, env })
		const url = new URL(opened.mock.calls[0][0])
		// only the spreadsheets it's given, and not what an older version was given
		expect(url.searchParams.get('scope').split(' ')).toEqual(['openid', 'email', 'https://www.googleapis.com/auth/drive.file'])
		expect(url.searchParams.has('include_granted_scopes')).toBe(false)
		expect(oauth.isValid(tokens.accessToken)).toBe(true)
		expect(tokens.refreshToken).toMatch(/^google-refresh/)
		expect(tokens.account).toBe('someone@example.com')
	})

	it('signs in with Airtable on its registered address, and says who as', async () => {
		const opened = vi.fn(browser)
		const tokens = await signIn('airtable', { openBrowser: opened, env })
		const url = new URL(opened.mock.calls[0][0])
		expect(url.searchParams.get('redirect_uri')).toBe('http://localhost:51917/callback')
		expect(url.searchParams.get('scope')).toContain('schema.bases:write')
		expect(tokens.account).toBe('someone@example.com')
	})

	it('says when someone says no', async () => {
		await oauth.close()
		oauth = await fakeOAuth({ deny: true })
		env.CONTENT_TRACKER_OAUTH_ENDPOINT = oauth.url
		await expect(signIn('google', { openBrowser: browser, env })).rejects.toThrow('Google said access_denied')
	})

	it('says when the spreadsheets box was left unticked', async () => {
		await oauth.close()
		oauth = await fakeOAuth({ grant: ['openid', 'email'] })
		env.CONTENT_TRACKER_OAUTH_ENDPOINT = oauth.url
		await expect(signIn('google', { openBrowser: browser, env })).rejects.toThrow('tick the box for them')
	})

	it('signs in when the spreadsheets box was ticked, and with what an older version was given too', async () => {
		await oauth.close()
		oauth = await fakeOAuth({ grant: ['openid', 'email', 'https://www.googleapis.com/auth/drive.file', 'https://www.googleapis.com/auth/spreadsheets'] })
		env.CONTENT_TRACKER_OAUTH_ENDPOINT = oauth.url
		expect((await signIn('google', { openBrowser: browser, env })).account).toBe('someone@example.com')
	})

	it('ignores an answer it did not ask for', async () => {
		const forged = url => {
			const back = new URL(new URL(url).searchParams.get('redirect_uri'))
			back.search = '?code=stolen&state=wrong'
			return fetch(back)
		}
		await expect(signIn('google', { openBrowser: forged, env })).rejects.toThrow('expired')
	})

	it('gives up after a while', async () => {
		await expect(signIn('google', { openBrowser: () => {}, env, timeout: 50 })).rejects.toThrow('took too long')
	})

	it('signs in with the registrations this build has, with nothing set', () => {
		expect(canSignIn('google', {})).toBe(true)
		expect(canSignIn('airtable', {})).toBe(true)
		expect(() => canSignIn('dropbox', {})).toThrow('no signing in with dropbox')
	})
})

describe('sessions', () => {
	it('refreshes a token that has run out, and passes on the new ones', async () => {
		const tokens = await signIn('airtable', { openBrowser: browser, env })
		const onChange = vi.fn()
		const session = new OAuthSession('airtable', { ...tokens, expiresAt: 0 }, { onChange, env })

		const [first, second] = await Promise.all([session.accessToken(), session.accessToken()])

		expect(first).toBe(second)
		expect(oauth.refreshes).toBe(1)
		// Airtable's refresh tokens only work once, so the new one has to be kept
		expect(onChange.mock.calls[0][0].refreshToken).not.toBe(tokens.refreshToken)
		expect(onChange.mock.calls[0][0].account).toBe('someone@example.com')
	})

	it('keeps Google\'s refresh token, which does not change', async () => {
		const tokens = await signIn('google', { openBrowser: browser, env })
		const session = new OAuthSession('google', { ...tokens, expiresAt: 0 }, { env })
		await session.accessToken()
		expect(session.tokens.refreshToken).toBe(tokens.refreshToken)
	})

	it('says to sign in again once the sign in has been taken away', async () => {
		const session = new OAuthSession('google', { accessToken: 'x', refreshToken: 'revoked', expiresAt: 0 }, { env })
		await expect(session.accessToken()).rejects.toThrow('Signed out of Google - sign in again')
	})
})

describe('targets signed in', () => {
	const files = { mediaMetadata: false }

	it('Airtable lists the bases to choose from and refreshes a token it\'s told is no good', async () => {
		const tokens = await signIn('airtable', { openBrowser: browser, env })
		const session = new OAuthSession('airtable', tokens, { env })
		const target = new AirtableTarget({ base: 'appTest', foldersTable: 'Folders', filesTable: 'Files', view: '' }, { ...files, session, env, wait: async () => {} })

		oauth.expire()
		expect(await target.bases()).toEqual([{ id: 'appTest', name: 'Show content' }])
		expect(oauth.refreshes).toBe(1)
		expect(await target.name()).toBe('Show content')
	})

	it('Google Sheets works with a sign in, from the spreadsheet\'s link', async () => {
		const tokens = await signIn('google', { openBrowser: browser, env })
		const session = new OAuthSession('google', tokens, { env })
		const link = 'https://docs.google.com/spreadsheets/d/1aBc-d_E/edit#gid=0'
		const settings = { spreadsheetId: spreadsheetId(link), foldersSheet: 'Folders', filesSheet: 'Files' }
		const target = new GoogleSheetsTarget(settings, { ...files, session, env, wait: async () => {} })

		await target.prepare()
		await target.apply('files', { inserts: [{ _path: '/a' }], updates: [], deletes: [] })

		expect(settings.spreadsheetId).toBe('1aBc-d_E')
		expect((await target.fetch('files'))[0].fields._path).toBe('/a')
		expect(await target.name()).toBe('Shots')
	})

	it('Google Sheets says to choose a spreadsheet it hasn\'t been given, and opens it once it has', async () => {
		await oauth.close()
		oauth = await fakeOAuth({ onlyPicked: true })
		env.CONTENT_TRACKER_OAUTH_ENDPOINT = env.GOOGLE_SHEETS_ENDPOINT_URL = oauth.url
		const session = new OAuthSession('google', await signIn('google', { openBrowser: browser, env }), { env })
		const settings = { spreadsheetId: 'never-picked-1234', foldersSheet: 'Folders', filesSheet: 'Files' }
		const target = () => new GoogleSheetsTarget(settings, { ...files, session, env, wait: async () => {} })

		await expect(target().prepare()).rejects.toThrow('choose it with Choose from Drive')

		const { id } = await chooseSpreadsheet({ openBrowser: browser, env: { ...env, CONTENT_TRACKER_PICKER_URL: `${oauth.url}/google/picker` } })
		settings.spreadsheetId = id
		await target().prepare()
		expect(oauth.sheets.rows('Files')[0][0]).toBe('_path')
	})

	it('prefers a token or key to a sign in', () => {
		const session = new OAuthSession('airtable', {}, { env })
		const target = new AirtableTarget({ token: 'pat', base: 'appTest', foldersTable: 'F', filesTable: 'G' }, { session, env: {} })
		expect(target.session).toBeUndefined()
	})
})

describe('choosing a spreadsheet', () => {
	const picker = () => ({ ...env, CONTENT_TRACKER_PICKER_URL: `${oauth.url}/google/picker` })

	it('opens the picker for who is signed in, and takes back what was chosen', async () => {
		const page = vi.fn(url => fetch(url).then(response => response.text()))
		expect(await chooseSpreadsheet({ openBrowser: page, account: 'someone@example.com', env: picker() }))
			.toEqual({ id: 'picked-sheet-1234', name: 'Shots' })
		const [opened] = oauth.pickers
		expect(opened.login_hint).toBe('someone@example.com')
		expect(new URL(opened.return)).toMatchObject({ protocol: 'http:', hostname: '127.0.0.1', pathname: '/picked' })
		expect(await page.mock.results[0].value).toContain('Selected Shots')
	})

	it('opens the store\'s page, unless told otherwise', async () => {
		const opened = vi.fn(url => fetch(new URL(url).searchParams.get('return') + '?cancelled=1&state=' + new URL(url).searchParams.get('state')))
		await chooseSpreadsheet({ openBrowser: opened, env: {} })
		expect(opened.mock.calls[0][0]).toMatch(/^https:\/\/store\.generativenoise\.com\/tools\/content-tracker\/choose-spreadsheet\/\?return=/)
	})

	it('says nothing was chosen when the picker was closed', async () => {
		await oauth.close()
		oauth = await fakeOAuth({ pick: null })
		expect(await chooseSpreadsheet({ openBrowser: browser, env: picker() })).toBeNull()
	})

	it('ignores a choice it did not ask for, or that is not a spreadsheet', async () => {
		const back = (url, search) => fetch(new URL(url).searchParams.get('return') + search(new URL(url).searchParams.get('state')))
		await expect(chooseSpreadsheet({ openBrowser: url => back(url, () => '?id=someone-elses-1234&state=wrong'), env: picker() })).rejects.toThrow('expired')
		await expect(chooseSpreadsheet({ openBrowser: url => back(url, state => `?id=${encodeURIComponent('../../evil')}&state=${state}`), env: picker() })).rejects.toThrow('isn\'t a spreadsheet')
	})

	it('shows the name it was given as text, never as part of the page', async () => {
		await oauth.close()
		oauth = await fakeOAuth({ pick: { id: 'picked-sheet-1234', name: '<script>alert(1)</script>' } })
		const page = vi.fn(url => fetch(url).then(response => response.text()))
		await chooseSpreadsheet({ openBrowser: page, env: picker() })
		const html = await page.mock.results[0].value
		expect(html).not.toContain('<script>')
		expect(html).toContain('&#60;script&#62;')
	})

	it('gives up after a while', async () => {
		await expect(chooseSpreadsheet({ openBrowser: () => {}, env: picker(), timeout: 50 })).rejects.toThrow('took too long')
	})
})

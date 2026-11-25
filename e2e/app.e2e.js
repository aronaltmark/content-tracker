import { _electron as electron, expect, test } from '@playwright/test'
import { promises as fs } from 'fs'
import * as os from 'os'
import * as path from 'path'
import { fakeAirtable } from './fake-airtable.mjs'
import { fakeOAuth } from './fake-google.mjs'
import { fakeReleases } from './fake-releases.mjs'

let root, airtable, oauth, app, page

// an editor sets ELECTRON_RUN_AS_NODE, which makes Electron plain Node: it's left out, as
// Windows counts it as set even when it's empty
// eslint-disable-next-line no-unused-vars
const withoutRunAsNode = ({ ELECTRON_RUN_AS_NODE, ...env }) => env

const openApp = async (env = {}) => {
	app = await electron.launch({
		args: ['.', '--use-mock-keychain'],
		env: {
			...withoutRunAsNode(process.env),
			AIRTABLE_ENDPOINT_URL: airtable.url,
			AIRTABLE_API_KEY: '',
			GOOGLE_SHEETS_ENDPOINT_URL: oauth.url,
			GOOGLE_APPLICATION_CREDENTIALS: '',
			CONTENT_TRACKER_OAUTH_ENDPOINT: oauth.url,
			CONTENT_TRACKER_PICKER_URL: `${oauth.url}/google/picker`,
			CONTENT_TRACKER_GOOGLE_CLIENT_ID: 'google-client',
			CONTENT_TRACKER_GOOGLE_CLIENT_SECRET: 'google-secret',
			CONTENT_TRACKER_AIRTABLE_CLIENT_ID: 'airtable-client',
			CONTENT_TRACKER_USER_DATA: path.join(root, 'data'),
			HOME: root,
			LOCALAPPDATA: root,
			// Playwright keeps sign ins in plain text, which the app won't keep them in
			CONTENT_TRACKER_PASSWORD_STORE: process.platform == 'linux' ? 'gnome-libsecret' : '',
			...env
		}
	})
	page = await app.firstWindow()
}

const pickFolder = folder => app.evaluate(({ dialog }, folder) => {
	dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] })
}, folder)

// the browser the sign in opens: the stand-in sends it straight back to the app
const browser = () => app.evaluate(({ shell }) => {
	shell.openExternal = async url => {
		await fetch(url)
	}
})

// settings save themselves a moment after they're changed
const saved = () => expect(page.getByTestId('saved')).toBeVisible()

async function setUp() {
	await pickFolder(path.join(root, 'media'))
	await page.getByTestId('add-folder').click()
	await page.getByText('Or use a token').click()
	await page.getByTestId('token').fill('test-token')
	await page.getByTestId('token').press('Tab')
	await page.getByTestId('base').fill('appTest')
	await saved()
}

test.use({ testIdAttribute: 'data-test' })

test.beforeEach(async () => {
	root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'tracker-app-')))
	await fs.mkdir(path.join(root, 'media/shots'), { recursive: true })
	await fs.writeFile(path.join(root, 'media/shots/notes.txt'), 'hello')
	oauth = await fakeOAuth()
	airtable = await fakeAirtable({ accepts: token => oauth.isValid(token) })
	await openApp()
})

test.afterEach(async () => {
	await app.close()
	await airtable.close()
	await oauth.close()
	await fs.rm(root, { recursive: true, force: true })
})

test('starts on the settings with nothing to run', async () => {
	await expect(page.getByLabel('Base ID')).toBeVisible()
	await expect(page.getByRole('button', { name: 'Run once' })).toBeDisabled()
})

test('opens on the settings until it can reach the tables, and shows why a run failed', async () => {
	await setUp()
	await page.getByRole('button', { name: 'Forget token' }).click()
	await app.close()
	await openApp()
	await expect(page.getByTestId('sign-in-airtable')).toBeVisible()
	await expect(page.getByLabel('Base ID')).toBeHidden()

	await page.getByRole('button', { name: 'Dry run' }).click()
	await expect(page.getByRole('button', { name: 'Activity' })).toHaveClass('active')
	await expect(page.getByTestId('result')).toContainText('Not signed in to Airtable')
})

test('sets up, tries a dry run, then updates the tracker', async () => {
	await setUp()

	// a dry run ends on what it found, and a run on how it went
	await page.getByRole('button', { name: 'Dry run' }).click()
	await expect(page.getByTestId('tracked')).toBeVisible()
	await page.getByRole('button', { name: 'Activity' }).click()
	await expect(page.getByTestId('result')).toContainText('Nothing was changed')
	await expect(page.getByTestId('files')).toHaveText('1 added, 0 updated, 0 removed')
	expect(airtable.tables).toEqual([])

	await page.getByRole('button', { name: 'Settings' }).click()
	await page.getByRole('button', { name: 'Run once' }).click()
	await expect(page.getByTestId('result')).toContainText('Last run at')
	expect(airtable.records('Files')[0].fields._path).toBe('/shots/notes.txt')
	await expect(page.getByTestId('status')).toHaveText('Stopped')
})

test('watches until stopped', async () => {
	await setUp()

	await page.getByRole('button', { name: 'Start watching' }).click()
	await expect(page.getByTestId('status')).toHaveText('Watching')
	await expect(page.getByTestId('files')).toHaveText('1 added, 0 updated, 0 removed')
	// and it shows how long until it looks again
	await expect(page.getByTestId('countdown')).toBeAttached()
	await expect(page.getByTestId('stop-watching')).toHaveAttribute('title', /^Scanning again in \d+/)

	await page.getByRole('button', { name: 'Stop watching' }).click()
	await expect(page.getByTestId('status')).toHaveText('Stopped')
})

test('keeps running in the menu bar, and carries on watching when next opened', async () => {
	await setUp()
	await page.getByRole('button', { name: 'Activity' }).click()
	await page.getByRole('button', { name: 'Start watching' }).click()
	await expect(page.getByTestId('status')).toHaveText('Watching')

	await app.evaluate(({ BrowserWindow }) => new Promise(closed => {
		const [window] = BrowserWindow.getAllWindows()
		window.once('closed', closed)
		window.close()
	}))
	expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(0)
	expect(await app.evaluate(({ app }) => app.isReady())).toBe(true)

	await app.close()
	await openApp()
	await page.getByRole('button', { name: 'Activity' }).click()
	await expect(page.getByTestId('status')).toHaveText('Watching')
})

test('says when there is a newer version, and never installs a download that isn\'t it', async () => {
	const releases = await fakeReleases({ tampered: true })
	try {
		await app.close()
		await openApp({ CONTENT_TRACKER_GITHUB_ENDPOINT: releases.url, CONTENT_TRACKER_NO_UPDATE_CHECK: '', CI: '' })

		await expect(page.getByTestId('update')).toContainText('Version 99.0.0 is out.')
		await page.getByRole('button', { name: 'Update and restart' }).click()
		await expect(page.getByTestId('failure')).toHaveText('The download didn\'t match the release, so it wasn\'t installed.')
		expect(releases.downloads).toHaveLength(1)
		expect(await app.evaluate(({ app }) => app.isReady())).toBe(true)
	}
	finally {
		await releases.close()
	}
})

test('has help, and says what it\'s built with, opening links in the browser', async () => {
	await page.getByRole('button', { name: 'Help' }).click()
	await expect(page.getByTestId('help')).toContainText('Dry run')

	await page.getByRole('button', { name: 'About' }).click()
	await page.getByText('Open source libraries').click()
	await expect(page.getByTestId('licences')).toContainText('picomatch')
	await expect(page.getByTestId('licences')).toContainText('electron')

	await app.evaluate(({ shell }) => {
		globalThis.opened = []
		shell.openExternal = async url => globalThis.opened.push(url)
	})
	await page.getByRole('link', { name: 'Source code' }).click()
	await expect.poll(() => app.evaluate(() => globalThis.opened)).toEqual(['https://github.com/garethnunns/content-tracker'])
	expect(page.url()).toMatch(/^(file|http):/)
})

test('shows why a run failed', async () => {
	await setUp()
	await page.getByTestId('token').fill('wrong-token')
	await page.getByTestId('token').press('Tab')
	await saved()
	await page.getByRole('button', { name: 'Activity' }).click()
	await page.getByRole('button', { name: 'Run once' }).click()
	await expect(page.getByTestId('result')).toContainText('Airtable said 401')
})

test('keeps the token out of the page and the settings file', async () => {
	await setUp()

	const stored = await fs.readFile(path.join(root, 'data/settings.json'), 'utf8')
	expect(stored).not.toContain('test-token')

	const view = await page.evaluate(() => window.tracker.getConfig())
	expect(JSON.stringify(view)).not.toContain('test-token')
	expect(view.hasToken).toBe(true)

	await app.close()
	await openApp()

	// and it's still there next time
	await page.getByRole('button', { name: 'Run once' }).click()
	await expect(page.getByTestId('result')).toContainText('Last run at')
})

test('gives the page no way out', async () => {
	const reached = await page.evaluate(() => ({
		require: typeof require,
		process: typeof process,
		ipc: typeof window.ipcRenderer,
		api: Object.keys(window.tracker)
	}))
	expect(reached).toMatchObject({ require: 'undefined', process: 'undefined', ipc: 'undefined' })
	expect(reached.api).not.toContain('invoke')

	const policy = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content')
	expect(policy).toContain("connect-src 'none'")

	await page.evaluate(() => window.location.href = 'https://example.com')
	await page.waitForTimeout(200)
	expect(page.url()).toContain('index.html')
	expect(await page.evaluate(() => window.open('https://example.com'))).toBeNull()
})

test('imports a config from an older version, with its old setting names', async () => {
	const config = path.join(root, 'old-config.json')
	await fs.writeFile(config, JSON.stringify({
		settings: {
			files: { rootPath: path.join(root, 'media'), dirs: [path.join(root, 'media')] },
			airtable: { api: 'test-token', base: 'appTest', foldersID: 'Folders', filesID: 'Files', view: '' }
		}
	}))
	await pickFolder(config)

	await page.getByRole('button', { name: 'Import settings' }).click()
	await expect(page.getByTestId('saved')).toBeVisible()
	await expect(page.getByTestId('problems')).toBeHidden()
	expect(await fs.readFile(path.join(root, 'data/settings.json'), 'utf8')).not.toContain('test-token')

	await page.getByRole('button', { name: 'Activity' }).click()
	await page.getByRole('button', { name: 'Run once' }).click()
	await expect(page.getByTestId('result')).toContainText('Last run at')
	expect(airtable.records('Files')[0].fields._path).toBe('/shots/notes.txt')
})

test('imports a config from the command line version, keeping its token safe', async () => {
	const config = path.join(root, 'config.json')
	await fs.writeFile(config, JSON.stringify({
		settings: {
			files: {
				dirs: [path.join(root, 'media')],
				frequency: 60,
				rules: { dirs: { includes: [], excludes: [] }, files: { includes: [], excludes: [] } },
				mediaMetadata: true,
				limitToFirstFile: false,
				concurrency: 2
			},
			airtable: { token: 'test-token', base: 'appTest', foldersTable: 'Folders', filesTable: 'Files', view: '' }
		}
	}))
	await pickFolder(config)

	await page.getByRole('button', { name: 'Import settings' }).click()
	await expect(page.getByTestId('folders')).toContainText('media')
	await expect(page.getByTestId('saved')).toBeVisible()
	expect(await fs.readFile(path.join(root, 'data/settings.json'), 'utf8')).not.toContain('test-token')
})

test('switches to Google Sheets and says what it needs', async () => {
	await page.getByRole('radio', { name: 'Google Sheets' }).click()
	await expect(page.getByTestId('problems')).toContainText('settings.googleSheets.spreadsheetId is missing')
})

test('shows the release notes from the version', async () => {
	const version = JSON.parse(await fs.readFile('package.json', 'utf8')).version
	await page.getByTestId('version').click()
	const notes = page.getByTestId('release-notes')
	await expect(notes).toBeVisible()
	await expect(notes.getByRole('heading', { name: version, exact: true })).toBeVisible()
	await expect(notes.getByRole('heading', { name: 'New', exact: true })).toBeVisible()
	await page.keyboard.press('Escape')
	await expect(notes).toBeHidden()
})

test('keeps the settings\' buttons in the same place however far the settings are scrolled', async () => {
	const save = page.getByRole('button', { name: 'Import settings' })
	const before = await save.boundingBox()
	await page.locator('.fields').evaluate(fields => fields.scrollTo(0, fields.scrollHeight))
	expect(await save.boundingBox()).toEqual(before)
})

test('signs in with Airtable, chooses a base and tracks in it', async () => {
	await pickFolder(path.join(root, 'media'))
	await page.getByTestId('add-folder').click()
	await browser()

	await page.getByTestId('sign-in-airtable').click()
	await expect(page.getByTestId('airtable-account')).toHaveText('Signed in as someone@example.com')

	await page.getByTestId('choose-base').click()
	await page.getByTestId('bases').getByRole('button', { name: 'Show content' }).click()
	await expect(page.getByTestId('base')).toHaveValue('appTest')
	// the list goes back up once one's chosen
	await expect(page.getByTestId('bases')).toBeHidden()
	await saved()

	await page.getByRole('button', { name: 'Activity' }).click()
	await page.getByRole('button', { name: 'Run once' }).click()
	await expect(page.getByTestId('result')).toContainText('Last run at')
	expect(airtable.records('Files')[0].fields._path).toBe('/shots/notes.txt')
})

test('asks again when the browser\'s tab was closed, or stops waiting when cancelled', async () => {
	await pickFolder(path.join(root, 'media'))
	await page.getByTestId('add-folder').click()
	await page.getByRole('radio', { name: 'Google Sheets' }).click()
	await browser()
	await page.getByTestId('sign-in-google').click()
	await expect(page.getByTestId('google-account')).toHaveText('Signed in as someone@example.com')

	// a tab that's closed: nothing ever comes back
	await app.evaluate(({ shell }) => {
		shell.openExternal = async () => {}
	})
	await page.getByTestId('choose-spreadsheet').click()
	await expect(page.getByTestId('cancel-browser')).toBeVisible()
	await expect(page.getByTestId('choose-spreadsheet')).toBeEnabled()
	await page.getByTestId('cancel-browser').click()
	await expect(page.getByTestId('cancel-browser')).toBeHidden()

	// or it's just asked again, which stops the wait before
	await page.getByTestId('choose-spreadsheet').click()
	await expect(page.getByTestId('cancel-browser')).toBeVisible()
	await browser()
	await page.getByTestId('choose-spreadsheet').click()
	await expect(page.getByTestId('spreadsheet')).toHaveValue('picked-sheet-1234')
	await expect(page.getByTestId('auth-error')).toHaveCount(0)
})

test('resets everything, once it\'s sure', async () => {
	await setUp()
	await page.getByTestId('reset').click()
	await expect(page.getByTestId('reset')).toHaveText('Sure? This signs you out too')
	await page.getByTestId('reset').click()
	await expect(page.getByTestId('reset')).toHaveText('Reset settings')
	await expect(page.getByTestId('folders')).toHaveCount(0)
	await expect(page.getByRole('button', { name: 'Run once' })).toBeDisabled()

	const stored = JSON.parse(await fs.readFile(path.join(root, 'data/settings.json'), 'utf8'))
	expect(stored.config.settings.files.dirs).toEqual([])
	expect(stored.secrets).toBeUndefined()
})

test('chooses the spreadsheet from Google Drive once signed in', async () => {
	await pickFolder(path.join(root, 'media'))
	await page.getByTestId('add-folder').click()
	await page.getByRole('radio', { name: 'Google Sheets' }).click()
	await expect(page.getByTestId('choose-spreadsheet')).toBeDisabled()

	await browser()
	await page.getByTestId('sign-in-google').click()
	await page.getByTestId('choose-spreadsheet').click()
	await expect(page.getByTestId('chosen-spreadsheet')).toHaveText('Shots')
	await expect(page.getByTestId('spreadsheet')).toHaveValue('picked-sheet-1234')
	expect(oauth.pickers.at(-1).login_hint).toBe('someone@example.com')
	await saved()
	expect(JSON.parse(await fs.readFile(path.join(root, 'data/settings.json'), 'utf8')).config.settings.googleSheets.spreadsheetId).toBe('picked-sheet-1234')
})

test('makes a new spreadsheet, named after the project, and tracks in it', async () => {
	await pickFolder(path.join(root, 'media'))
	await page.getByTestId('add-folder').click()
	await page.getByRole('radio', { name: 'Google Sheets' }).click()
	await expect(page.getByTestId('create-spreadsheet')).toBeDisabled()

	await browser()
	await page.getByTestId('sign-in-google').click()
	// signing in is the first step done, so it folds away
	await expect(page.getByTestId('sign-in-google')).toBeHidden()
	await page.getByTestId('create-spreadsheet').click()
	await expect(page.getByTestId('step-tables')).toContainText('media - Content Tracker')
	expect(oauth.created).toEqual([{ id: expect.stringMatching(/^made-sheet-/), title: 'media - Content Tracker', sheets: ['Folders', 'Files'] }])
	await expect(page.getByTestId('spreadsheet')).toHaveValue(oauth.created[0].id)
	await saved()

	await page.getByRole('button', { name: 'Run once' }).click()
	await expect(page.getByTestId('result')).toContainText('Last run at')
	expect(oauth.sheets.rows('Files').map(row => row[0])).toEqual(['_path', '/shots/notes.txt'])
})

test('shows a tracked folder in the Finder or Explorer, and only a tracked one', async () => {
	await setUp()
	await app.evaluate(({ shell }) => {
		globalThis.shown = []
		shell.openPath = async dir => {
			globalThis.shown.push(dir)
			return ''
		}
	})
	await page.getByTestId('folders').getByRole('button', { name: /^Show/ }).click()
	await expect.poll(() => app.evaluate(() => globalThis.shown)).toEqual([path.join(root, 'media')])

	await expect(page.evaluate(() => window.tracker.showFolder('/'))).rejects.toThrow('Not allowed')
	expect(await app.evaluate(() => globalThis.shown)).toHaveLength(1)
})

test('signs in with Google and tracks in a spreadsheet from its link, still signed in next time', async () => {
	await pickFolder(path.join(root, 'media'))
	await page.getByTestId('add-folder').click()
	await page.getByRole('radio', { name: 'Google Sheets' }).click()
	await browser()

	await page.getByTestId('sign-in-google').click()
	await expect(page.getByTestId('google-account')).toHaveText('Signed in as someone@example.com')
	await page.getByTestId('spreadsheet').fill('https://docs.google.com/spreadsheets/d/abc123/edit#gid=0')
	await saved()

	const stored = await fs.readFile(path.join(root, 'data/settings.json'), 'utf8')
	expect(stored).not.toContain('google-refresh')
	expect(stored).not.toContain('google-access')

	await app.close()
	await openApp()

	// the spreadsheet by its name, not its ID
	await page.getByRole('button', { name: 'Settings' }).click()
	await expect(page.getByTestId('step-tables')).toContainText('Shots')
	await page.getByRole('button', { name: 'Activity' }).click()

	// and it refreshes the sign in once it's run out
	oauth.expire()
	await page.getByRole('button', { name: 'Run once' }).click()
	await expect(page.getByTestId('result')).toContainText('Last run at')
	expect(oauth.refreshes).toBe(1)
	expect(oauth.sheets.rows('Files').map(row => row[0])).toEqual(['_path', '/shots/notes.txt'])
})

test('says when a sign in was turned down', async () => {
	await oauth.close()
	oauth = await fakeOAuth({ deny: true })
	await app.close()
	await openApp()
	await page.getByRole('radio', { name: 'Google Sheets' }).click()
	await browser()

	await page.getByTestId('sign-in-google').click()
	await expect(page.getByTestId('auth-error')).toHaveText('Google said access_denied.')
	await expect(page.getByTestId('sign-in-google')).toBeEnabled()
})

test('keeps the records of files that have gone, when told to', async () => {
	await setUp()
	await page.getByTestId('removing').uncheck()
	await expect(page.getByTestId('confirm-removing')).toBeDisabled()
	await saved()
	await page.getByRole('button', { name: 'Activity' }).click()
	await page.getByRole('button', { name: 'Run once' }).click()
	await expect(page.getByTestId('files')).toHaveText('1 added, 0 updated, 0 removed')

	await fs.rm(path.join(root, 'media/shots/notes.txt'))
	await page.getByRole('button', { name: 'Run once' }).click()
	await expect(page.getByTestId('files')).toHaveText('0 added, 0 updated, 0 removed')
	expect(airtable.records('Files')).toHaveLength(1)
})

test('clears the media cache', async () => {
	await setUp()
	await page.getByRole('button', { name: 'Activity' }).click()
	await page.getByRole('button', { name: 'Run once' }).click()
	await expect(page.getByTestId('result')).toContainText('Last run at')

	// it's kept in the user's cache folder, which the tests put under root: on Windows in a Cache folder of its own
	const caches = async () => (await fs.readdir(root, { recursive: true })).filter(file => /content-tracker[\\/](Cache[\\/])?[0-9a-f]{16}\.json$/.test(file))
	expect(await caches()).toHaveLength(1)

	await page.getByRole('button', { name: 'Settings' }).click()
	// done, so folded away
	await page.getByTestId('step-files').getByRole('button', { name: 'Files' }).click()
	await page.getByTestId('step-files').getByText('More options').click()
	await page.getByTestId('wipe-cache').click()
	await expect(page.getByTestId('cache-message')).toHaveText('Cleared')
	expect(await caches()).toEqual([])

	// and it's left open, coming back to the settings
	await page.getByRole('button', { name: 'Activity' }).click()
	await page.getByRole('button', { name: 'Settings' }).click()
	await expect(page.getByTestId('track-folders')).toBeVisible()
})

test('exports the settings as a config, without the token', async () => {
	await setUp()
	const file = path.join(root, 'exported.json')
	await app.evaluate(({ dialog }, file) => {
		dialog.showSaveDialog = async () => ({ canceled: false, filePath: file })
	}, file)

	await page.getByTestId('export').click()
	await expect.poll(() => fs.readFile(file, 'utf8').catch(() => '')).toContain('appTest')

	const exported = JSON.parse(await fs.readFile(file, 'utf8'))
	expect(exported.$schema).toContain('config.schema.json')
	expect(exported.settings.files.dirs).toEqual([path.join(root, 'media')])
	expect(JSON.stringify(exported)).not.toContain('test-token')
})

test('saves a change without being asked, and keeps it next time', async () => {
	await setUp()
	await page.getByTestId('track-folders').uncheck()
	await saved()
	await app.close()
	await openApp()
	await page.getByRole('button', { name: 'Settings' }).click()
	await expect(page.getByTestId('track-folders')).not.toBeChecked()
})

test('lists what a dry run would do, and excludes from the list', async () => {
	await setUp()
	await fs.writeFile(path.join(root, 'media/shots/clip.mov'), 'not really a clip')
	await page.getByRole('button', { name: 'Activity' }).click()
	await page.getByRole('button', { name: 'Run once' }).click()
	await expect(page.getByTestId('result')).toContainText('Last run at')
	await fs.writeFile(path.join(root, 'media/shots/notes.txt'), 'changed')
	await fs.writeFile(path.join(root, 'media/shots/new.txt'), 'new')

	await page.getByRole('button', { name: 'Dry run' }).click()

	const list = page.getByTestId('tracked')
	const row = path => list.getByRole('row').filter({ has: page.getByRole('cell', { name: path, exact: true }) })
	await expect(row('/shots/new.txt')).toHaveClass('new')
	await expect(row('/shots/notes.txt')).toHaveClass('modified')
	await expect(row('/shots/clip.mov')).toHaveClass('same')
	await expect(row('/shots/new.txt').getByRole('cell').nth(1)).toHaveText('3 bytes')

	// only the new ones, then everything again
	await page.getByTestId('only-new').click()
	await expect(list.locator('td.path')).toHaveText(['/shots/new.txt'])
	await page.getByTestId('only-new').click()
	await expect(row('/shots/clip.mov')).toBeVisible()

	await row('/shots/clip.mov').click({ button: 'right' })
	await page.getByTestId('exclude-menu').getByRole('menuitem', { name: 'Exclude every .mov file' }).click()
	await expect(page.getByTestId('excluded')).toContainText('*.mov')

	// half the table going, so it asks first
	await app.evaluate(({ dialog }) => {
		dialog.showMessageBox = async () => ({ response: 1 })
	})
	await page.getByRole('button', { name: 'Activity' }).click()
	await page.getByRole('button', { name: 'Run once' }).click()
	await expect(page.getByTestId('files')).toContainText('1 removed')
	expect(airtable.records('Files').map(record => record.fields._path).sort()).toEqual(['/shots/new.txt', '/shots/notes.txt'])
})

test('tracks only the files, with folders turned off', async () => {
	await setUp()
	await page.getByTestId('track-folders').uncheck()
	await saved()
	await page.getByRole('button', { name: 'Activity' }).click()
	await page.getByRole('button', { name: 'Run once' }).click()
	await expect(page.getByTestId('result')).toContainText('Last run at')
	expect(airtable.tables.map(table => table.name)).toEqual(['Files'])
	expect(airtable.records('Files')[0].fields).not.toHaveProperty('_parent')
})

test('sorts what it tracked, and a click opens the menu', async () => {
	await setUp()
	await fs.writeFile(path.join(root, 'media/shots/big.mov'), 'x'.repeat(5000))
	await page.getByRole('button', { name: 'Activity' }).click()
	await page.getByRole('button', { name: 'Run once' }).click()
	await expect(page.getByTestId('result')).toContainText('Last run at')
	await page.getByRole('button', { name: 'Tracked' }).click()

	const paths = () => page.getByTestId('tracked').locator('td.path').allTextContents()
	expect(await paths()).toEqual(['/shots/big.mov', '/shots/notes.txt'])

	// biggest first, then smallest
	await page.getByTestId('sort-size').click()
	expect(await paths()).toEqual(['/shots/big.mov', '/shots/notes.txt'])
	await page.getByTestId('sort-size').click()
	expect(await paths()).toEqual(['/shots/notes.txt', '/shots/big.mov'])
	await expect(page.getByRole('columnheader', { name: /Size/ })).toHaveAttribute('aria-sort', 'ascending')
	await expect(page.getByRole('columnheader', { name: /Found/ })).toBeVisible()

	await page.getByTestId('tracked').getByRole('cell', { name: '/shots/notes.txt', exact: true }).click()
	await expect(page.getByTestId('exclude-menu').locator('.subject').first()).toHaveText('notes.txt')
	await page.keyboard.press('Escape')
	await expect(page.getByTestId('exclude-menu')).toBeHidden()
})

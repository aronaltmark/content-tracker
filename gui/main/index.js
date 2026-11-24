import { app, BrowserWindow, dialog, ipcMain, safeStorage, session, shell } from 'electron'
import { promises as fs } from 'fs'
import * as path from 'path'
import { AirtableTarget, MetadataCache, OAuthSession, SCHEMA_URL, cacheFile, canSignIn, configProblems, renameOld, signIn } from '../../core/index.js'
import { MenuBar } from './menu-bar.js'
import { SettingsStore } from './store.js'
import { TrackerController } from './tracker.js'
import { Updater } from './updater.js'

// a folder of its own: the product name alone is shared with an older app of the same name,
// and the browser tests keep away from the real settings
app.setPath('userData', process.env.CONTENT_TRACKER_USER_DATA ?? path.join(app.getPath('appData'), 'com.garethnunns.content-tracker'))

// it's already running, in the menu bar: that one shows its window instead
if(!app.requestSingleInstanceLock())
	app.exit()

const devServer = process.env.ELECTRON_RENDERER_URL
const pageFile = path.join(import.meta.dirname, '../renderer/index.html')

const store = new SettingsStore(path.join(app.getPath('userData'), 'settings.json'), safeStorage)
const PROVIDERS = ['google', 'airtable']

// what a run signs in with, keeping the tokens whenever they're refreshed
const sessions = () => Object.fromEntries(Object.entries(store.signIns()).map(([name, tokens]) =>
	[name, new OAuthSession(name, tokens, { onChange: tokens => store.setSignIn(name, tokens) })]))

const tracker = new TrackerController(() => store.full(), confirmDeletes, sessions)

const updater = new Updater(tracker.logger)

let window
let menuBar

const ready = () => store.view().config.settings.files.dirs.length > 0

/**
 * Bring the window up, making it again if it was closed
 * @param {string} view the part of it to show: 'activity' or 'settings'
 */
function showWindow(view) {
	if(window) {
		if(view)
			send('app:show', view)
		window.show()
	}
	else
		createWindow(view)

	// with no Dock icon, it's not in front until it's asked to be
	app.focus({ steal: true })
	window.focus()
}

function createWindow(view) {
	window = new BrowserWindow({
		width: 960,
		height: 720,
		minWidth: 640,
		minHeight: 480,
		title: 'Content Tracker',
		webPreferences: {
			preload: path.join(import.meta.dirname, '../preload/index.cjs'),
			contextIsolation: true,
			sandbox: true,
			nodeIntegration: false
		}
	})

	// it's only ever this one page
	window.webContents.on('will-navigate', event => event.preventDefault())
	// links in Help and About open in the browser, and only the ones it has
	window.webContents.setWindowOpenHandler(({ url }) => {
		if(isOurLink(url))
			shell.openExternal(url)
		return { action: 'deny' }
	})

	if(view)
		window.webContents.once('did-finish-load', () => send('app:show', view))

	if(devServer)
		window.loadURL(devServer)
	else
		window.loadFile(pageFile)

	window.on('closed', () => window = undefined)
}

const LINKS = ['github.com', 'generativenoise.com', 'store.generativenoise.com', 'ffmpeg.org', 'www.electronjs.org']

function isOurLink(text) {
	try {
		const url = new URL(text)
		return url.protocol == 'https:' && LINKS.includes(url.hostname)
	}
	catch {
		return false
	}
}

const send = (channel, value) => window?.webContents.send(channel, value)
tracker.on('log', entry => send('tracker:log', entry))
tracker.on('items', items => send('tracker:items', items))
tracker.on('state', state => {
	send('tracker:state', state)
	menuBar?.update()
})
updater.on('state', state => {
	send('update:state', state)
	menuBar?.update()
})

async function confirmDeletes({ table, count, total }) {
	// it may be running from the menu bar with no window open, and this mustn't go unseen
	app.focus({ steal: true })
	const options = {
		type: 'warning',
		message: `Remove ${count} of the ${total} ${table}?`,
		detail: 'This is over 10% of the table. They were not found in your folders.',
		buttons: ['Keep them', 'Remove them'],
		defaultId: 0,
		cancelId: 0
	}
	const { response } = await (window ? dialog.showMessageBox(window, options) : dialog.showMessageBox(options))
	return response == 1
}

/**
 * Handle a request from the page, and only from the page
 */
function handle(channel, handler) {
	ipcMain.handle(channel, (event, ...args) => {
		const { url } = event.senderFrame
		const fromPage = devServer ? url.startsWith(devServer) : url.startsWith('file:') && url.endsWith('/renderer/index.html')
		if(!fromPage)
			throw new Error('Not allowed')
		return handler(...args)
	})
}

async function pickFile(filters) {
	const { canceled, filePaths } = await dialog.showOpenDialog(window, { properties: ['openFile'], filters })
	return canceled ? null : filePaths[0]
}

const view = () => ({ ...store.view(), canSignIn: Object.fromEntries(PROVIDERS.map(name => [name, canSignIn(name)])) })

handle('config:get', () => view())

handle('config:save', async (saved, token) => {
	const config = renameOld(saved)
	const problems = configProblems(config)
	await store.save(config, token)
	menuBar?.update()
	return { ...view(), problems }
})

handle('config:clear-token', async () => {
	await store.clearToken()
	return view()
})

// a config for the command line, or another computer: never with the token or sign ins
handle('config:export', async () => {
	const { canceled, filePath } = await dialog.showSaveDialog(window, {
		defaultPath: 'content-tracker-config.json',
		filters: [{ name: 'Config', extensions: ['json'] }]
	})
	if(canceled || !filePath)
		return false

	const { config } = store.view()
	const exported = { $schema: SCHEMA_URL, ...config }
	await fs.writeFile(filePath, JSON.stringify(exported, null, 2) + '\n')
	return true
})

// a rule added from the list of what's tracked, by its name, folder or extension
handle('config:exclude', async (type, pattern) => {
	if(!['files', 'dirs'].includes(type) || typeof pattern != 'string' || !pattern)
		throw new Error('Not allowed')

	const config = structuredClone(store.view().config)
	// a config imported without rules has none to add to yet
	const rules = (config.settings.files.rules ??= {})
	const excludes = ((rules[type] ??= { includes: [], excludes: [] }).excludes ??= [])
	if(!excludes.includes(pattern))
		excludes.push(pattern)
	await store.save(config)
	menuBar?.update()
	return view()
})

handle('config:import', async () => {
	const file = await pickFile([{ name: 'Config', extensions: ['json'] }])
	if(!file)
		return null

	// a config from an older version, with settings that have since been renamed
	const config = renameOld(JSON.parse(await fs.readFile(file, 'utf8')))
	const problems = configProblems(config)
	if(!config?.settings?.files)
		return { problems }

	await store.save(config)
	menuBar?.update()
	return { ...view(), problems }
})

handle('auth:sign-in', async name => {
	if(!PROVIDERS.includes(name))
		throw new Error('Not allowed')

	// in the browser, where the user's own sign ins and password managers are
	const tokens = await signIn(name, { openBrowser: url => shell.openExternal(url) })
	await store.setSignIn(name, tokens)
	if(window)
		showWindow()
	return view()
})

handle('auth:sign-out', async name => {
	await store.setSignIn(name, undefined)
	return view()
})

// the bases the token or sign in can reach, to choose from
handle('airtable:bases', async () => {
	const settings = store.full().settings.airtable
	const target = new AirtableTarget(settings, { session: sessions().airtable })
	return target.bases()
})

// the media metadata kept for the saved folders, so every file is read again on the next run
handle('cache:wipe', async () => {
	if(tracker.state.running)
		throw new Error('Wait for the run to finish first')
	await new MetadataCache(cacheFile(store.full().settings.files.dirs)).wipe()
})

handle('dialog:folder', async () => {
	const { canceled, filePaths } = await dialog.showOpenDialog(window, { properties: ['openDirectory'] })
	return canceled ? null : filePaths[0]
})

handle('dialog:credentials', () => pickFile([{ name: 'Service account key', extensions: ['json'] }]))

// watching is remembered, so it carries on when the app next opens
async function startWatching() {
	await tracker.start()
	await store.setWatching(true)
}

async function stopWatching() {
	await tracker.stop()
	await store.setWatching(false)
}

handle('tracker:get', () => ({ state: tracker.state, log: tracker.log, items: tracker.items }))
handle('tracker:run', dryRun => tracker.run(dryRun === true))
handle('tracker:start', startWatching)
handle('tracker:stop', stopWatching)

handle('update:get', () => updater.state)
handle('update:install', () => updater.install())

// what the menu bar's menu can do, where nothing is waiting on it to say what went wrong
const fromMenu = action => () => action().catch(err => {
	tracker.logger.error('%s', err.message)
	showWindow('activity')
})

app.whenReady().then(async () => {
	// it lives in the menu bar, and the window comes and goes
	app.dock?.hide()

	// the app needs no camera, microphone, notifications or so on
	session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => callback(false))

	try {
		await store.load()
	}
	catch(err) {
		// quitting leaves the file as it is, where carrying on would save over it
		dialog.showErrorBox('Content Tracker couldn\'t open its settings', err.message)
		app.quit()
		return
	}

	menuBar = new MenuBar({
		state: () => tracker.state,
		update: () => updater.state,
		installUpdate: fromMenu(() => updater.install()),
		ready,
		scan: fromMenu(() => tracker.run(false)),
		startWatching: fromMenu(startWatching),
		stopWatching: fromMenu(stopWatching),
		showSettings: () => showWindow('settings'),
		quit: () => app.quit()
	})

	// opened at login, it stays out of the way; opened by hand, it shows itself
	if(!MenuBar.openedAtLogin() || !ready())
		showWindow(ready() ? undefined : 'settings')

	if(store.watching && ready())
		fromMenu(() => tracker.start())()

	updater.start()

	app.on('second-instance', () => showWindow())
	app.on('activate', () => showWindow())
})

// closing the window leaves it running in the menu bar
app.on('window-all-closed', () => {})

// let a run that's under way finish before it goes
let stopped = false
app.on('before-quit', async event => {
	if(stopped)
		return
	event.preventDefault()
	try {
		await tracker.stop()
	}
	finally {
		stopped = true
		app.quit()
	}
})

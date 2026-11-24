import { app, Menu, nativeImage, Tray } from 'electron'
import { readFileSync } from 'fs'
import trayIcon from '../../build/trayTemplate.png?asset'
import trayIcon2x from '../../build/trayTemplate@2x.png?asset'
import appIcon from '../../build/icon.png?asset'

// Windows starts it at login with this, as it can't tell otherwise
const AT_LOGIN = '--opened-at-login'
const LOGIN_ITEM = process.platform == 'win32' ? { args: [AT_LOGIN] } : {}

/**
 * The app's icon in the menu bar (the tray, on Windows), and its menu
 */
export class MenuBar {
	/**
	 * @param {object} actions .state(), .update(), .ready() & what each item does: .scan(),
	 * .startWatching(), .stopWatching(), .installUpdate(), .showSettings() & .quit()
	 */
	constructor(actions) {
		this.actions = actions
		this.tray = new Tray(MenuBar.icon())

		// Windows only shows a tray icon's menu on a right click without this
		if(process.platform == 'win32')
			this.tray.on('click', () => this.tray.popUpContextMenu())

		this.update()
	}

	static icon() {
		// the Mac colours a template to suit the menu bar, Windows has the app's own icon
		if(process.platform != 'darwin')
			return nativeImage.createFromPath(appIcon).resize({ width: 32, height: 32 })

		const image = nativeImage.createFromPath(trayIcon)
		image.addRepresentation({ scaleFactor: 2, buffer: readFileSync(trayIcon2x) })
		image.setTemplateImage(true)
		return image
	}

	/**
	 * @returns {boolean} whether this time it was opened at login, rather than by hand
	 */
	static openedAtLogin() {
		if(process.platform == 'darwin')
			return app.getLoginItemSettings().wasOpenedAtLogin
		return process.argv.includes(AT_LOGIN)
	}

	static canOpenAtLogin() {
		return ['darwin', 'win32'].includes(process.platform)
	}

	/**
	 * @returns {string} what it's doing, and how the last run went
	 */
	status() {
		const { running, watching, lastRun } = this.actions.state()
		if(running)
			return 'Scanning…'
		if(!this.actions.ready())
			return 'Not set up yet'

		const doing = watching ? 'Watching' : 'Not watching'
		if(!lastRun)
			return doing
		const at = new Date(lastRun.time).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
		return `${doing} - ${lastRun.error ? 'last scan failed' : 'last scanned'} at ${at}`
	}

	// the menu's made again whenever anything in it changes
	update() {
		const { running, watching } = this.actions.state()
		const ready = this.actions.ready()
		const status = this.status()

		const items = [
			{ label: status, enabled: false },
			{ type: 'separator' },
			{ label: 'Run Once', enabled: ready && !running, click: this.actions.scan },
			watching
				? { label: 'Stop Watching', click: this.actions.stopWatching }
				: { label: 'Start Watching', enabled: ready, click: this.actions.startWatching },
			{ type: 'separator' },
			{ label: 'Settings…', click: this.actions.showSettings }
		]

		const update = this.actions.update()
		if(update.version)
			items.splice(1, 0, update.progress === null
				? { label: `Update to ${update.version}`, click: this.actions.installUpdate }
				: { label: `Downloading ${update.version}… ${Math.round(update.progress * 100)}%`, enabled: false })

		if(MenuBar.canOpenAtLogin())
			items.push({
				label: 'Open at Login',
				type: 'checkbox',
				checked: app.getLoginItemSettings(LOGIN_ITEM).openAtLogin,
				click: item => app.setLoginItemSettings({ ...LOGIN_ITEM, openAtLogin: item.checked })
			})

		items.push(
			{ type: 'separator' },
			{ label: 'Quit Content Tracker', click: this.actions.quit }
		)

		this.tray.setContextMenu(Menu.buildFromTemplate(items))
		this.tray.setToolTip(`Content Tracker - ${status}`)
	}
}

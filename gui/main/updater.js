import { execFile, spawn } from 'child_process'
import { createHash } from 'crypto'
import { app, shell } from 'electron'
import { EventEmitter } from 'events'
import { createWriteStream, constants, promises as fs } from 'fs'
import * as path from 'path'
import { promisify } from 'util'
import { checkForUpdates, installerFor, isNewer, latestRelease } from '../../core/index.js'

const run = promisify(execFile)

const EVERY = 6 * 60 * 60 * 1000
const INSTALLER = /^Content-Tracker-[\d.]+-(mac|win|linux)-\w+\.(dmg|exe|AppImage)$/

/**
 * Looks for a newer release on GitHub, and installs it when asked: on a Mac by
 * swapping the app for the one in the release's disk image once it's quit, on
 * Windows by running its installer. Emits 'state' whenever .state changes.
 */
export class Updater extends EventEmitter {
	/** .version a newer one there is, .progress of its download (0 - 1) & .error */
	state = { version: null, progress: null, error: null }
	#release
	#installer

	/**
	 * @param {object} logger where to say what went wrong
	 * @param {object} env where it's told to look elsewhere, for the tests
	 */
	constructor(logger, env = process.env) {
		super()
		this.logger = logger
		this.env = env
		// only the built app has itself to replace
		this.enabled = checkForUpdates(env) && (app.isPackaged || Boolean(env.CONTENT_TRACKER_GITHUB_ENDPOINT))
	}

	#set(changes) {
		this.state = { ...this.state, ...changes }
		this.emit('state', this.state)
	}

	start() {
		if(!this.enabled)
			return
		this.check()
		setInterval(() => this.check(), EVERY).unref()
	}

	async check() {
		try {
			const release = await latestRelease({ env: this.env })
			if(!isNewer(release.version, app.getVersion()))
				return
			this.#release = release
			this.#installer = installerFor(release, process.platform, process.arch)
			if(this.state.version != release.version)
				this.#set({ version: release.version, error: null })
		}
		catch(err) {
			// offline, or GitHub's busy: it'll look again later
			this.logger.debug('Couldn\'t check for a newer version: %s', err.message)
		}
	}

	async install() {
		if(!this.#release || this.state.progress !== null)
			return

		// nothing this computer can install by itself, so it's over to the release's page
		if(!this.#installer) {
			if(this.#release.url.startsWith('https://github.com/'))
				await shell.openExternal(this.#release.url)
			return
		}

		this.#set({ progress: 0, error: null })
		try {
			const { file, folder } = await this.#download()
			if(!app.isPackaged)
				throw new Error('Only the built app can update itself.')
			if(process.platform == 'darwin')
				await this.#swapMacApp(file, folder)
			else if(process.platform == 'linux')
				await this.#swapAppImage(file, folder)
			else
				this.#runInstaller(file)
		}
		catch(err) {
			this.#set({ progress: null, error: err.message })
			throw err
		}
	}

	async #download() {
		const { name, url, size, digest } = this.#installer
		if(!INSTALLER.test(name))
			throw new Error(`${name} isn't an installer of this app.`)
		// what GitHub says the file should be, so anything else is never run
		if(!digest?.startsWith('sha256:'))
			throw new Error('GitHub didn\'t say what the download should be, so it wasn\'t installed.')

		const folder = await fs.mkdtemp(path.join(app.getPath('temp'), 'content-tracker-update-'))
		const file = path.join(folder, name)

		const response = await fetch(url)
		if(!response.ok)
			throw new Error(`The download failed: GitHub said ${response.status}.`)

		const hash = createHash('sha256')
		const out = createWriteStream(file)
		let received = 0
		for await (const chunk of response.body) {
			hash.update(chunk)
			out.write(chunk)
			received += chunk.length
			const progress = Math.min(received / (size || 1), 1)
			if(Math.floor(progress * 100) != Math.floor(this.state.progress * 100))
				this.#set({ progress })
		}
		await new Promise((resolve, reject) => out.end(err => err ? reject(err) : resolve()))

		if(`sha256:${hash.digest('hex')}` != digest) {
			await fs.rm(folder, { recursive: true, force: true })
			throw new Error('The download didn\'t match the release, so it wasn\'t installed.')
		}
		return { file, folder }
	}

	async #swapMacApp(file, folder) {
		// Contents/MacOS/Content Tracker, in the .app
		const current = path.resolve(path.dirname(process.execPath), '../..')

		// opened from the disk image, or from where it was downloaded, it can't replace itself:
		// the new one's opened for it to be dragged into Applications
		const inPlace = current.endsWith('.app') && !current.includes('/AppTranslocation/') && !current.startsWith('/Volumes/')
			&& await fs.access(path.dirname(current), constants.W_OK).then(() => true, () => false)
		if(!inPlace) {
			await shell.openPath(file)
			this.#set({ progress: null })
			return
		}

		const mount = path.join(folder, 'mount')
		await run('hdiutil', ['attach', file, '-nobrowse', '-readonly', '-noautoopen', '-mountpoint', mount])
		const replacement = path.join(folder, path.basename(current))
		try {
			const found = (await fs.readdir(mount)).find(entry => entry.endsWith('.app'))
			if(!found)
				throw new Error('There was no app in the download.')
			await run('ditto', [path.join(mount, found), replacement])
		}
		finally {
			await run('hdiutil', ['detach', mount, '-force']).catch(() => {})
		}

		// once this has quit: the old one's kept until the new one's in, and put back if it couldn't be
		const swap = `
			while kill -0 "$1" 2>/dev/null; do sleep 0.2; done
			rm -rf "$3.old"
			if mv "$3" "$3.old" && ditto "$2" "$3"; then rm -rf "$3.old"; else rm -rf "$3"; mv "$3.old" "$3"; fi
			open "$3"
			rm -rf "$4"
		`
		spawn('/bin/sh', ['-c', swap, 'update', String(process.pid), replacement, current, folder], { detached: true, stdio: 'ignore' }).unref()
		app.quit()
	}

	async #swapAppImage(file, folder) {
		// the AppImage it was opened from, which the new one takes the place of
		const current = process.env.APPIMAGE
		const inPlace = current && await fs.access(path.dirname(current), constants.W_OK).then(() => true, () => false)
		await fs.chmod(file, 0o755)
		if(!inPlace) {
			// somewhere it can't write, so the new one's shown for it to be put there by hand
			shell.showItemInFolder(file)
			this.#set({ progress: null })
			return
		}

		// once this has quit: the old one's kept until the new one's in, and put back if it couldn't be
		const swap = `
			while kill -0 "$1" 2>/dev/null; do sleep 0.2; done
			if mv "$3" "$3.old" && cp "$2" "$3" && chmod 755 "$3"; then rm -f "$3.old"; else rm -f "$3"; mv "$3.old" "$3"; fi
			"$3" >/dev/null 2>&1 &
			rm -rf "$4"
		`
		spawn('/bin/sh', ['-c', swap, 'update', String(process.pid), file, current, folder], { detached: true, stdio: 'ignore' }).unref()
		app.quit()
	}

	#runInstaller(file) {
		// silently, into where it is now, opening it again once it's done
		spawn(file, ['/S', '--force-run'], { detached: true, stdio: 'ignore' }).unref()
		app.quit()
	}
}

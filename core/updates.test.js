import { describe, expect, it } from 'vitest'
import { checkForUpdates, howToUpdate, installerFor, isNewer, latestOnNpm, latestRelease } from './index.js'

const answering = body => async url => ({ ok: true, status: 200, json: async () => body(url) })

describe('updates', () => {
	it('compares versions as numbers', () => {
		expect(isNewer('1.10.0', '1.9.3')).toBe(true)
		expect(isNewer('v2.0.0', '1.99.99')).toBe(true)
		expect(isNewer('1.0.0', '1.0.0')).toBe(false)
		expect(isNewer('1.0.0', '1.0.1')).toBe(false)
		expect(isNewer('1.0.0-beta.1', '1.0.0')).toBe(false)
	})

	it('is turned off on CI, or when asked', () => {
		expect(checkForUpdates({})).toBe(true)
		expect(checkForUpdates({ CI: 'true' })).toBe(false)
		expect(checkForUpdates({ CONTENT_TRACKER_NO_UPDATE_CHECK: '1' })).toBe(false)
	})

	it('finds the latest version on npm', async () => {
		let asked
		const http = answering(url => {
			asked = url
			return { version: '1.2.3' }
		})
		expect(await latestOnNpm({ env: {}, http })).toBe('1.2.3')
		expect(asked).toBe('https://registry.npmjs.org/@garethnunns%2fcontent-tracker/latest')
	})

	it('says how to update as it was run', () => {
		expect(howToUpdate({ npm_command: 'exec' })).toBe('npx @garethnunns/content-tracker@latest')
		expect(howToUpdate({})).toBe('npm install -g @garethnunns/content-tracker')
	})

	it('finds the installer for this computer in the latest release', async () => {
		const asset = name => ({ name, browser_download_url: `https://github.com/download/${name}`, size: 10, digest: 'sha256:abc' })
		const http = answering(() => ({
			tag_name: 'v1.2.0',
			html_url: 'https://github.com/release',
			assets: [asset('Content-Tracker-1.2.0-mac-arm64.dmg'), asset('Content-Tracker-1.2.0-mac-x64.dmg'), asset('Content-Tracker-1.2.0-win-x64.exe'), asset('Content-Tracker-1.2.0-linux-x64.AppImage')]
		}))
		const release = await latestRelease({ env: {}, http })
		expect(release.version).toBe('1.2.0')

		expect(installerFor(release, 'darwin', 'arm64').name).toBe('Content-Tracker-1.2.0-mac-arm64.dmg')
		expect(installerFor(release, 'darwin', 'x64').name).toBe('Content-Tracker-1.2.0-mac-x64.dmg')
		expect(installerFor(release, 'linux', 'x64').name).toBe('Content-Tracker-1.2.0-linux-x64.AppImage')
		expect(installerFor(release, 'linux', 'arm64')).toBeUndefined()
		expect(installerFor(release, 'win32', 'arm64').name).toBe('Content-Tracker-1.2.0-win-x64.exe')
	})

	it('says when it could not find out', async () => {
		const http = async () => ({ ok: false, status: 503 })
		await expect(latestRelease({ env: {}, http })).rejects.toThrow('api.github.com said 503')
	})
})

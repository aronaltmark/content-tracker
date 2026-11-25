// Finding out whether there's a newer version: on npm for the command line, and
// as a GitHub release, with its installers, for the app

export const PACKAGE = '@generativenoise/content-tracker'
export const REPOSITORY = 'garethnunns/content-tracker'

const TIMEOUT = 5000

/**
 * @param {string} version as 1.2.3, or v1.2.3
 * @param {string} than the one there is
 * @returns {boolean} whether version is the later of the two, ignoring anything after a -
 */
export function isNewer(version, than) {
	const parts = text => String(text).replace(/^v/, '').split('-')[0].split('.').map(part => parseInt(part, 10) || 0)
	const [a, b] = [parts(version), parts(than)]
	for(let i = 0; i < 3; i++)
		if((a[i] ?? 0) != (b[i] ?? 0))
			return (a[i] ?? 0) > (b[i] ?? 0)
	return false
}

/**
 * Whether to look at all: not on a CI server, and not if it's been turned off
 */
export function checkForUpdates(env = process.env) {
	return !env.CONTENT_TRACKER_NO_UPDATE_CHECK && !env.CI
}

async function getJSON(url, http) {
	const response = await http(url, {
		headers: { accept: 'application/json' },
		signal: AbortSignal.timeout(TIMEOUT)
	})
	if(!response.ok)
		throw new Error(`${new URL(url).host} said ${response.status}`)
	return response.json()
}

/**
 * @returns {Promise<string>} the latest version on npm
 */
export async function latestOnNpm({ env = process.env, http = globalThis.fetch } = {}) {
	const registry = env.CONTENT_TRACKER_NPM_ENDPOINT ?? 'https://registry.npmjs.org'
	const { version } = await getJSON(`${registry}/${PACKAGE.replace('/', '%2f')}/latest`, http)
	return version
}

/**
 * @returns {string} how to get the latest version, as it's being run now
 */
export function howToUpdate(env = process.env) {
	// npx keeps what it fetched, so it has to be asked for the latest
	return env.npm_command == 'exec'
		? `npx ${PACKAGE}@latest`
		: `npm install -g ${PACKAGE}`
}

/**
 * @returns {Promise<object>} the latest release on GitHub: .version, .url (its page) &
 * .assets, each with .name, .url, .size & .digest (sha256:..., when GitHub gives one)
 */
export async function latestRelease({ env = process.env, http = globalThis.fetch } = {}) {
	const api = env.CONTENT_TRACKER_GITHUB_ENDPOINT ?? 'https://api.github.com'
	const release = await getJSON(`${api}/repos/${REPOSITORY}/releases/latest`, http)
	return {
		version: release.tag_name.replace(/^v/, ''),
		url: release.html_url,
		assets: (release.assets ?? []).map(asset => ({
			name: asset.name,
			url: asset.browser_download_url,
			size: asset.size,
			digest: asset.digest ?? null
		}))
	}
}

/**
 * The installer of a release for this computer, as the app's build names them
 * (Content-Tracker-1.2.3-mac-arm64.dmg, Content-Tracker-1.2.3-win-x64.exe, Content-Tracker-1.2.3-linux-x64.AppImage)
 * @param {object} release from latestRelease()
 * @param {string} platform as process.platform
 * @param {string} arch as process.arch
 * @returns {object} the asset, if there's one
 */
export function installerFor(release, platform, arch) {
	const ending = {
		darwin: [`-mac-${arch}.dmg`],
		// Windows on Arm runs the x64 one
		win32: [`-win-${arch}.exe`, '-win-x64.exe'],
		linux: [`-linux-${arch}.AppImage`]
	}[platform] ?? []

	for(const end of ending) {
		const asset = release.assets.find(asset => asset.name == `Content-Tracker-${release.version}${end}`)
		if(asset)
			return asset
	}
}

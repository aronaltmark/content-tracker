import { createHash } from 'crypto'
import { createServer } from 'http'

/**
 * A stand-in for npm's registry and GitHub's releases, with a newer version on
 * both. Reach it with CONTENT_TRACKER_NPM_ENDPOINT & CONTENT_TRACKER_GITHUB_ENDPOINT.
 * @param {string} version the newer one
 * @param {boolean} tampered whether the installers aren't what the release says they are
 * @returns {Promise} .url, .downloads & .close()
 */
export async function fakeReleases({ version = '99.0.0', tampered = false } = {}) {
	const installer = Buffer.from('not really an installer')
	const digest = 'sha256:' + createHash('sha256').update(tampered ? 'something else' : installer).digest('hex')
	const names = ['mac-arm64.dmg', 'mac-x64.dmg', 'win-x64.exe', 'linux-x64.AppImage'].map(end => `Content-Tracker-${version}-${end}`)
	const downloads = []

	const send = (response, status, body) => {
		response.writeHead(status, { 'Content-Type': 'application/json' })
		response.end(JSON.stringify(body))
	}

	const server = createServer((request, response) => {
		const path = decodeURIComponent(new URL(request.url, 'http://localhost').pathname)

		if(path == '/@generativenoise/content-tracker/latest')
			return send(response, 200, { name: '@generativenoise/content-tracker', version })

		if(path == '/repos/garethnunns/content-tracker/releases/latest')
			return send(response, 200, {
				tag_name: `v${version}`,
				html_url: `${fake.url}/releases/v${version}`,
				assets: names.map(name => ({
					name,
					browser_download_url: `${fake.url}/download/${name}`,
					size: installer.length,
					digest
				}))
			})

		const name = path.replace('/download/', '')
		if(names.includes(name)) {
			downloads.push(name)
			response.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': installer.length })
			return response.end(installer)
		}

		send(response, 404, { message: 'Not Found' })
	})

	await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
	const fake = {
		url: `http://127.0.0.1:${server.address().port}`,
		downloads,
		close: () => new Promise(resolve => {
			server.closeAllConnections()
			server.close(resolve)
		})
	}
	return fake
}

// Takes out the ffprobe packages an app doesn't run: building both Macs at once
// (npm run dist:mac) needs both of theirs in node_modules, and each app would
// otherwise carry the other's too. Run after packing and before signing, so the
// signature covers what ships.
const { readdirSync, rmSync } = require('fs')
const path = require('path')

// electron-builder's Arch, by number, as Node names them, and so the ffprobe packages
const ARCHES = ['ia32', 'x64', 'arm', 'arm64']

exports.default = async function({ electronPlatformName, arch, appOutDir, packager }) {
	const own = `ffprobe-${electronPlatformName}-${ARCHES[arch]}`
	const folder = path.join(packager.getResourcesDir(appOutDir), 'app.asar.unpacked', 'node_modules', '@generativenoise')
	for(const name of readdirSync(folder))
		if(name.startsWith('ffprobe-') && name != own)
			rmSync(path.join(folder, name), { recursive: true, force: true })
}

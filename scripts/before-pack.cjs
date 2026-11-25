// Stops a build that would go out without ffprobe. npm only installs the one
// for the computer it runs on, so building for another (an Intel Mac's on an
// Apple Silicon one) needs it fetched first, by scripts/ffprobe-install.mjs: npm run dist:mac does both Macs.
const { existsSync } = require('fs')
const path = require('path')

// electron-builder's Arch, by number, as Node names them, and so the ffprobe packages
const ARCHES = ['ia32', 'x64', 'arm', 'arm64']

exports.default = async function({ electronPlatformName, arch, packager }) {
	const name = `${electronPlatformName}-${ARCHES[arch]}`
	if(!existsSync(path.join(packager.projectDir, 'node_modules', '@generativenoise', `ffprobe-${name}`, 'package.json')))
		throw new Error(`No ffprobe for ${name} - fetch it with node scripts/ffprobe-install.mjs ${name} first`)
}

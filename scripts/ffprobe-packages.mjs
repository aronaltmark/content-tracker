// Makes the ffprobe packages, @generativenoise/ffprobe-<platform>-<arch>, one for each
// computer Content Tracker runs on, into packages/ffprobe: each a current ffprobe
// from a pinned build, checked against its sha256 before it's used. npm installs
// only the one for the computer it's on, as each says which it's for.
//   node scripts/ffprobe-packages.mjs
// .github/workflows/ffprobe-packages.yml publishes them.
import { execFileSync } from 'child_process'
import { createHash } from 'crypto'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import * as path from 'path'
import { fileURLToPath } from 'url'

// FFmpeg's version, and the packages': a new build of the same FFmpeg goes up the last number
const FFMPEG = '9.1'
export const VERSION = '9.1.0'

// Martin Riedl's release builds for Mac & Linux, and Gyan's for Windows: both GPL
const RIEDL = 'https://ffmpeg.martin-riedl.de/download'
export const BUILDS = {
	'darwin-arm64': { url: `${RIEDL}/macos/arm64/1795207104_9.1/ffprobe.zip`, sha256: '6ef2df5f575042923a28537ab37adf936f28bf3e7b85de23a1447ed447ec1dbd', entry: 'ffprobe', by: 'Martin Riedl (ffmpeg.martin-riedl.de)' },
	'darwin-x64': { url: `${RIEDL}/macos/amd64/1795212433_9.1/ffprobe.zip`, sha256: '41ca7b7cba7992e33f1da3f1bf54db8ec103a4d387b1bfac3162062e8b1074ad', entry: 'ffprobe', by: 'Martin Riedl (ffmpeg.martin-riedl.de)' },
	'linux-x64': { url: `${RIEDL}/linux/amd64/1795205506_9.1/ffprobe.zip`, sha256: '5e4c53c9c86d6371027efa83d62c2cea00e02ded0234d8cc952d06c9259e4b33', entry: 'ffprobe', by: 'Martin Riedl (ffmpeg.martin-riedl.de)' },
	'linux-arm64': { url: `${RIEDL}/linux/arm64/1795204341_9.1/ffprobe.zip`, sha256: 'a1561aa2136bce9f51dac9b13be4480466a3031f82907d551619dcdc3b867ccc', entry: 'ffprobe', by: 'Martin Riedl (ffmpeg.martin-riedl.de)' },
	'win32-x64': { url: 'https://github.com/GyanD/codexffmpeg/releases/download/9.1/ffmpeg-9.1-essentials_build.zip', sha256: 'b9bbbb3acece000cbeec994f856649354e52c773807841e78908374b24d658fd', entry: 'ffmpeg-9.1-essentials_build/bin/ffprobe.exe', by: 'Gyan Doshi (gyan.dev)' }
}

export const packageName = target => `@generativenoise/ffprobe-${target}`

const OUT = fileURLToPath(new URL('../packages/ffprobe/', import.meta.url))

async function download(url) {
	const response = await fetch(url)
	if(!response.ok)
		throw new Error(`${url} - ${response.status}`)
	return Buffer.from(await response.arrayBuffer())
}

function readme(target, { url, by }) {
	return `# ${packageName(target)}

[FFmpeg](https://ffmpeg.org)'s ffprobe ${FFMPEG} for ${target}, for [Content Tracker](https://github.com/garethnunns/content-tracker), which installs the one for the computer it's on. Its path is \`bin/ffprobe${target.startsWith('win32') ? '.exe' : ''}\` in this package.

It's ${by}'s build, unchanged: ${url}, checked against its sha256 before it's packaged.

FFmpeg is licensed under the GPL, version 3 or later, as this build is. Its source is at https://ffmpeg.org/releases/ffmpeg-${FFMPEG}.tar.xz, and how this one was built is at ${by.includes('Riedl') ? 'https://git.martin-riedl.de/ffmpeg/build-script' : 'https://www.gyan.dev/ffmpeg/builds/'}.
`
}

if(import.meta.url == `file://${process.argv[1]}`) {
	rmSync(OUT, { recursive: true, force: true })
	const work = mkdtempSync(path.join(tmpdir(), 'ffprobe-'))
	try {
		for(const [target, build] of Object.entries(BUILDS)) {
			const zip = await download(build.url)
			const sha256 = createHash('sha256').update(zip).digest('hex')
			if(sha256 != build.sha256)
				throw new Error(`${target}: ${build.url} isn't the build that was pinned (sha256 ${sha256})`)

			const archive = path.join(work, `${target}.zip`)
			writeFileSync(archive, zip)
			const [platform, cpu] = target.split('-')
			const folder = path.join(OUT, target)
			const binary = path.join(folder, 'bin', platform == 'win32' ? 'ffprobe.exe' : 'ffprobe')
			mkdirSync(path.dirname(binary), { recursive: true })
			// only ffprobe, out of whatever else the archive has
			writeFileSync(binary, execFileSync('unzip', ['-p', archive, build.entry], { maxBuffer: 512 * 1024 * 1024 }))
			chmodSync(binary, 0o755)

			writeFileSync(path.join(folder, 'package.json'), JSON.stringify({
				name: packageName(target),
				version: VERSION,
				description: `FFmpeg's ffprobe ${FFMPEG} for ${target}, for Content Tracker`,
				license: 'GPL-3.0-or-later',
				repository: { type: 'git', url: 'git+https://github.com/garethnunns/content-tracker.git' },
				os: [platform],
				cpu: [cpu],
				files: ['bin', 'README.md']
			}, null, 2) + '\n')
			writeFileSync(path.join(folder, 'README.md'), readme(target, build))
			console.log(`${packageName(target)}@${VERSION}: ${Math.round(readFileSync(binary).length / 1e6)} MB`)
		}
	}
	finally {
		rmSync(work, { recursive: true, force: true })
	}
}

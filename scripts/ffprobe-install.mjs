// Puts the ffprobe package for another computer into node_modules, for building the app
// for it: npm only installs the one for this computer, and won't add another of them,
// as they're already in the lock file. It's the version package.json asks for, fetched by
// npm pack, which checks it against the registry's integrity hash.
//   node scripts/ffprobe-install.mjs darwin-x64 darwin-arm64
import { execFileSync } from 'child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import * as path from 'path'
import { fileURLToPath } from 'url'

const root = fileURLToPath(new URL('..', import.meta.url))
const { optionalDependencies } = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))
const npm = process.platform == 'win32' ? 'npm.cmd' : 'npm'

for(const target of process.argv.slice(2)) {
	const name = `@generativenoise/ffprobe-${target}`
	const version = optionalDependencies[name]
	if(!version)
		throw new Error(`package.json doesn't have ${name}`)

	const work = mkdtempSync(path.join(tmpdir(), 'ffprobe-'))
	try {
		const [{ filename }] = JSON.parse(execFileSync(npm, ['pack', `${name}@${version}`, '--json', '--pack-destination', work], { cwd: work, shell: process.platform == 'win32' }))
		const folder = path.join(root, 'node_modules', name)
		rmSync(folder, { recursive: true, force: true })
		mkdirSync(folder, { recursive: true })
		execFileSync('tar', ['-xzf', path.join(work, filename), '-C', folder, '--strip-components=1'])
		console.log(`${name}@${version}`)
	}
	finally {
		rmSync(work, { recursive: true, force: true })
	}
}

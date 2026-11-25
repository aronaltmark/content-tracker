// Compares what two ffprobes would put in the tables, for every file in a folder:
// the one Content Tracker uses now, and another, before changing to it. What's
// written to a table is what rows are matched on, so any difference here would
// update every record with it.
//   node scripts/ffprobe-compare.mjs <folder> <the other ffprobe>
import { execFile } from 'child_process'
import { promises as fs } from 'fs'
import * as path from 'path'
import { promisify } from 'util'
import { ffprobePath, mediaValues } from '../core/probe.js'

const run = promisify(execFile)
const [folder, other] = process.argv.slice(2)
if(!folder || !other) {
	console.error('node scripts/ffprobe-compare.mjs <folder> <the other ffprobe>')
	process.exit(1)
}

const probe = async (ffprobe, file) => {
	try {
		const { stdout } = await run(ffprobe, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file], { maxBuffer: 16 * 1024 * 1024 })
		return mediaValues(JSON.parse(stdout))
	}
	catch {
		// not media, as the scanner takes it
		return mediaValues()
	}
}

const version = async ffprobe => (await run(ffprobe, ['-version'])).stdout.split('\n')[0]
const current = ffprobePath()
console.log(`now:   ${await version(current)}`)
console.log(`other: ${await version(other)}\n`)

const files = (await fs.readdir(folder, { recursive: true, withFileTypes: true }))
	.filter(entry => entry.isFile() && !entry.name.startsWith('.'))
	.map(entry => path.join(entry.parentPath, entry.name))

const differences = {}
for(const file of files) {
	const [before, after] = await Promise.all([probe(current, file), probe(other, file)])
	for(const field of Object.keys(before))
		if(before[field] !== after[field]) {
			(differences[field] ??= []).push({ file: path.relative(folder, file), before: before[field], after: after[field] })
		}
}

console.log(`${files.length} files`)
if(!Object.keys(differences).length)
	console.log('Every value is the same')
for(const [field, changes] of Object.entries(differences)) {
	console.log(`\n${field}: ${changes.length} different`)
	for(const { file, before, after } of changes)
		console.log(`  ${file}: ${JSON.stringify(before)} -> ${JSON.stringify(after)}`)
}

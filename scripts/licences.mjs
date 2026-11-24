// What the app ships that isn't ours, and under what licence, from package-lock.json:
// the packages the command line and the app's main process run, and what the
// page bundles. About lists them, as virtual:licences.
import { readFileSync } from 'fs'

// what the page bundles, as the rest are devDependencies: Vue's runtime, without its compiler
const BUNDLED = ['vue', '@vue/runtime-dom', '@vue/runtime-core', '@vue/reactivity', '@vue/shared', 'marked']

// all of which GPL 3 code can use
export const COMPATIBLE = ['MIT', 'ISC', 'BSD-2-Clause', 'BSD-3-Clause', 'Apache-2.0', '0BSD', 'BlueOak-1.0.0', 'Python-2.0', 'CC0-1.0', 'Unlicense', 'LGPL-2.1', 'LGPL-3.0', 'GPL-3.0', 'GPL-3.0-or-later']

/**
 * @param {object} lock package-lock.json
 * @param {string} platform what it's being built for, as process.platform
 * @returns {array} { name, version, licence }, by name
 */
export function licences(lock = JSON.parse(readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8')), platform = process.platform) {
	const packages = lock.packages
	const found = new Map()

	const add = (key, entry) => {
		const name = key.replace(/^.*node_modules\//, '')
		if(!found.has(name))
			found.set(name, { name, version: entry.version, licence: entry.license ?? 'Unknown' })
	}

	// what the app's main process and the command line run, on this platform
	for(const [key, entry] of Object.entries(packages))
		if(key && !entry.dev && !entry.link && (!entry.os || entry.os.includes(platform)))
			add(key, entry)

	// and what the page bundles
	for(const name of BUNDLED)
		add(`node_modules/${name}`, packages[`node_modules/${name}`])

	add('node_modules/electron', packages['node_modules/electron'])
	return [...found.values()].sort((a, b) => a.name.localeCompare(b.name))
}

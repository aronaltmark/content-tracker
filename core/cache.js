import { createHash } from 'crypto'
import { promises as fs } from 'fs'
import * as os from 'os'
import * as path from 'path'

/**
 * Where this computer keeps caches for the tracker
 * @returns {string} folder path
 */
export function cacheDir() {
	if(process.platform == 'darwin')
		return path.join(os.homedir(), 'Library', 'Caches', 'content-tracker')
	if(process.platform == 'win32')
		return path.join(process.env.LOCALAPPDATA ?? os.tmpdir(), 'content-tracker', 'Cache')
	return path.join(process.env.XDG_CACHE_HOME ?? path.join(os.homedir(), '.cache'), 'content-tracker')
}

/**
 * The cache file for a set of scanned folders
 * @param {array} dirs the folders in the config
 * @returns {string} file path
 */
export function cacheFile(dirs) {
	const name = createHash('sha256').update(JSON.stringify(dirs)).digest('hex').slice(0, 16)
	return path.join(cacheDir(), name + '.json')
}

/**
 * Remembers each file's media values, so ffprobe only has to look at a file
 * again when its size or modified time changes. A cache that can't be read
 * or written only costs a rescan, so neither stops anything.
 */
export class MetadataCache {
	#entries = new Map()
	#seen = new Set()
	#changed = false

	/**
	 * @param {string} file where it's stored, nothing to keep it in memory
	 */
	constructor(file) {
		this.file = file
	}

	async load() {
		if(!this.file)
			return
		try {
			const stored = JSON.parse(await fs.readFile(this.file, 'utf8'))
			this.#entries = new Map(Object.entries(stored))
		}
		catch {
			this.#entries = new Map()
		}
	}

	/**
	 * @returns {object} media values, undefined if the file has changed
	 */
	get(fullPath, size, mtime) {
		this.#seen.add(fullPath)
		const entry = this.#entries.get(fullPath)
		if(entry?.size === size && entry?.mtime === mtime)
			return entry.media
	}

	set(fullPath, size, mtime, media) {
		this.#seen.add(fullPath)
		this.#entries.set(fullPath, { size, mtime, media })
		this.#changed = true
	}

	/**
	 * Store it, without the files this scan didn't see
	 */
	async save() {
		for(const fullPath of this.#entries.keys())
			if(!this.#seen.has(fullPath)) {
				this.#entries.delete(fullPath)
				this.#changed = true
			}
		this.#seen.clear()

		if(!this.file || !this.#changed)
			return

		// the file holds paths from the user's drives, so it's private to them
		await fs.mkdir(path.dirname(this.file), { recursive: true })
		const partial = `${this.file}.${process.pid}.tmp`
		await fs.writeFile(partial, JSON.stringify(Object.fromEntries(this.#entries)), { mode: 0o600 })
		await fs.rename(partial, this.file)
		this.#changed = false
	}

	async wipe() {
		this.#entries.clear()
		this.#seen.clear()
		this.#changed = false
		if(this.file)
			await fs.rm(this.file, { force: true })
	}
}

/**
 * The file found times are kept in, beside the metadata cache for the same folders
 * @param {array} dirs the folders in the config
 * @returns {string} file path
 */
export function foundFile(dirs) {
	return cacheFile(dirs).replace(/\.json$/, '.found.json')
}

/**
 * When each folder and file was first found, as nothing else knows: a file's own
 * dates are when it was made or changed, not when it turned up in the project.
 * Kept apart from the metadata cache, so clearing that doesn't lose them.
 */
export class FoundTimes {
	#times = new Map()
	#seen = new Set()
	#changed = false

	/**
	 * @param {string} file where they're stored, nothing to keep them in memory
	 */
	constructor(file) {
		this.file = file
	}

	async load() {
		if(!this.file)
			return
		try {
			this.#times = new Map(Object.entries(JSON.parse(await fs.readFile(this.file, 'utf8'))))
		}
		catch {
			this.#times = new Map()
		}
	}

	/**
	 * @param {string} key the table and path
	 * @returns {string} when it was first found, now if it's only just been
	 */
	stamp(key, now = new Date().toISOString()) {
		this.#seen.add(key)
		if(!this.#times.has(key)) {
			this.#times.set(key, now)
			this.#changed = true
		}
		return this.#times.get(key)
	}

	/**
	 * @returns {string} when it was first found, if it ever was
	 */
	get(key) {
		return this.#times.get(key)
	}

	/**
	 * Store them, without what this run didn't find unless told not to
	 * @param {object} options .prune, false when part of the run couldn't be read
	 */
	async save({ prune = true } = {}) {
		for(const key of prune ? [...this.#times.keys()] : [])
			if(!this.#seen.has(key)) {
				this.#times.delete(key)
				this.#changed = true
			}
		this.#seen.clear()

		if(!this.file || !this.#changed)
			return

		await fs.mkdir(path.dirname(this.file), { recursive: true })
		const partial = `${this.file}.${process.pid}.tmp`
		await fs.writeFile(partial, JSON.stringify(Object.fromEntries(this.#times)), { mode: 0o600 })
		await fs.rename(partial, this.file)
		this.#changed = false
	}
}

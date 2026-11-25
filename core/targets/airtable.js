import { TABLE_NOTE, defaultsFor, fieldsFor } from '../schema.js'
import { airtableToken } from '../config.js'
import { silentLogger } from '../logger.js'
import { chunks, delay } from './util.js'

const API = 'https://api.airtable.com/v0'
const BATCH = 10 // the most records Airtable takes in a request
const REQUEST_GAP = 220 // it allows 5 requests a second per base
const MAX_RETRIES = 5

const fieldTypes = {
	text: { type: 'singleLineText' },
	integer: { type: 'number', options: { precision: 0 } },
	decimal: { type: 'number', options: { precision: 2 } },
	checkbox: { type: 'checkbox', options: { icon: 'check', color: 'greenBright' } },
	dateTime: {
		type: 'dateTime',
		options: { dateFormat: { name: 'iso' }, timeFormat: { name: '24hour' }, timeZone: 'utc' }
	}
}

export class AirtableTarget {
	#token
	#tables = { folders: {}, files: {} }

	/**
	 * @param {object} settings the config's settings.airtable
	 * @param {object} options
	 * @param {boolean} options.mediaMetadata whether files have the media fields
	 * @param {boolean} options.trackFolders whether there's a folders table at all
	 * @param {OAuthSession} options.session a sign in, used when there's no token
	 * @param {function} options.http what makes the requests, normally fetch
	 * @param {function} options.wait (ms) => Promise
	 * @param {object} options.logger
	 */
	constructor(settings, { mediaMetadata, trackFolders = true, session, http = globalThis.fetch, wait = delay, logger = silentLogger, env = process.env }) {
		this.settings = settings
		this.mediaMetadata = mediaMetadata
		this.trackFolders = trackFolders
		this.http = http
		this.wait = wait
		this.logger = logger
		this.api = env.AIRTABLE_ENDPOINT_URL || API
		this.#token = airtableToken(settings, env)
		this.session = this.#token ? undefined : session

		if(!this.#token && !this.session)
			throw new Error('Not signed in to Airtable - sign in via settings, or set settings.airtable.token or AIRTABLE_API_KEY')

		this.#tables.folders.id = settings.foldersTable
		this.#tables.files.id = settings.filesTable
	}

	async #request(path, { method = 'GET', body } = {}) {
		let refreshed = false
		for(let attempt = 0; ; attempt++) {
			await this.wait(REQUEST_GAP)

			const token = this.#token || await this.session.accessToken()
			const response = await this.http(this.api + path, {
				method,
				headers: {
					Authorization: `Bearer ${token}`,
					...(body && { 'Content-Type': 'application/json' })
				},
				body: body && JSON.stringify(body)
			})

			if(response.status == 429 && attempt < MAX_RETRIES) {
				// going over the limit means waiting 30 seconds
				this.logger.warn('Airtable asked us to slow down, waiting')
				await this.wait((Number(response.headers.get('retry-after')) || 30) * 1000)
				continue
			}

			if(response.status == 401 && this.session && !refreshed) {
				// it may have been revoked or run out early, so one fresh token is worth a try
				refreshed = true
				await this.session.refresh()
				continue
			}

			if(response.ok)
				return response.json()

			const error = new Error(`Airtable said ${await describeError(response)}`)
			error.status = response.status
			throw error
		}
	}

	/**
	 * The bases this token or sign in can reach, for choosing one
	 * @returns {array} of { id, name }
	 */
	async bases() {
		const bases = []
		let offset = ''
		do {
			const page = await this.#request(`/meta/bases${offset && '?offset=' + encodeURIComponent(offset)}`)
			bases.push(...page.bases.map(({ id, name }) => ({ id, name })))
			offset = page.offset ?? ''
		} while(offset)
		return bases
	}

	/**
	 * @returns {Promise} the base's name, or null if it can't see it
	 */
	async name() {
		return (await this.bases()).find(base => base.id == this.settings.base)?.name ?? null
	}

	#base() {
		return encodeURIComponent(this.settings.base)
	}

	#tablePath(table) {
		return `/${this.#base()}/${encodeURIComponent(this.#tables[table].id)}`
	}

	/**
	 * Create whatever's missing from the base
	 * @param {object} options .dryRun to only work out what would be done
	 */
	async prepare({ dryRun = false } = {}) {
		let existing
		try {
			existing = (await this.#request(`/meta/bases/${this.#base()}/tables`)).tables
		}
		catch(err) {
			if(err.status != 401 && err.status != 403)
				throw err
			// older tokens have no schema permissions, they can still use tables that exist
			this.logger.warn('This token can\'t read the base\'s schema, so missing tables won\'t be created')
			return
		}

		const find = id => existing.find(table => table.id == id || table.name == id)
		const folders = this.trackFolders && await this.#prepareTable('folders', find(this.settings.foldersTable), dryRun)
		const files = await this.#prepareTable('files', find(this.settings.filesTable), dryRun)

		// links are last as they need both of the tables to exist
		if(folders && !dryRun) {
			await this.#addLink(folders, folders.id)
			await this.#addLink(files, folders.id)
		}
	}

	async #prepareTable(table, found, dryRun) {
		const state = this.#tables[table]
		const wanted = fieldsFor(table, this.mediaMetadata, this.trackFolders)
		const plain = wanted.filter(field => field.type != 'link')
		const name = state.id

		if(!found) {
			if(/^tbl[A-Za-z0-9]{14}$/.test(name))
				throw new Error(`Airtable table ${name} doesn't exist - use a name for it to be created`)

			if(dryRun) {
				this.logger.info('[DRY RUN] - would create the %s table in Airtable', name)
				state.missing = true
				return { id: name, fields: [] }
			}

			this.logger.info('Creating the %s table in Airtable', name)
			found = await this.#request(`/meta/bases/${this.#base()}/tables`, {
				method: 'POST',
				body: { name, description: TABLE_NOTE, fields: plain.map(airtableField) }
			})
			state.created = true
			if(this.settings.view)
				this.logger.warn('Airtable can\'t create views - add %s to the %s table, or clear the view setting', this.settings.view, name)
		}

		state.id = found.id

		const has = new Set(found.fields.map(field => field.name))
		const missing = plain.filter(field => !has.has(field.name))
		state.readable = wanted.filter(field => has.has(field.name) || !dryRun).map(field => field.name)

		if(dryRun) {
			missing.forEach(field => this.logger.info('[DRY RUN] - would add %s to the %s table', field.name, name))
			return found
		}

		for(const field of missing) {
			this.logger.info('Adding %s to the %s table', field.name, name)
			await this.#request(`/meta/bases/${this.#base()}/tables/${state.id}/fields`, {
				method: 'POST',
				body: airtableField(field)
			})
		}

		const view = this.settings.view
		if(view && !state.created && !found.views?.some(({ id, name }) => id == view || name == view))
			throw new Error(`The ${found.name} table has no view called ${view} - add it in Airtable, or clear the view setting`)

		return found
	}

	async #addLink(table, linkedTableId) {
		if(table.fields.some(field => field.name == '_parent'))
			return

		await this.#request(`/meta/bases/${this.#base()}/tables/${table.id}/fields`, {
			method: 'POST',
			body: { name: '_parent', type: 'multipleRecordLinks', options: { linkedTableId } }
		})
	}

	/**
	 * Every record in a table
	 * @param {string} table 'folders' or 'files'
	 * @returns {array} of { id, fields }, blanks filled with their defaults
	 */
	async fetch(table) {
		const state = this.#tables[table]
		if(state.missing)
			return []

		const fields = fieldsFor(table, this.mediaMetadata, this.trackFolders)
		const names = state.readable ?? fields.map(field => field.name)
		const query = new URLSearchParams()
		names.forEach(name => query.append('fields[]', name))
		if(this.settings.view && !state.created)
			query.set('view', this.settings.view)

		const records = []
		do {
			const page = await this.#request(`${this.#tablePath(table)}?${query}`)
			records.push(...page.records)
			query.set('offset', page.offset ?? '')
		} while(query.get('offset'))

		// Airtable leaves out anything blank
		return records.map(record => ({ id: record.id, fields: { ...defaultsFor(fields), ...record.fields } }))
	}

	/**
	 * Make the changes to a table, one batch at a time
	 * @param {string} table 'folders' or 'files'
	 * @param {object} diffs from diffRecords()
	 * @returns {object} how many were .inserted, .updated & .deleted
	 */
	async apply(table, diffs) {
		const path = this.#tablePath(table)
		const done = { inserted: 0, updated: 0, deleted: 0 }

		for(const batch of chunks(diffs.inserts, BATCH)) {
			await this.#request(path, { method: 'POST', body: { records: batch.map(fields => ({ fields })) } })
			done.inserted += batch.length
		}

		for(const batch of chunks(diffs.updates, BATCH)) {
			await this.#request(path, { method: 'PATCH', body: { records: batch } })
			done.updated += batch.length
		}

		for(const batch of chunks(diffs.deletes, BATCH)) {
			const query = new URLSearchParams()
			batch.forEach(record => query.append('records[]', record.id))
			await this.#request(`${path}?${query}`, { method: 'DELETE' })
			done.deleted += batch.length
		}

		return done
	}

	/**
	 * What goes in a record's _parent field
	 * @param {object} folder the parent's remote record, if it has one
	 */
	parentValue(folder) {
		return folder ? [folder.id] : []
	}
}

const airtableField = ({ name, type }) => ({ name, ...fieldTypes[type] })

async function describeError(response) {
	const body = await response.json().catch(() => ({}))
	const detail = body.error?.message ?? body.error?.type ?? body.error
	return `${response.status}${detail ? ` - ${detail}` : ''}`
}

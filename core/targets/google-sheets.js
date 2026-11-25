import { JWT } from 'google-auth-library'
import { promises as fs } from 'fs'
import { googleCredentials } from '../config.js'
import { TABLE_NOTE, defaultValue, fieldsFor } from '../schema.js'
import { silentLogger } from '../logger.js'
import { chunks, delay } from './util.js'

const API = '/v4/spreadsheets'
const ENDPOINT = 'https://sheets.googleapis.com'
const SCOPES = ['https://www.googleapis.com/auth/spreadsheets']
const BATCH = 500 // rows in a request, Sheets limits requests rather than rows
const MAX_RETRIES = 5

// 0 is column A
function columnLetter(index) {
	let letters = ''
	for(let n = index + 1; n > 0; n = Math.floor((n - 1) / 26))
		letters = String.fromCharCode(65 + (n - 1) % 26) + letters
	return letters
}

const sheetRange = (name, range = '') => `'${name.replaceAll("'", "''")}'${range && '!' + range}`

// what a cell holds to what the field holds
function cellValue(field, cell) {
	if(cell === undefined || cell === '')
		return field.type == 'link' ? '' : defaultValue(field)

	switch(field.type) {
		case 'integer':
		case 'decimal':
			return Number(cell) || 0
		case 'checkbox':
			return cell === true || String(cell).toUpperCase() == 'TRUE'
		default:
			return String(cell)
	}
}

/**
 * Connect to the Sheets API with a service account's key
 * @param {string} file path of the key
 * @returns {function} request ({ url, method, data }) => Promise of { data }
 */
function serviceAccountRequest(file) {
	let client
	return async (options) => {
		if(!client) {
			const key = JSON.parse(await fs.readFile(file, 'utf8'))
			if(key.type != 'service_account')
				throw new Error(`${file} isn't a service account key`)
			client = new JWT({ email: key.client_email, key: key.private_key, scopes: SCOPES })
		}
		return client.request(options)
	}
}

/**
 * Requests made with a Google sign in, in the shape the auth library's are
 * @param {OAuthSession} session
 * @returns {function} request ({ url, method, data }) => Promise of { data }
 */
function signedInRequest(session, http) {
	return async ({ url, method, data }) => {
		for(let refreshed = false; ; refreshed = true) {
			const response = await http(url, {
				method,
				headers: {
					Authorization: `Bearer ${await session.accessToken()}`,
					...(data && { 'Content-Type': 'application/json' })
				},
				body: data && JSON.stringify(data)
			})
			const body = await response.json().catch(() => ({}))

			if(response.ok)
				return { data: body }

			if(response.status == 401 && !refreshed) {
				await session.refresh()
				continue
			}

			const error = new Error(body.error?.message ?? `${response.status}`)
			error.status = response.status
			error.response = { status: response.status, data: body }
			throw error
		}
	}
}

/**
 * Make a new spreadsheet in the signed in Google Drive, which a sign in with drive.file
 * can then open, as it made it
 * @param {object} options
 * @param {OAuthSession} options.session the Google sign in
 * @param {string} options.title its name
 * @param {string[]} options.sheets the tabs to start with, so there's no Sheet1 left over
 * @returns {Promise} of { id, name }
 */
export async function createSpreadsheet({ session, title, sheets = [], http = globalThis.fetch, env = process.env }) {
	const request = signedInRequest(session, http)
	const url = (env.GOOGLE_SHEETS_ENDPOINT_URL || ENDPOINT) + API
	try {
		const { data } = await request({
			url,
			method: 'POST',
			data: { properties: { title }, sheets: sheets.map(name => ({ properties: { title: name } })) }
		})
		return { id: data.spreadsheetId, name: data.properties?.title ?? title }
	}
	catch(err) {
		throw new Error(`Google Sheets couldn't make the spreadsheet - ${err.message}`, { cause: err })
	}
}

export class GoogleSheetsTarget {
	#sheets = { folders: {}, files: {} }

	/**
	 * @param {object} settings the config's settings.googleSheets
	 * @param {object} options
	 * @param {boolean} options.mediaMetadata whether files have the media fields
	 * @param {boolean} options.trackFolders whether there's a folders sheet at all
	 * @param {OAuthSession} options.session a Google sign in, used when there's no service account
	 * @param {function} options.request what makes the requests, for testing
	 * @param {function} options.wait (ms) => Promise
	 * @param {object} options.logger
	 */
	constructor(settings, { mediaMetadata, trackFolders = true, session, request, http = globalThis.fetch, wait = delay, logger = silentLogger, env = process.env }) {
		this.settings = settings
		this.mediaMetadata = mediaMetadata
		this.trackFolders = trackFolders
		this.wait = wait
		this.logger = logger
		this.endpoint = (env.GOOGLE_SHEETS_ENDPOINT_URL || ENDPOINT) + API

		const credentials = googleCredentials(settings, env)
		if(request)
			this.request = request
		else if(credentials)
			this.request = serviceAccountRequest(credentials)
		else if(session) {
			this.request = signedInRequest(session, http)
			// a sign in only opens the spreadsheets it's been given (drive.file)
			this.signedIn = true
		}
		else
			throw new Error('Not signed in to Google - sign in via settings, or set settings.googleSheets.credentials or GOOGLE_APPLICATION_CREDENTIALS')

		this.#sheets.folders.name = settings.foldersSheet
		this.#sheets.files.name = settings.filesSheet
	}

	async #call(path, { method = 'GET', data } = {}) {
		const url = `${this.endpoint}/${encodeURIComponent(this.settings.spreadsheetId)}${path}`

		for(let attempt = 0; ; attempt++) {
			try {
				return (await this.request({ url, method, data })).data
			}
			catch(err) {
				const status = err.status ?? err.response?.status
				if((status == 429 || status >= 500) && attempt < MAX_RETRIES) {
					this.logger.warn('Google Sheets asked us to slow down, waiting')
					await this.wait(2 ** attempt * 2000)
					continue
				}
				if(this.signedIn && (status == 403 || status == 404))
					throw new Error('Content Tracker can\'t open that spreadsheet - choose it with Choose from Drive in the app, or tracker choose-spreadsheet', { cause: err })
				throw new Error(`Google Sheets said ${status ?? ''} - ${err.response?.data?.error?.message ?? err.message}`, { cause: err })
			}
		}
	}

	/**
	 * @returns {Promise} the spreadsheet's name
	 */
	async name() {
		return (await this.#call('?fields=properties.title')).properties?.title ?? null
	}

	#update(requests) {
		return this.#call(':batchUpdate', { method: 'POST', data: { requests } })
	}

	/**
	 * Create whatever's missing from the spreadsheet: the tabs & their headers.
	 * Any other columns the user has added are left where they are.
	 * @param {object} options .dryRun to only work out what would be done
	 */
	async prepare({ dryRun = false } = {}) {
		const { sheets } = await this.#call('?fields=sheets.properties')

		for(const table of this.trackFolders ? ['folders', 'files'] : ['files']) {
			const sheet = this.#sheets[table]
			const wanted = fieldsFor(table, this.mediaMetadata, this.trackFolders)
			let properties = sheets.find(({ properties }) => properties.title == sheet.name)?.properties

			if(!properties) {
				if(dryRun) {
					this.logger.info('[DRY RUN] - would create the %s sheet', sheet.name)
					sheet.missing = true
					continue
				}

				this.logger.info('Creating the %s sheet', sheet.name)
				const { replies } = await this.#update([{ addSheet: { properties: { title: sheet.name } } }])
				properties = replies[0].addSheet.properties
				sheet.created = true
				// its columns fit what's first written to them, and only then, so widths set by hand stay
				sheet.fit = true
			}

			sheet.id = properties.sheetId

			const { values = [] } = await this.#call(`/values/${encodeURIComponent(sheetRange(sheet.name, '1:1'))}`)
			const headers = values[0] ?? []
			const missing = wanted.filter(field => !headers.includes(field.name))

			if(!missing.length)
				continue

			if(dryRun) {
				missing.forEach(field => this.logger.info('[DRY RUN] - would add %s to the %s sheet', field.name, sheet.name))
				continue
			}

			const needed = headers.length + missing.length - properties.gridProperties.columnCount
			if(needed > 0)
				await this.#update([{ appendDimension: { sheetId: sheet.id, dimension: 'COLUMNS', length: needed } }])

			await this.#writeCells(sheetRange(sheet.name, `${columnLetter(headers.length)}1`), [missing.map(field => field.name)])

			// a sheet has no description, so the note goes on its first header, and its own
			// columns warn whoever goes to edit them by hand, as only a sheet it made is known to be ours
			if(sheet.created)
				await this.#update([
					{
						updateCells: {
							range: { sheetId: sheet.id, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 1 },
							rows: [{ values: [{ note: TABLE_NOTE }] }],
							fields: 'note'
						}
					},
					{
						// the headers, and _path, its first column, stay in view however far it's scrolled
						updateSheetProperties: {
							properties: { sheetId: sheet.id, gridProperties: { frozenRowCount: 1, frozenColumnCount: 1 } },
							fields: 'gridProperties.frozenRowCount,gridProperties.frozenColumnCount'
						}
					},
					{
						addProtectedRange: {
							protectedRange: {
								range: { sheetId: sheet.id, startColumnIndex: 0, endColumnIndex: wanted.length },
								description: TABLE_NOTE,
								warningOnly: true
							}
						}
					}
				])
		}
	}

	// RAW so a file called =IMPORTXML(...) stays text rather than being run as a formula
	#writeCells(range, values) {
		const query = 'valueInputOption=RAW'
		return this.#call(`/values/${encodeURIComponent(range)}?${query}`, { method: 'PUT', data: { values } })
	}

	async #readRows(table) {
		const sheet = this.#sheets[table]
		const query = 'valueRenderOption=UNFORMATTED_VALUE'
		const { values = [] } = await this.#call(`/values/${encodeURIComponent(sheetRange(sheet.name))}?${query}`)
		const [headers = [], ...rows] = values
		const columns = new Map(headers.map((header, index) => [header, index]))
		return { columns, rows }
	}

	/**
	 * Every record in a sheet
	 * @param {string} table 'folders' or 'files'
	 * @returns {array} of { id, fields } where id is the row number
	 */
	async fetch(table) {
		if(this.#sheets[table].missing)
			return []

		const fields = fieldsFor(table, this.mediaMetadata, this.trackFolders)
		const { columns, rows } = await this.#readRows(table)

		return rows.flatMap((row, index) => {
			const values = fields.map(field => [field.name, cellValue(field, row[columns.get(field.name)])])
			const record = { id: index + 2, fields: Object.fromEntries(values) }
			return record.fields._path ? [record] : []
		})
	}

	/**
	 * Make the changes to a sheet. It's read again first, as someone may have
	 * sorted it or added a row since, and writes only touch our own columns.
	 * @param {string} table 'folders' or 'files'
	 * @param {object} diffs from diffRecords()
	 * @returns {object} how many were .inserted, .updated & .deleted
	 */
	async apply(table, diffs) {
		const sheet = this.#sheets[table]
		const fields = fieldsFor(table, this.mediaMetadata, this.trackFolders)
		const { columns, rows } = await this.#readRows(table)

		const pathColumn = columns.get('_path')
		const rowOf = (id, path) => {
			if(rows[id - 2]?.[pathColumn] === path)
				return id
			const index = rows.findIndex(row => row[pathColumn] === path)
			return index > -1 ? index + 2 : undefined
		}

		const done = { inserted: 0, updated: 0, deleted: 0 }

		for(const batch of chunks(diffs.updates, BATCH)) {
			const data = batch.flatMap(({ id, fields: values }) => {
				const row = rowOf(id, values._path)
				if(!row)
					return []

				return fields.map(field => {
					const column = columnLetter(columns.get(field.name))
					return { range: sheetRange(sheet.name, `${column}${row}`), values: [[values[field.name]]] }
				})
			})

			await this.#call('/values:batchUpdate', { method: 'POST', data: { valueInputOption: 'RAW', data } })
			done.updated += batch.length
		}

		// from the bottom up so the rows above don't move
		const doomed = diffs.deletes
			.map(record => rowOf(record.id, record.fields._path))
			.filter(row => row)
			.sort((a, b) => b - a)

		if(doomed.length) {
			await this.#update(doomed.map(row => ({
				deleteDimension: {
					range: { sheetId: sheet.id, dimension: 'ROWS', startIndex: row - 1, endIndex: row }
				}
			})))
			done.deleted = doomed.length
		}

		for(const batch of chunks(diffs.inserts, BATCH)) {
			const width = Math.max(...columns.values()) + 1
			const values = batch.map(record => {
				const row = Array(width).fill(null)
				fields.forEach(field => row[columns.get(field.name)] = record[field.name])
				return row
			})

			const query = 'valueInputOption=RAW&insertDataOption=INSERT_ROWS'
			await this.#call(`/values/${encodeURIComponent(sheetRange(sheet.name))}:append?${query}`, { method: 'POST', data: { values } })
			done.inserted += batch.length
		}

		// the rows it's written get tick boxes, and only those: Sheets counts an empty row with
		// one as part of the table, so rows added after it would go below every one of them
		if(diffs.inserts.length) {
			const lastRow = 1 + rows.length - done.deleted + done.inserted
			await this.#checkboxes(sheet, name => columns.get(name) ?? -1, fields, lastRow)
		}

		if(sheet.fit && done.inserted) {
			await this.#update([{
				autoResizeDimensions: {
					dimensions: { sheetId: sheet.id, dimension: 'COLUMNS', startIndex: 0, endIndex: Math.max(...columns.values()) + 1 }
				}
			}])
			sheet.fit = false
		}

		return done
	}

	/**
	 * Show true and false as tick boxes, in each column that holds them, down to the last row
	 * @param {object} sheet
	 * @param {function} columnOf (name) => the column a header's in, -1 if it isn't
	 * @param {array} fields the ones to do, of those it tracks
	 * @param {number} lastRow the last row with a record in, counting the header as 1
	 */
	async #checkboxes(sheet, columnOf, fields, lastRow) {
		const columns = fields.filter(field => field.type == 'checkbox').map(field => columnOf(field.name)).filter(column => column > -1)
		if(!columns.length)
			return

		await this.#update(columns.map(column => ({
			setDataValidation: {
				range: { sheetId: sheet.id, startRowIndex: 1, endRowIndex: lastRow, startColumnIndex: column, endColumnIndex: column + 1 },
				rule: { condition: { type: 'BOOLEAN' } }
			}
		})))
	}

	/**
	 * What goes in a record's _parent field. Row numbers move, so it's the path.
	 * @param {object} folder the parent's remote record, if it has one
	 */
	parentValue(folder) {
		return folder ? folder.fields._path : ''
	}
}

import { createHash } from 'crypto'
import { createServer } from 'http'

// a small stand-in for a spreadsheet, which only does what the target asks of it
export class FakeSheets {
	sheets = new Map()
	nextId = 1
	requests = []

	constructor(tabs = {}) {
		for(const [name, rows] of Object.entries(tabs))
			this.addSheet(name, rows)
	}

	addSheet(title, rows = []) {
		const properties = { sheetId: this.nextId++, title, gridProperties: { columnCount: 26 } }
		this.sheets.set(title, { properties, rows: structuredClone(rows) })
		return properties
	}

	#sheet(range) {
		const match = range.match(/^'(.*)'(?:!(.*))?$/)
		return { sheet: this.sheets.get(match[1].replaceAll("''", "'")), cell: match[2] }
	}

	#write(range, values) {
		const { sheet, cell } = this.#sheet(range)
		const [, letter, row] = cell.match(/^([A-Z]+)(\d+)$/)
		const column = letter.split('').reduce((total, char) => total * 26 + char.charCodeAt(0) - 64, 0) - 1

		values.forEach((cells, offset) => {
			const target = sheet.rows[row - 1 + offset] ??= []
			cells.forEach((value, index) => target[column + index] = value)
		})
	}

	request = async ({ url, method, data }) => {
		const { pathname, search } = new URL(url)
		const path = decodeURIComponent(pathname.replace(/^\/v4\/spreadsheets\/[^/:]+/, ''))
		this.requests.push({ method, path, search, data })

		if(path == '' && method == 'GET')
			return { data: { sheets: [...this.sheets.values()].map(({ properties }) => ({ properties })) } }

		if(path == ':batchUpdate') {
			const replies = data.requests.map(request => {
				if(request.addSheet)
					return { addSheet: { properties: this.addSheet(request.addSheet.properties.title) } }
				if(request.deleteDimension) {
					const { sheetId, startIndex, endIndex } = request.deleteDimension.range
					const sheet = [...this.sheets.values()].find(({ properties }) => properties.sheetId == sheetId)
					sheet.rows.splice(startIndex, endIndex - startIndex)
				}
				if(request.appendDimension) {
					const sheet = [...this.sheets.values()].find(({ properties }) => properties.sheetId == request.appendDimension.sheetId)
					sheet.properties.gridProperties.columnCount += request.appendDimension.length
				}
				return {}
			})
			return { data: { replies } }
		}

		if(path == '/values:batchUpdate') {
			data.data.forEach(({ range, values }) => this.#write(range, values))
			return { data: {} }
		}

		const range = path.replace('/values/', '')

		if(range.endsWith(':append')) {
			const { sheet } = this.#sheet(range.replace(':append', ''))
			sheet.rows.push(...data.values)
			return { data: {} }
		}

		if(method == 'PUT') {
			this.#write(range, data.values)
			return { data: {} }
		}

		const { sheet, cell } = this.#sheet(range)
		return { data: { values: cell == '1:1' ? sheet.rows.slice(0, 1) : sheet.rows } }
	}

	rows(name) {
		return this.sheets.get(name).rows
	}
}

/**
 * Stand-ins for Google's and Airtable's sign in, holding to what the real ones
 * insist on: the PKCE challenge, the redirect it was asked for, a code used once,
 * and refresh tokens that Airtable replaces each time. Reach it with
 * CONTENT_TRACKER_OAUTH_ENDPOINT, and its spreadsheets with GOOGLE_SHEETS_ENDPOINT_URL. Its
 * file picker, the store's page in its place, is at <url>/google/picker, for CONTENT_TRACKER_PICKER_URL:
 * it sends straight back what's to be chosen, as the page does once something is.
 * @param {object} options .expiresIn seconds an access token lasts, .deny to refuse the sign in,
 * .grant the scopes a Google sign in is given, as someone unticking one would, .email who it's signed in as,
 * .pick the spreadsheet the picker chooses ({ id, name }, or null to cancel), .onlyPicked to open only
 * spreadsheets that have been picked, as a sign in with drive.file can
 * @returns {Promise} .url, .sheets (a FakeSheets), .isValid(token), .refreshes, .pickers (what each was opened with) & .close()
 */
export async function fakeOAuth({ expiresIn = 3600, deny = false, grant, email = 'someone@example.com', pick = { id: 'picked-sheet-1234', name: 'Shots' }, onlyPicked = false } = {}) {
	const codes = new Map()
	const accessTokens = new Set()
	const refreshTokens = new Map()
	const sheets = new FakeSheets()
	let next = 1
	let refreshes = 0
	const picked = new Set()
	const pickers = []

	const issue = (provider, response) => {
		const accessToken = `${provider}-access-${next++}`
		const refreshToken = `${provider}-refresh-${next++}`
		accessTokens.add(accessToken)
		refreshTokens.set(refreshToken, provider)
		const body = { access_token: accessToken, refresh_token: refreshToken, expires_in: expiresIn, token_type: 'Bearer' }
		if(provider == 'google') {
			if(grant)
				body.scope = grant.join(' ')
			const claims = Buffer.from(JSON.stringify({ email })).toString('base64url')
			body.id_token = `e30.${claims}.signature`
		}
		send(response, 200, body)
	}

	const send = (response, status, body) => {
		response.writeHead(status, { 'Content-Type': 'application/json' })
		response.end(JSON.stringify(body))
	}

	const server = createServer(async (request, response) => {
		const url = new URL(request.url, 'http://localhost')
		let raw = ''
		for await (const chunk of request)
			raw += chunk

		const [, provider, step] = url.pathname.match(/^\/(google|airtable)\/(authorize|token)$/) ?? []

		if(url.pathname == '/google/picker') {
			pickers.push(Object.fromEntries(url.searchParams))
			const back = new URL(url.searchParams.get('return'))
			back.searchParams.set('state', url.searchParams.get('state'))
			if(pick) {
				picked.add(pick.id)
				back.searchParams.set('id', pick.id)
				back.searchParams.set('name', pick.name)
			}
			else
				back.searchParams.set('cancelled', '1')
			response.writeHead(302, { Location: back.toString() })
			return response.end()
		}

		if(step == 'authorize') {
			const query = url.searchParams
			const back = new URL(query.get('redirect_uri'))
			back.searchParams.set('state', query.get('state'))
			if(deny)
				back.searchParams.set('error', 'access_denied')
			else {
				if(query.get('code_challenge_method') != 'S256' || !query.get('code_challenge'))
					return send(response, 400, { error: 'invalid_request' })
				const code = `code-${next++}`
				codes.set(code, { provider, challenge: query.get('code_challenge'), redirect: query.get('redirect_uri'), clientId: query.get('client_id') })
				back.searchParams.set('code', code)
			}
			response.writeHead(302, { Location: back.toString() })
			return response.end()
		}

		if(step == 'token') {
			const form = new URLSearchParams(raw)
			const basic = request.headers.authorization?.startsWith('Basic ')
			const clientId = basic
				? Buffer.from(request.headers.authorization.slice(6), 'base64').toString().split(':')[0]
				: form.get('client_id')

			if(form.get('grant_type') == 'authorization_code') {
				const code = codes.get(form.get('code'))
				codes.delete(form.get('code'))
				const challenge = createHash('sha256').update(form.get('code_verifier') ?? '').digest('base64url')
				if(!code || code.provider != provider || code.challenge != challenge || code.redirect != form.get('redirect_uri') || code.clientId != clientId)
					return send(response, 400, { error: 'invalid_grant', error_description: 'Bad code' })
				return issue(provider, response)
			}

			if(form.get('grant_type') == 'refresh_token') {
				const token = form.get('refresh_token')
				if(refreshTokens.get(token) != provider)
					return send(response, 400, { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' })
				refreshes++
				if(provider == 'airtable') {
					// Airtable gives a new refresh token each time, and the old one stops working
					refreshTokens.delete(token)
					return issue(provider, response)
				}
				const accessToken = `${provider}-access-${next++}`
				accessTokens.add(accessToken)
				return send(response, 200, { access_token: accessToken, expires_in: expiresIn, token_type: 'Bearer' })
			}
		}

		if(url.pathname.startsWith('/v4/spreadsheets/')) {
			if(!accessTokens.has(request.headers.authorization?.replace('Bearer ', '')))
				return send(response, 401, { error: { code: 401, message: 'Request had invalid authentication credentials.' } })
			const id = decodeURIComponent(url.pathname.split('/')[3].split(':')[0])
			if(onlyPicked && !picked.has(id))
				return send(response, 404, { error: { code: 404, message: 'Requested entity was not found.' } })
			const { data } = await sheets.request({
				url: 'https://sheets.googleapis.com' + request.url,
				method: request.method,
				data: raw ? JSON.parse(raw) : undefined
			})
			return send(response, 200, data)
		}

		send(response, 404, { error: 'not_found' })
	})

	await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))

	return {
		url: `http://127.0.0.1:${server.address().port}`,
		sheets,
		isValid: token => accessTokens.has(token),
		expire: () => accessTokens.clear(),
		get refreshes() {
			return refreshes
		},
		pickers,
		close: () => new Promise(resolve => {
			server.closeAllConnections()
			server.close(resolve)
		})
	}
}

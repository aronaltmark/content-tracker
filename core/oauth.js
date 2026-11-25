import { createHash, randomBytes } from 'crypto'
import { createServer } from 'http'
import { CLIENTS } from './oauth-clients.js'

const SIGN_IN_TIMEOUT = 5 * 60 * 1000
const DRIVE_FILE = 'https://www.googleapis.com/auth/drive.file'

// the store's page with Google's file picker on, which sends the choice back to this computer
export const PICKER_URL = 'https://store.generativenoise.com/tools/content-tracker/choose-spreadsheet/'
const EXPIRY_MARGIN = 60 * 1000 // refresh a minute early, so a request never goes with a stale token

export const PROVIDERS = {
	google: {
		name: 'Google',
		authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
		tokenUrl: 'https://oauth2.googleapis.com/token',
		// only the spreadsheets it's given, chosen in Google's file picker, or that it made
		scopes: ['openid', 'email', DRIVE_FILE],
		// Google lets people untick this on its consent screen, and nothing works without it
		required: { [DRIVE_FILE]: 'the spreadsheets you choose - sign in again and tick the box for them' },
		// offline for a refresh token, and consent so there's one every time; not what an older
		// version was given (all their spreadsheets), which Google warns about, as it's no longer asked for
		params: { access_type: 'offline', prompt: 'consent' },
		// Google lets a desktop app take the reply on any port
		host: '127.0.0.1',
		port: 0,
		path: '/'
	},
	airtable: {
		name: 'Airtable',
		authorizeUrl: 'https://airtable.com/oauth2/v1/authorize',
		tokenUrl: 'https://airtable.com/oauth2/v1/token',
		scopes: ['data.records:read', 'data.records:write', 'schema.bases:read', 'schema.bases:write', 'user.email:read'],
		params: {},
		// the redirect is registered with Airtable, so it can't change
		host: 'localhost',
		port: 51917,
		path: '/callback'
	}
}

/**
 * A provider with its client, as this build has it or the environment says
 * @param {string} name 'google' or 'airtable'
 * @returns {object}
 */
export function provider(name, env = process.env) {
	const base = PROVIDERS[name]
	if(!base)
		throw new Error(`There's no signing in with ${name}`)

	const key = `CONTENT_TRACKER_${name.toUpperCase()}`
	const endpoint = env.CONTENT_TRACKER_OAUTH_ENDPOINT
	return {
		...base,
		id: name,
		clientId: env[`${key}_CLIENT_ID`] || CLIENTS[name].id,
		clientSecret: env[`${key}_CLIENT_SECRET`] || CLIENTS[name].secret,
		...(endpoint && { authorizeUrl: `${endpoint}/${name}/authorize`, tokenUrl: `${endpoint}/${name}/token` })
	}
}

/**
 * @returns {boolean} whether this build can sign in with a provider
 */
export function canSignIn(name, env = process.env) {
	return Boolean(provider(name, env).clientId)
}

const base64url = buffer => buffer.toString('base64url')

// what comes back in the address goes on the page as text, never as HTML
const escape = text => String(text).replace(/[&<>"']/g, character => `&#${character.charCodeAt(0)};`)

const page = (title, text) => `<!doctype html><meta charset="utf-8"><title>${escape(title)}</title>
<body style="font:16px system-ui,sans-serif;display:grid;place-items:center;height:90vh;margin:0">
<div style="text-align:center"><h1 style="font-size:20px">${escape(title)}</h1><p>${escape(text)}</p></div>`

/**
 * Wait for the browser to come back to this computer, with a sign in's answer
 * or a spreadsheet chosen
 * @param {object} details where to listen: .host, .port, .path, and .name for what's said
 * @param {string} state what the answer has to come back with
 * @param {function} take (searchParams) => { value, title, text }: what came back, and
 * what the page says of it, or throws to say why it can't be used
 * @param {AbortSignal} signal stops waiting, as when the browser's tab was closed and it's asked again
 * @returns {Promise} .redirectUri, .answer (a Promise of the value, or of a CANCELLED error) & .close()
 */
// what waiting for the browser fails with when it's been stopped, rather than gone wrong
export const CANCELLED = 'CANCELLED'

async function listen(details, state, timeout, take, signal) {
	let settle
	const answer = new Promise((resolve, reject) => settle = { resolve, reject })
	// the answer can come back refused while the browser's still opening, before it's awaited
	answer.catch(() => {})

	const handler = (request, response) => {
		const url = new URL(request.url, 'http://localhost')
		if(url.pathname != details.path) {
			response.writeHead(404).end()
			return
		}

		const failed = (message) => {
			response.writeHead(400, { 'Content-Type': 'text/html' }).end(page(details.failed, message))
			settle.reject(new Error(message))
		}

		// anything without the state we sent didn't come from this sign in, or this choice
		if(url.searchParams.get('state') != state)
			return failed('That link has expired - try again from Content Tracker.')

		let taken
		try {
			taken = take(url.searchParams)
		}
		catch(err) {
			return failed(err.message)
		}
		response.writeHead(200, { 'Content-Type': 'text/html' }).end(page(taken.title, taken.text))
		settle.resolve(taken.value)
	}

	// localhost can mean either, depending on the computer, so both are listened on
	const hosts = details.host == 'localhost' ? ['127.0.0.1', '::1'] : [details.host]
	const servers = []
	let port = details.port
	for(const host of hosts) {
		const server = createServer(handler)
		try {
			await new Promise((resolve, reject) => server.once('error', reject).listen(port, host, resolve))
		}
		catch(err) {
			if(servers.length && err.code == 'EADDRNOTAVAIL')
				continue // no IPv6 here
			servers.forEach(server => server.close())
			if(err.code == 'EADDRINUSE')
				throw new Error(`Something else is using port ${port}, which signing in with ${details.name} needs - close it and try again`, { cause: err })
			throw err
		}
		port = server.address().port
		servers.push(server)
	}

	const timer = setTimeout(() => settle.reject(new Error(details.tooLong)), timeout)
	const cancel = () => settle.reject(Object.assign(new Error('Cancelled'), { code: CANCELLED }))
	if(signal?.aborted)
		cancel()
	signal?.addEventListener('abort', cancel, { once: true })

	return {
		redirectUri: `http://${details.host}:${port}${details.path}`,
		answer,
		close() {
			clearTimeout(timer)
			signal?.removeEventListener('abort', cancel)
			servers.forEach(server => {
				server.closeAllConnections()
				server.close()
			})
		}
	}
}

async function requestTokens(details, form, http) {
	const headers = { 'Content-Type': 'application/x-www-form-urlencoded' }
	const body = new URLSearchParams(form)

	if(details.id == 'airtable' && details.clientSecret)
		headers.Authorization = 'Basic ' + Buffer.from(`${details.clientId}:${details.clientSecret}`).toString('base64')
	else {
		body.set('client_id', details.clientId)
		if(details.clientSecret)
			body.set('client_secret', details.clientSecret)
	}

	const response = await http(details.tokenUrl, { method: 'POST', headers, body })
	const answer = await response.json().catch(() => ({}))
	if(!response.ok) {
		const error = new Error(`${details.name} said ${answer.error_description ?? answer.error ?? response.status}`)
		error.code = answer.error
		throw error
	}
	return answer
}

const tokensFrom = (answer, previous = {}) => ({
	...previous,
	accessToken: answer.access_token,
	// Google keeps the same refresh token, Airtable gives a new one each time
	refreshToken: answer.refresh_token ?? previous.refreshToken,
	expiresAt: Date.now() + (answer.expires_in ?? 3600) * 1000
})

async function accountOf(details, answer, http, env) {
	if(details.id == 'google') {
		// only shown to say who's signed in, so it needn't be verified
		const claims = answer.id_token?.split('.')[1]
		return claims ? JSON.parse(Buffer.from(claims, 'base64url').toString()).email : ''
	}

	const api = env.AIRTABLE_ENDPOINT_URL || 'https://api.airtable.com/v0'
	const response = await http(`${api}/meta/whoami`, { headers: { Authorization: `Bearer ${answer.access_token}` } })
	return response.ok ? (await response.json()).email ?? '' : ''
}

/**
 * Sign in through the browser: the provider's page is opened, and its answer
 * comes back to a server on this computer, with PKCE so only we can use it
 * @param {string} name 'google' or 'airtable'
 * @param {object} options
 * @param {function} options.openBrowser (url) => opens it
 * @param {AbortSignal} options.signal stops waiting for the browser, failing with .code CANCELLED
 * @returns {Promise} tokens to keep: .accessToken, .refreshToken, .expiresAt & .account
 */
export async function signIn(name, { openBrowser, signal, env = process.env, http = globalThis.fetch, timeout = SIGN_IN_TIMEOUT } = {}) {
	const details = provider(name, env)
	if(!details.clientId)
		throw new Error(`Signing in with ${details.name} isn't set up in this version`)

	const verifier = base64url(randomBytes(32))
	const state = base64url(randomBytes(16))
	const listening = await listen({ ...details, failed: 'Not signed in', tooLong: 'Signing in took too long - try again' }, state, timeout, params => {
		if(params.get('error'))
			throw new Error(`${details.name} said ${params.get('error_description') ?? params.get('error')}.`)
		return { value: params.get('code'), title: 'Signed in', text: 'You can close this tab and go back to Content Tracker.' }
	}, signal)

	try {
		const url = new URL(details.authorizeUrl)
		url.search = new URLSearchParams({
			client_id: details.clientId,
			redirect_uri: listening.redirectUri,
			response_type: 'code',
			scope: details.scopes.join(' '),
			state,
			code_challenge: base64url(createHash('sha256').update(verifier).digest()),
			code_challenge_method: 'S256',
			...details.params
		})

		await openBrowser(url.toString())
		const code = await listening.answer

		const answer = await requestTokens(details, {
			grant_type: 'authorization_code',
			code,
			redirect_uri: listening.redirectUri,
			code_verifier: verifier
		}, http)

		const granted = answer.scope?.split(' ')
		for(const [scope, what] of Object.entries(details.required ?? {}))
			if(granted && !granted.includes(scope))
				throw new Error(`Content Tracker wasn't given access to ${what}`)

		return { ...tokensFrom(answer), account: await accountOf(details, answer, http, env) }
	}
	finally {
		listening.close()
	}
}

/**
 * Choose a spreadsheet from Google Drive, with Google's file picker on the
 * store's page, which sends the choice back to a server on this computer.
 * Choosing it is what lets a Google sign in open it (drive.file).
 * @param {object} options
 * @param {function} options.openBrowser (url) => opens it
 * @param {string} options.account who's signed in, for Google to offer first
 * @param {AbortSignal} options.signal stops waiting for the browser, failing with .code CANCELLED
 * @returns {Promise} .id & .name of the spreadsheet, or null if none was chosen
 */
export async function chooseSpreadsheet({ openBrowser, account = '', signal, env = process.env, timeout = SIGN_IN_TIMEOUT } = {}) {
	const state = base64url(randomBytes(16))
	const details = {
		name: 'Google',
		host: '127.0.0.1',
		port: 0,
		path: '/picked',
		failed: 'No spreadsheet chosen',
		tooLong: 'Choosing a spreadsheet took too long - try again'
	}
	const listening = await listen(details, state, timeout, params => {
		if(params.get('cancelled'))
			return { value: null, title: 'No spreadsheet chosen', text: 'You can close this tab and go back to Content Tracker.' }
		const id = params.get('id') ?? ''
		if(!/^[\w-]{10,200}$/.test(id))
			throw new Error('That isn\'t a spreadsheet - try again from Content Tracker.')
		const name = params.get('name') || 'the spreadsheet'
		return { value: { id, name }, title: `Selected ${name}`, text: 'You can close this tab and go back to Content Tracker.' }
	}, signal)

	try {
		const url = new URL(env.CONTENT_TRACKER_PICKER_URL || PICKER_URL)
		url.search = new URLSearchParams({ return: listening.redirectUri, state, ...(account && { login_hint: account }) })
		await openBrowser(url.toString())
		return await listening.answer
	}
	finally {
		listening.close()
	}
}

/**
 * A sign in, as the targets use it: hands out an access token, refreshing it
 * when it's about to run out, and passes on the new tokens to be kept
 */
export class OAuthSession {
	#refreshing

	/**
	 * @param {string} name 'google' or 'airtable'
	 * @param {object} tokens from signIn()
	 * @param {object} options .onChange(tokens) to keep them when they change
	 */
	constructor(name, tokens, { onChange = () => {}, env = process.env, http = globalThis.fetch } = {}) {
		this.details = provider(name, env)
		this.tokens = tokens
		this.onChange = onChange
		this.http = http
	}

	get account() {
		return this.tokens.account
	}

	async accessToken() {
		if(Date.now() > this.tokens.expiresAt - EXPIRY_MARGIN)
			await this.refresh()
		return this.tokens.accessToken
	}

	/**
	 * Get a new access token, once however many ask at the same time, as
	 * Airtable's refresh tokens only work once
	 */
	refresh() {
		this.#refreshing ??= this.#refresh().finally(() => this.#refreshing = undefined)
		return this.#refreshing
	}

	async #refresh() {
		let answer
		try {
			answer = await requestTokens(this.details, { grant_type: 'refresh_token', refresh_token: this.tokens.refreshToken }, this.http)
		}
		catch(err) {
			if(err.code == 'invalid_grant')
				throw new Error(`Signed out of ${this.details.name} - sign in again`, { cause: err })
			throw err
		}
		this.tokens = tokensFrom(answer, this.tokens)
		await this.onChange(this.tokens)
	}
}

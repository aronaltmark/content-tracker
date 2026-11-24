import { createHash, randomBytes } from 'crypto'
import { createServer } from 'http'
import { CLIENTS } from './oauth-clients.js'

const SIGN_IN_TIMEOUT = 5 * 60 * 1000
const EXPIRY_MARGIN = 60 * 1000 // refresh a minute early, so a request never goes with a stale token

export const PROVIDERS = {
	google: {
		name: 'Google',
		authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
		tokenUrl: 'https://oauth2.googleapis.com/token',
		scopes: ['openid', 'email', 'https://www.googleapis.com/auth/spreadsheets'],
		// Google lets people untick this on its consent screen, and nothing works without it
		required: { 'https://www.googleapis.com/auth/spreadsheets': 'your spreadsheets - sign in again and tick the box for Google Sheets' },
		// offline for a refresh token, and consent so there's one every time
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

const page = (title, text) => `<!doctype html><meta charset="utf-8"><title>${title}</title>
<body style="font:16px system-ui,sans-serif;display:grid;place-items:center;height:90vh;margin:0">
<div style="text-align:center"><h1 style="font-size:20px">${title}</h1><p>${text}</p></div>`

/**
 * Wait for the browser to come back with the sign in's answer
 * @returns {Promise} .redirectUri, .code (a Promise) & .close()
 */
async function listenForCode(details, state, timeout) {
	let settle
	const code = new Promise((resolve, reject) => settle = { resolve, reject })
	// the answer can come back refused while the browser's still opening, before it's awaited
	code.catch(() => {})

	const handler = (request, response) => {
		const url = new URL(request.url, 'http://localhost')
		if(url.pathname != details.path) {
			response.writeHead(404).end()
			return
		}

		const failed = (message) => {
			response.writeHead(400, { 'Content-Type': 'text/html' }).end(page('Not signed in', message))
			settle.reject(new Error(message))
		}

		// anything without the state we sent didn't come from this sign in
		if(url.searchParams.get('state') != state)
			return failed('That sign in link has expired - try again from Content Tracker.')
		if(url.searchParams.get('error'))
			return failed(`${details.name} said ${url.searchParams.get('error_description') ?? url.searchParams.get('error')}.`)

		response.writeHead(200, { 'Content-Type': 'text/html' })
			.end(page('Signed in', 'You can close this tab and go back to Content Tracker.'))
		settle.resolve(url.searchParams.get('code'))
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

	const timer = setTimeout(() => settle.reject(new Error('Signing in took too long - try again')), timeout)

	return {
		redirectUri: `http://${details.host}:${port}${details.path}`,
		code,
		close() {
			clearTimeout(timer)
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
 * @returns {Promise} tokens to keep: .accessToken, .refreshToken, .expiresAt & .account
 */
export async function signIn(name, { openBrowser, env = process.env, http = globalThis.fetch, timeout = SIGN_IN_TIMEOUT } = {}) {
	const details = provider(name, env)
	if(!details.clientId)
		throw new Error(`Signing in with ${details.name} isn't set up in this version`)

	const verifier = base64url(randomBytes(32))
	const state = base64url(randomBytes(16))
	const listening = await listenForCode(details, state, timeout)

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
		const code = await listening.code

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

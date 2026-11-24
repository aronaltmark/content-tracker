import { promises as fs } from 'fs'
import * as os from 'os'
import * as path from 'path'

/**
 * Where the command line keeps its sign ins: with no keychain to hand, a file
 * only you can read, as gh and gcloud do
 * @returns {string} file path
 */
export function signInsFile(env = process.env) {
	if(env.CONTENT_TRACKER_SIGN_INS)
		return env.CONTENT_TRACKER_SIGN_INS
	const base = process.platform == 'win32'
		? env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming')
		: env.XDG_CONFIG_HOME ?? path.join(os.homedir(), '.config')
	return path.join(base, 'content-tracker', 'sign-ins.json')
}

/**
 * @returns {Promise} tokens by provider
 */
export async function loadSignIns(file) {
	try {
		return JSON.parse(await fs.readFile(file, 'utf8'))
	}
	catch(err) {
		if(err.code == 'ENOENT')
			return {}
		throw err
	}
}

/**
 * Keep a provider's tokens, or forget them
 * @param {object} tokens nothing to sign out
 */
export async function saveSignIn(file, name, tokens) {
	const signIns = await loadSignIns(file)
	if(tokens)
		signIns[name] = tokens
	else
		delete signIns[name]

	await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 })
	const partial = `${file}.${process.pid}.tmp`
	await fs.writeFile(partial, JSON.stringify(signIns, null, 2), { mode: 0o600 })
	await fs.rename(partial, file)
}

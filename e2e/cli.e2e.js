import { expect, test } from '@playwright/test'
import { execFile, spawn } from 'child_process'
import { promises as fs } from 'fs'
import * as os from 'os'
import * as path from 'path'
import { fakeAirtable } from './fake-airtable.mjs'
import { fakeOAuth } from './fake-google.mjs'
import { fakeReleases } from './fake-releases.mjs'

const cli = path.resolve('cli/index.js')

let root, airtable

function tracker(args, cwd = root, env = {}) {
	return new Promise(resolve => {
		execFile(process.execPath, [cli, ...args], {
			cwd,
			env: {
				...process.env,
				AIRTABLE_ENDPOINT_URL: airtable.url,
				AIRTABLE_API_KEY: 'test-token',
				HOME: root,
				LOCALAPPDATA: root,
				XDG_CACHE_HOME: root,
				// npm is never asked, unless it's what's being tried
				CONTENT_TRACKER_NO_UPDATE_CHECK: '1',
				...env
			}
		}, (err, stdout, stderr) => resolve({ code: err?.code ?? 0, output: stdout + stderr }))
	})
}

async function writeConfig(dirs, files = {}) {
	const config = path.join(root, 'test-config.json')
	await fs.writeFile(config, JSON.stringify({
		settings: {
			files: {
				rootPath: path.join(root, 'media'),
				dirs,
				frequency: 0,
				rules: { dirs: { includes: [], excludes: [] }, files: { includes: [], excludes: ['/\\.DS_Store$/'] } },
				mediaMetadata: true,
				limitToFirstFile: false,
				concurrency: 4,
				...files
			},
			airtable: { token: '', base: 'appTest', foldersTable: 'Folders', filesTable: 'Files', view: '' }
		}
	}))
	return config
}

test.beforeEach(async () => {
	root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'tracker-cli-')))
	await fs.mkdir(path.join(root, 'media/shots'), { recursive: true })
	await fs.writeFile(path.join(root, 'media/shots/notes.txt'), 'hello')
	airtable = await fakeAirtable()
})

test.afterEach(async () => {
	await airtable.close()
	await fs.rm(root, { recursive: true, force: true })
})

test('creates its tables, fills them and links them, in one run', async () => {
	const media = path.join(root, 'media')
	const { code, output } = await tracker(['-c', await writeConfig([media])])

	expect(output).not.toContain('error')
	expect(code).toBe(0)

	const folders = airtable.records('Folders')
	const [top, shots] = folders
	expect(folders.map(record => record.fields._path)).toEqual(['/', '/shots'])
	expect(shots.fields._parent).toEqual([top.id])
	expect(airtable.records('Files')[0].fields).toMatchObject({ _path: '/shots/notes.txt', _size: 5, _parent: [shots.id] })
})

test('says when there is a newer version, and how to get it', async () => {
	const releases = await fakeReleases()
	try {
		const { code, output } = await tracker(['-c', await writeConfig([path.join(root, 'media')])], root, {
			CONTENT_TRACKER_NO_UPDATE_CHECK: '',
			CI: '',
			npm_command: '',
			CONTENT_TRACKER_NPM_ENDPOINT: releases.url
		})
		expect(code).toBe(0)
		expect(output).toContain('Content Tracker 99.0.0 is out')
		expect(output).toContain('npm install -g @garethnunns/content-tracker')
	}
	finally {
		await releases.close()
	}
})

test('changes nothing on the second run', async () => {
	const config = await writeConfig([path.join(root, 'media')])
	await tracker(['-c', config])
	const writes = () => airtable.requests.filter(request => request.method != 'GET').length
	const before = writes()

	await tracker(['-c', config])
	expect(writes()).toBe(before)
})

test('a dry run writes nothing', async () => {
	const { code, output } = await tracker(['-c', await writeConfig([path.join(root, 'media')]), '-d'])
	expect(code).toBe(0)
	expect(output).toContain('[DRY RUN]')
	expect(airtable.requests.filter(request => request.method != 'GET')).toEqual([])
})

test('-nd keeps records, -nc removes them without asking', async () => {
	const config = await writeConfig([path.join(root, 'media')])
	await tracker(['-c', config])
	await fs.rm(path.join(root, 'media/shots/notes.txt'))

	await tracker(['-c', config, '-nd'])
	expect(airtable.records('Files')).toHaveLength(1)

	await tracker(['-c', config, '-nc'])
	expect(airtable.records('Files')).toHaveLength(0)
})

test('an unmounted folder removes nothing and fails for cron', async () => {
	const media = path.join(root, 'media')
	await tracker(['-c', await writeConfig([media])])
	await fs.rm(path.join(media, 'shots/notes.txt'))

	const { code } = await tracker(['-c', await writeConfig([media, path.join(root, 'unmounted')]), '-nc'])

	expect(code).toBe(1)
	expect(airtable.records('Files')).toHaveLength(1)
})

test('makes a template and leaves an existing config alone', async () => {
	const { output } = await tracker([])
	expect(output).toContain('Template config file created')
	const template = path.join(root, 'config.json')
	expect(JSON.parse(await fs.readFile(template, 'utf8')).settings.files.dirs).toEqual([root])

	await fs.writeFile(template, 'precious')
	const again = await tracker([])
	expect(again.output).toContain('already exists')
	expect(await fs.readFile(template, 'utf8')).toBe('precious')
})

test('says what is wrong with a config', async () => {
	const config = path.join(root, 'bad.json')
	await fs.writeFile(config, JSON.stringify({ settings: { files: { dirs: [] } } }))
	const { code, output } = await tracker(['-c', config])
	expect(code).toBe(2)
	expect(output).toContain('settings.files.dirs')
	expect(output).toContain('settings.airtable.base')
})

test('never prints the token', async () => {
	const { code, output } = await tracker(['-c', await writeConfig([path.join(root, 'media')]), '-l', 'silly'], root, { AIRTABLE_API_KEY: 'wrong-secret-token' })
	expect(code).toBe(1)
	expect(output).toContain('Airtable said 401')
	expect(output).not.toContain('wrong-secret-token')
})

// a command that prints where to go in the browser, and this is the browser that goes there:
// the address ends before the colour's reset code that follows it
async function inBrowser(args, env, address) {
	const command = spawn(process.execPath, [cli, ...args], { cwd: root, env })
	let output = ''
	const finished = new Promise(resolve => command.on('close', resolve))
	command.stderr.on('data', chunk => output += chunk)
	await new Promise(resolve => command.stdout.on('data', chunk => {
		output += chunk
		if(output.match(address))
			resolve()
	}))
	await fetch(output.match(address)[0].split('\u001b')[0])
	const code = await finished
	return { code, output }
}

test('signs in with Google, chooses a spreadsheet, then tracks in it', async () => {
	// a sign in only opens the spreadsheets chosen for it, as drive.file has it
	const oauth = await fakeOAuth({ onlyPicked: true })
	const env = {
		...process.env,
		BROWSER: 'none',
		HOME: root,
		XDG_CACHE_HOME: root,
		LOCALAPPDATA: root,
		CONTENT_TRACKER_SIGN_INS: path.join(root, 'sign-ins.json'),
		CONTENT_TRACKER_OAUTH_ENDPOINT: oauth.url,
		CONTENT_TRACKER_GOOGLE_CLIENT_ID: 'google-client',
		CONTENT_TRACKER_GOOGLE_CLIENT_SECRET: 'google-secret',
		CONTENT_TRACKER_PICKER_URL: `${oauth.url}/google/picker`,
		GOOGLE_SHEETS_ENDPOINT_URL: oauth.url
	}

	try {
		expect((await inBrowser(['login', 'google'], env, /https?:\/\/\S+authorize\S+/)).code).toBe(0)

		const signIns = await fs.readFile(path.join(root, 'sign-ins.json'), 'utf8')
		expect(JSON.parse(signIns).google.account).toBe('someone@example.com')
		if(process.platform != 'win32')
			expect((await fs.stat(path.join(root, 'sign-ins.json'))).mode & 0o777).toBe(0o600)

		const chose = await inBrowser(['choose-spreadsheet'], env, /https?:\/\/\S+picker\S+/)
		expect(chose.code).toBe(0)
		expect(chose.output).toContain('Selected Shots')
		expect(chose.output).toContain('picked-sheet-1234')
		expect(oauth.pickers[0].login_hint).toBe('someone@example.com')

		const config = path.join(root, 'sheets-config.json')
		await fs.writeFile(config, JSON.stringify({
			settings: {
				target: 'googleSheets',
				files: {
					rootPath: path.join(root, 'media'),
					dirs: [path.join(root, 'media')],
					frequency: 0,
					rules: { dirs: { includes: [], excludes: [] }, files: { includes: [], excludes: [] } },
					mediaMetadata: false,
					limitToFirstFile: false,
					concurrency: 4
				},
				googleSheets: { spreadsheetId: 'https://docs.google.com/spreadsheets/d/picked-sheet-1234/edit', credentials: '', foldersSheet: 'Folders', filesSheet: 'Files' }
			}
		}))

		const run = await new Promise(resolve => execFile(process.execPath, [cli, '-c', config], { cwd: root, env },
			(err, stdout, stderr) => resolve({ code: err?.code ?? 0, output: stdout + stderr })))
		expect(run.output).not.toContain('error')
		expect(run.code).toBe(0)
		expect(oauth.sheets.rows('Files').map(row => row[0])).toEqual(['_path', '/shots/notes.txt'])
		const [header, first] = oauth.sheets.rows('Files')
		expect(first[header.indexOf('_parent')]).toBe('/shots')
		expect(first[header.indexOf('_sizeText')]).toBe('5 bytes')

		await new Promise(resolve => execFile(process.execPath, [cli, 'logout', 'google'], { cwd: root, env }, resolve))
		expect(JSON.parse(await fs.readFile(path.join(root, 'sign-ins.json'), 'utf8'))).toEqual({})
	}
	finally {
		await oauth.close()
	}
})

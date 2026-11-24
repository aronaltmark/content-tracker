#!/usr/bin/env node

import confirm from '@inquirer/confirm'
import chalk from 'chalk'
import { spawn } from 'child_process'
import { Command, Option } from 'commander'
import figlet from 'figlet'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import {
	MetadataCache,
	OAuthSession,
	cacheFile,
	checkForUpdates,
	createTarget,
	howToUpdate,
	isExposed,
	isNewer,
	latestOnNpm,
	loadConfig,
	repeat,
	signIn,
	syncOnce,
	writeTemplate
} from '../core/index.js'
import { logger, setLevel } from './logger.js'
import { loadSignIns, saveSignIn, signInsFile } from './sign-ins.js'

const CONFIRM_TIMEOUT = 60 * 1000

const pjson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url)))

const program = new Command()
program
	.name('tracker')
	.version(pjson.version)
	.description(pjson.description)
	.option('-c, --config <path>', 'config file path (if none specified template will be created)')
	.option('-d, --dry-run', 'will do everything apart from updating the tracker')
	.option('-l, --logging <level>', 'set the logging level')
	.addOption(new Option('-nc, --no-confirm', 'never ask for confirmation before making large changes'))
	.addOption(new Option('-nd, --no-delete', 'never remove records'))
	.option('-w, --wipe-cache', 'clear the metadata cache')
	.action(track)

const SERVICES = ['google', 'airtable']

program.command('login')
	.description('sign in with Google or Airtable, in your browser')
	.argument('<service>', SERVICES.join(' or '))
	.action(login)

program.command('logout')
	.description('forget a sign in')
	.argument('<service>', SERVICES.join(' or '))
	.action(logout)

// this bit is really important, don't remove
console.log(chalk.cyanBright(figlet.textSync('Content Tracker')))

// alongside whatever it's doing, saying so whenever it hears back
if(checkForUpdates())
	latestOnNpm()
		.then(latest => {
			if(isNewer(latest, pjson.version))
				logger.warn('Content Tracker %s is out (this is %s) - update with: %s', latest, pjson.version, howToUpdate())
		})
		.catch(err => logger.debug('Couldn\'t check for a newer version: %s', err.message))

await program.parseAsync(process.argv)

async function track(options) {
	if(options.logging && !setLevel(options.logging))
		logger.warn('%s is not a logging level, so using the default', options.logging)

	if(!options.config)
		await createTemplate()

	const config = await openConfig(options.config)
	const cache = new MetadataCache(cacheFile(config.settings.files.dirs))

	if(options.wipeCache) {
		logger.warn('Wiping cache')
		await cache.wipe()
	}

	const signIns = signInsFile()
	const sessions = Object.fromEntries(Object.entries(await loadSignIns(signIns)).map(([name, tokens]) =>
		[name, new OAuthSession(name, tokens, { onChange: tokens => saveSignIn(signIns, name, tokens) })]))

	let target
	try {
		logger.http('Connecting to %s', config.settings.target)
		target = createTarget(config, { logger, sessions })
	}
	catch(err) {
		logger.warn('Failed to connect')
		logger.error('[%s] %s', err.name, err.message)
		process.exit(4)
	}

	let failed = false

	const { frequency } = config.settings.files
	const run = repeat(
		async () => {
			const summary = await syncOnce(config, target, {
				cache,
				dryRun: options.dryRun,
				allowDeletes: options.delete,
				confirmDeletes: options.confirm ? confirmDeletes : undefined,
				logger
			})
			failed = summary.unreadable.length > 0
			if(frequency > 0)
				logger.debug('Waiting...')
		},
		frequency,
		err => {
			failed = true
			logger.warn('Issue updating %s', config.settings.target)
			logger.error('[%s] %s', err.name, err.message)
		}
	)

	await run.done

	// so a cron job can tell something went wrong
	process.exitCode = failed ? 1 : 0
}

function service(name) {
	if(SERVICES.includes(name))
		return name
	logger.error('%s isn\'t one of %s', name, SERVICES.join(' or '))
	process.exit(2)
}

async function login(name) {
	try {
		const tokens = await signIn(service(name), { openBrowser })
		await saveSignIn(signInsFile(), name, tokens)
		logger.info('Signed in to %s as %s', name, tokens.account || 'you')
	}
	catch(err) {
		logger.error('%s', err.message)
		process.exitCode = 1
	}
}

async function logout(name) {
	await saveSignIn(signInsFile(), service(name), undefined)
	logger.info('Signed out of %s', name)
}

function openBrowser(url) {
	logger.info('Sign in in your browser - if it hasn\'t opened, go to:\n%s', url)

	// BROWSER=none, as other tools have it, for where there's no browser to open
	if(process.env.BROWSER == 'none')
		return

	// no shell, so nothing in the address is run
	const [command, args] = {
		darwin: ['open', [url]],
		win32: ['rundll32', ['url.dll,FileProtocolHandler', url]]
	}[process.platform] ?? ['xdg-open', [url]]
	spawn(command, args, { stdio: 'ignore', detached: true }).on('error', () => {}).unref()
}

async function createTemplate() {
	try {
		if(await writeTemplate('config.json', process.cwd()))
			logger.warn('Template config file created - please update with your settings, then re-run with -c <path>')
		else
			logger.warn('config.json already exists, so left it alone - re-run with -c config.json')
		process.exit(0)
	}
	catch(err) {
		logger.warn('Failed to create template config file')
		logger.error('[%s] %s', err.name, err.message)
		process.exit(1)
	}
}

async function openConfig(file) {
	try {
		const opened = await loadConfig(file)
		if(isExposed(file, JSON.parse(readFileSync(file, 'utf8'))))
			logger.warn('Other users on this computer can read %s, which has a token in it - chmod 600 it, or use AIRTABLE_API_KEY', resolve(file))
		return opened
	}
	catch(err) {
		logger.warn('Failed to load config file')
		logger.error('[%s] %s', err.name, err.message)
		process.exit(2)
	}
}

async function confirmDeletes({ table, count }) {
	// run by cron or the like, there's no one to ask, so it's no rather than a minute's wait
	if(!process.stdin.isTTY) {
		logger.warn('Not removing the %d %s, as there\'s no one to ask - run with -nc to allow it', count, table)
		return false
	}

	const answer = confirm({ message: `Would you like to remove the ${count} ${table}?` })

	let timer
	const timeout = new Promise(resolve => {
		timer = setTimeout(() => {
			logger.info('Confirm timed out')
			answer.cancel()
			resolve(false)
		}, CONFIRM_TIMEOUT)
	})

	const confirmed = await Promise.race([answer, timeout]).catch(() => false)
	clearTimeout(timer)
	return confirmed
}

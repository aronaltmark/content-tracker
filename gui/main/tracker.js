import { EventEmitter } from 'events'
import { format } from 'util'
import { MetadataCache, cacheFile, createTarget, prepareConfig, repeat, syncOnce } from '../../core/index.js'

const MAX_LOG = 500
const SHOWN_LEVELS = ['error', 'warn', 'info', 'http']

/**
 * Runs the tracker for the app. Emits 'log' with each line, and 'state' with
 * the state whenever it changes.
 */
export class TrackerController extends EventEmitter {
	log = []
	items = { folders: [], files: [], dryRun: false }
	#watching

	state = {
		running: false,
		watching: false,
		lastRun: null
	}

	/**
	 * @param {function} getConfig () => the config, with its token
	 * @param {function} confirmDeletes as syncOnce()
	 * @param {function} getSessions () => the sign ins, by provider
	 */
	constructor(getConfig, confirmDeletes, getSessions = () => ({})) {
		super()
		this.getConfig = getConfig
		this.confirmDeletes = confirmDeletes
		this.getSessions = getSessions

		const line = level => (message, ...args) => {
			if(!SHOWN_LEVELS.includes(level))
				return
			const entry = { level, message: format(message, ...args), time: Date.now() }
			this.log.push(entry)
			this.log.splice(0, this.log.length - MAX_LOG)
			this.emit('log', entry)
		}
		this.logger = Object.fromEntries(['error', 'warn', 'info', 'http', 'verbose', 'debug', 'silly'].map(level => [level, line(level)]))
	}

	#setState(changes) {
		this.state = { ...this.state, ...changes }
		this.emit('state', this.state)
	}

	async #sync(dryRun, config) {
		// a tick of the watch can land during a run the user asked for
		if(this.state.running)
			return

		this.#setState({ running: true })

		try {
			const target = createTarget(config, { logger: this.logger, sessions: this.getSessions() })
			const summary = await syncOnce(config, target, {
				cache: new MetadataCache(cacheFile(config.settings.files.dirs)),
				dryRun,
				confirmDeletes: this.confirmDeletes,
				logger: this.logger
			})
			// the list is kept apart from the state, which goes to the page at every change
			const { items, ...rest } = summary
			this.items = { ...items, dryRun }
			this.emit('items', this.items)
			this.#setState({ lastRun: { time: Date.now(), summary: rest } })
		}
		catch(err) {
			this.logger.error('%s', err.message)
			this.#setState({ lastRun: { time: Date.now(), error: err.message } })
		}
		finally {
			this.#setState({ running: false })
		}
	}

	/**
	 * Run the once
	 * @param {boolean} dryRun whether to leave the target as it is
	 */
	async run(dryRun = false) {
		await this.#sync(dryRun, prepareConfig(this.getConfig()))
	}

	/**
	 * Keep running at the config's frequency, until stopped
	 */
	async start() {
		if(this.#watching)
			return

		const frequency = Math.max(prepareConfig(this.getConfig()).settings.files.frequency, 1)

		this.#setState({ watching: true })
		// the settings save as they're changed, so each run takes them as they are then
		this.#watching = repeat(() => {
			let config
			try {
				config = prepareConfig(this.getConfig())
			}
			catch(err) {
				this.logger.error('%s', err.message)
				this.#setState({ lastRun: { time: Date.now(), error: err.message } })
				return
			}
			return this.#sync(false, config)
		}, frequency)
	}

	async stop() {
		if(!this.#watching)
			return

		this.#watching.stop()
		await this.#watching.done
		this.#watching = undefined
		this.#setState({ watching: false })
	}
}

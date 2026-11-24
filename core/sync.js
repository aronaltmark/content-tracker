import { diffRecords } from './diff.js'
import { FoundTimes, MetadataCache, cacheFile, foundFile } from './cache.js'
import { silentLogger } from './logger.js'
import { scan } from './scanner.js'

// removing more than this share of a table gets confirmed first
const CONFIRM_SHARE = 0.1

const empty = () => ({ inserted: 0, updated: 0, deleted: 0 })

/**
 * Bring a target up to date with the local files once
 * @param {object} config prepared config
 * @param {object} target from createTarget()
 * @param {object} options
 * @param {MetadataCache} options.cache
 * @param {boolean} options.dryRun do everything apart from changing the target
 * @param {boolean} options.allowDeletes whether records can be removed
 * @param {function} options.confirmDeletes ({ table, count, total }) => Promise of
 * whether to go ahead with a big delete. Without one they aren't confirmed.
 * @param {object} options.logger
 * @returns {Promise} summary of what was found & done
 */
export async function syncOnce(config, target, {
	cache = new MetadataCache(cacheFile(config.settings.files.dirs)),
	found = new FoundTimes(foundFile(config.settings.files.dirs)),
	dryRun = false,
	allowDeletes = true,
	confirmDeletes,
	logger = silentLogger
} = {}) {
	// the config's settings, which a run's own options can only turn off
	const removing = config.settings.removing ?? {}
	if(removing.enabled === false)
		allowDeletes = false
	if(removing.confirm === false)
		confirmDeletes = undefined

	await cache.load()
	await found.load()

	logger.verbose('Scanning folders')
	const scanned = await scan(config.settings.files, { cache, logger })
	logger.info('Found %d folders & %d files', scanned.folders.length, scanned.files.length)

	try {
		await cache.save()
	}
	catch(err) {
		logger.warn('Failed to store the metadata cache')
		logger.error('[%s] %s', err.name, err.message)
	}

	const trackFolders = config.settings.files.trackFolders !== false
	const summary = {
		dryRun,
		found: { folders: trackFolders ? scanned.folders.length : 0, files: scanned.files.length },
		unreadable: scanned.errors,
		folders: empty(),
		files: empty(),
		// what's tracked and how it's changed, for the app to list
		items: { folders: [], files: [] }
	}

	// only bother doing this if we found any files
	if(!scanned.folders.length)
		return summary

	if(scanned.errors.length && allowDeletes) {
		// anything inside what we couldn't read would look like it's been removed
		logger.warn('Not removing anything this time as %d paths could not be read', scanned.errors.length)
		allowDeletes = false
	}

	const reconcile = async (table, diffs, total) => {
		if(!allowDeletes)
			diffs.deletes = []

		logDiffs(logger, table, diffs, dryRun)

		if(dryRun) {
			summary[table] = {
				inserted: diffs.inserts.length,
				updated: diffs.updates.length,
				deleted: diffs.deletes.length
			}
			return
		}

		if(confirmDeletes && diffs.deletes.length > total * CONFIRM_SHARE) {
			logger.warn('This will remove over 10%% of %s', table)
			const count = diffs.deletes.length
			if(!await confirmDeletes({ table, count, total }))
				diffs.deletes = []
		}

		const done = await target.apply(table, diffs, logger)
		for(const key in done)
			summary[table][key] += done[key]
		logger.info('%s: %d added, %d updated & %d deleted', table, done.inserted, done.updated, done.deleted)
	}

	await target.prepare({ dryRun })

	logger.http('Fetching the folder & file lists')
	let remoteFolders = trackFolders ? await target.fetch('folders') : []
	const remoteFiles = await target.fetch('files')

	logger.verbose('Consoling the differences between the local file system and the target')
	const folderDiffs = diffRecords(scanned.folders, remoteFolders, parentResolver(target, remoteFolders))
	if(trackFolders) {
		await reconcile('folders', folderDiffs, remoteFolders.length)
		summary.items.folders = itemsOf('folders', scanned.folders, folderDiffs, found)
	}

	if(trackFolders && folderDiffs.inserts.length && !dryRun) {
		// the new folders have IDs now, so link them up
		remoteFolders = await target.fetch('folders')
		const links = diffRecords(scanned.folders, remoteFolders, parentResolver(target, remoteFolders))
		links.deletes = []
		await reconcile('folders', links, remoteFolders.length)
	}

	const fileDiffs = diffRecords(scanned.files, remoteFiles, trackFolders ? parentResolver(target, remoteFolders) : null)
	await reconcile('files', fileDiffs, remoteFiles.length)
	summary.items.files = itemsOf('files', scanned.files, fileDiffs, found)

	try {
		// a drive that's gone for a run hasn't lost what was on it
		await found.save({ prune: !scanned.errors.length })
	}
	catch(err) {
		logger.warn('Failed to store when things were found')
		logger.error('[%s] %s', err.name, err.message)
	}

	return summary
}

// what the app's list shows of each, from its fields
const itemOf = (fields, status, found) => ({
	path: fields._path,
	status,
	found: found ?? '',
	size: fields._size ?? 0,
	modified: fields._mtime ?? '',
	items: fields._items,
	duration: fields._duration,
	codec: fields._videoCodec || fields._audioCodec || '',
	width: fields._videoWidth,
	height: fields._videoHeight
})

/**
 * Everything in a table, as it is after a run, and what the run did to it
 * @param {FoundTimes} found when each was first found, stamped now for what's new
 * @returns {array} of { path, status, found, size, modified, ... }, status being new, modified, deleted or same
 */
function itemsOf(table, locals, diffs, found) {
	const status = new Map([
		...diffs.inserts.map(fields => [fields._path, 'new']),
		...diffs.updates.map(update => [update.fields._path, 'modified'])
	])
	const items = [
		...locals.map(({ fields }) => itemOf(fields, status.get(fields._path) ?? 'same', found.stamp(`${table}:${fields._path}`))),
		...diffs.deletes.map(({ fields }) => itemOf(fields, 'deleted', found.get(`${table}:${fields._path}`)))
	]
	return items.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
}

function parentResolver(target, remoteFolders) {
	const byPath = new Map(remoteFolders.map(folder => [folder.fields._path, folder]))
	return parentPath => target.parentValue(byPath.get(parentPath))
}

function logDiffs(logger, table, diffs, dryRun) {
	const pre = dryRun ? '[DRY RUN] - ' : ''
	logger.info(pre + '%s - %d to add, %d to update & %d to delete', table, diffs.inserts.length, diffs.updates.length, diffs.deletes.length)

	if(dryRun) {
		diffs.inserts.forEach(fields => logger.debug('to insert: %s', fields._path))
		diffs.updates.forEach(update => logger.debug('to update: %s', update.fields._path))
	}
	diffs.deletes.forEach(record => logger.debug('to delete: %s', record.fields._path))
}

/**
 * Keep running something until it's stopped, waiting between each one
 * @param {function} run async, its failures are passed to onError & it's run again
 * @param {number} frequency seconds between runs, 0 for just the once
 * @param {function} onError
 * @returns {object} .stop(), and .done, a Promise of when it has finished
 */
export function repeat(run, frequency, onError = () => {}) {
	let stopped = false
	let wake = () => {}

	const loop = async () => {
		do {
			try {
				await run()
			}
			catch(err) {
				onError(err)
			}

			if(frequency > 0 && !stopped)
				await new Promise(resolve => {
					const timer = setTimeout(resolve, frequency * 1000)
					wake = () => {
						clearTimeout(timer)
						resolve()
					}
				})
		} while(frequency > 0 && !stopped)
	}

	return {
		done: loop(),
		stop() {
			stopped = true
			wake()
		}
	}
}

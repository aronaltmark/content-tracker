import { AirtableTarget } from './airtable.js'
import { GoogleSheetsTarget } from './google-sheets.js'

/**
 * Connect to where a config tracks its files. Every target has:
 * - .prepare({ dryRun }) creates any tables & columns that are missing
 * - .fetch(table) gets the records of 'folders' or 'files'
 * - .apply(table, diffs) makes the changes, returning how many
 * - .parentValue(folder) what a record's _parent holds for that remote folder
 * - .name() the base's or spreadsheet's name, to show rather than its ID
 * @param {object} config prepared config
 * @param {object} options passed to the target, with .sessions, the sign ins by provider
 * @returns {object} target
 */
export function createTarget(config, { sessions = {}, ...options } = {}) {
	const { settings } = config
	const context = { ...options, mediaMetadata: settings.files.mediaMetadata, trackFolders: settings.files.trackFolders !== false }

	if(settings.target == 'googleSheets')
		return new GoogleSheetsTarget(settings.googleSheets, { ...context, session: sessions.google })
	return new AirtableTarget(settings.airtable, { ...context, session: sessions.airtable })
}

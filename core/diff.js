import { isDeepStrictEqual } from 'util'

/**
 * Work out what needs doing to a table to make it match what's on disk
 * @param {array} locals list of { fields, parentPath } from the scan
 * @param {array} remotes list of { id, fields } from the target
 * @param {function} parentValue (parentPath) => the value of its _parent field, or null for no _parent
 * @returns {object} .inserts (fields), .updates ({ id, fields }) & .deletes ({ id, fields })
 */
export function diffRecords(locals, remotes, parentValue) {
	const unmatched = new Map()
	const deletes = []

	for(const remote of remotes)
		if(unmatched.has(remote.fields._path))
			deletes.push(remote) // the same path twice, so one of them has to go
		else
			unmatched.set(remote.fields._path, remote)

	const inserts = []
	const updates = []

	for(const local of locals) {
		const fields = { ...local.fields, _parent: parentValue?.(local.parentPath) }
		if(!parentValue)
			delete fields._parent
		const remote = unmatched.get(fields._path)

		if(!remote) {
			inserts.push(fields)
			continue
		}

		unmatched.delete(fields._path)

		// other fields in the table are the user's own, so only ours count
		const changed = Object.keys(fields).some(key => !isDeepStrictEqual(fields[key], remote.fields[key]))
		if(changed)
			updates.push({ id: remote.id, fields })
	}

	return { inserts, updates, deletes: [...deletes, ...unmatched.values()] }
}

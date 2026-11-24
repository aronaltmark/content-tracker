import { createServer } from 'http'

/**
 * A stand-in for Airtable, holding what real Airtable would refuse so the
 * tests fail the way the real thing would. Reach it with AIRTABLE_ENDPOINT_URL.
 * @param {object} options .token it takes, .accepts(token) for others, like a sign in's,
 * .email who's signed in & .bases they can reach
 * @returns {Promise} .url, .tables, .requests & .close()
 */
export async function fakeAirtable({ token = 'test-token', accepts = () => false, email = 'someone@example.com', bases = [{ id: 'appTest', name: 'Show content' }] } = {}) {
	const tables = []
	const requests = []
	let nextId = 1

	const id = prefix => prefix + String(nextId++).padStart(14, '0')
	const send = (response, status, body) => {
		response.writeHead(status, { 'Content-Type': 'application/json' })
		response.end(JSON.stringify(body))
	}
	const table = key => tables.find(table => table.id == key || table.name == key)
	const refuse = (response, message) => send(response, 422, { error: { type: 'INVALID', message } })

	function addField(owner, field) {
		owner.fields.push({ id: id('fld'), ...field })
		if(field.type == 'multipleRecordLinks' && field.options?.linkedTableId === undefined)
			throw new Error('links need a table')
	}

	const server = createServer(async (request, response) => {
		const url = new URL(request.url, 'http://localhost')
		let raw = ''
		for await (const chunk of request)
			raw += chunk
		const body = raw ? JSON.parse(raw) : undefined

		requests.push({ method: request.method, path: url.pathname })

		const given = request.headers.authorization?.replace('Bearer ', '')
		if(given != token && !accepts(given))
			return send(response, 401, { error: { type: 'AUTHENTICATION_REQUIRED' } })

		if(url.pathname == '/meta/whoami')
			return send(response, 200, { id: 'usr1', email })

		if(url.pathname == '/meta/bases')
			return send(response, 200, { bases: bases.map(base => ({ ...base, permissionLevel: 'create' })) })

		const meta = url.pathname.match(/^\/meta\/bases\/[^/]+\/tables(?:\/([^/]+)\/fields)?$/)
		if(meta) {
			if(meta[1]) {
				addField(table(meta[1]), body)
				return send(response, 200, body)
			}
			if(request.method == 'GET')
				return send(response, 200, { tables })

			if(body.fields[0].type != 'singleLineText')
				return refuse(response, 'The primary field must be text')
			const created = { id: id('tbl'), name: body.name, fields: [], views: [{ id: id('viw'), name: 'Grid view' }], records: [] }
			body.fields.forEach(field => addField(created, field))
			tables.push(created)
			return send(response, 200, created)
		}

		const records = url.pathname.match(/^\/[^/]+\/([^/]+)$/)
		const owner = records && table(decodeURIComponent(records[1]))
		if(!owner)
			return send(response, 404, { error: 'NOT_FOUND' })

		const names = owner.fields.map(field => field.name)
		const wrote = list => {
			if(list.length > 10)
				return 'Too many records'
			const unknown = list.flatMap(record => Object.keys(record.fields)).find(name => !names.includes(name))
			return unknown && `Unknown field name: ${unknown}`
		}

		switch(request.method) {
			case 'GET': {
				const unknown = url.searchParams.getAll('fields[]').find(name => !names.includes(name))
				if(unknown)
					return refuse(response, `Unknown field name: ${unknown}`)

				// blanks are left out, as Airtable does
				const shown = owner.records.map(({ id, fields }) => ({
					id,
					fields: Object.fromEntries(Object.entries(fields).filter(([, value]) =>
						value !== '' && value !== false && !(Array.isArray(value) && !value.length)))
				}))
				return send(response, 200, { records: shown })
			}
			case 'POST': {
				const problem = wrote(body.records)
				if(problem)
					return refuse(response, problem)
				const created = body.records.map(({ fields }) => ({ id: id('rec'), fields }))
				owner.records.push(...created)
				return send(response, 200, { records: created })
			}
			case 'PATCH': {
				const problem = wrote(body.records)
				if(problem)
					return refuse(response, problem)
				for(const { id, fields } of body.records)
					Object.assign(owner.records.find(record => record.id == id).fields, fields)
				return send(response, 200, { records: body.records })
			}
			case 'DELETE': {
				const ids = url.searchParams.getAll('records[]')
				if(ids.length > 10)
					return refuse(response, 'Too many records')
				owner.records = owner.records.filter(record => !ids.includes(record.id))
				return send(response, 200, { records: ids.map(id => ({ id, deleted: true })) })
			}
		}
	})

	await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))

	return {
		url: `http://127.0.0.1:${server.address().port}`,
		tables,
		requests,
		records: name => table(name).records,
		close: () => new Promise(resolve => {
			server.closeAllConnections()
			server.close(resolve)
		})
	}
}

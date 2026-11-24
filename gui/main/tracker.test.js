import { describe, expect, it, vi } from 'vitest'
import { TrackerController } from './tracker.js'

const config = (dirs = ['/nowhere']) => ({
	settings: {
		target: 'airtable',
		files: {
			dirs,
			frequency: 1,
			rules: { dirs: { includes: [], excludes: [] }, files: { includes: [], excludes: [] } },
			mediaMetadata: false,
			limitToFirstFile: false,
			concurrency: 1
		},
		airtable: { token: 'token', base: 'appBase', foldersTable: 'Folders', filesTable: 'Files', view: '' }
	}
})

describe('tracker controller', () => {
	it('will not start a run on top of another', async () => {
		const started = vi.fn()
		const tracker = new TrackerController(() => config())
		let wasRunning = false
		tracker.on('state', state => {
			if(state.running && !wasRunning)
				started()
			wasRunning = state.running
		})

		await Promise.all([tracker.run(), tracker.run()])

		expect(started).toHaveBeenCalledTimes(1)
		expect(tracker.state.running).toBe(false)
	})

	it('keeps a run failing to itself', async () => {
		const tracker = new TrackerController(() => ({ settings: {} }))
		await expect(tracker.run()).rejects.toThrow('Invalid config')
		expect(tracker.state.running).toBe(false)
	})

	it('stops watching', async () => {
		const tracker = new TrackerController(() => config())
		await tracker.start()
		expect(tracker.state.watching).toBe(true)
		await tracker.stop()
		expect(tracker.state).toMatchObject({ watching: false, running: false })
	})
})

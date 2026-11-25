import { describe, expect, it } from 'vitest'
import { COMPATIBLE, licences } from './licences.mjs'

describe('licences', () => {
	const list = licences()

	it('lists what the app ships, with Electron and what the page bundles', () => {
		const names = list.map(entry => entry.name)
		expect(names).toEqual(expect.arrayContaining(['electron', 'vue', 'marked', 'picomatch']))
		expect(names).not.toContain('vitest')
		expect(names).not.toContain('@vue/compiler-sfc')
	})

	it('only lists ffprobe for the platform it\'s built for', () => {
		const names = licences(undefined, 'win32').map(entry => entry.name)
		expect(names).toContain('@generativenoise/ffprobe-win32-x64')
		expect(names).not.toContain('@generativenoise/ffprobe-darwin-arm64')
	})

	it('ships nothing the GPL can\'t include', () => {
		const incompatible = list.filter(entry => !COMPATIBLE.includes(entry.licence))
		expect(incompatible, 'check these can be shipped with GPL 3 code').toEqual([])
	})
})

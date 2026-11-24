import { readFileSync } from 'fs'
import { describe, expect, it } from 'vitest'
import { withHelp } from './readme-help.mjs'

const read = name => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8')

describe('readme', () => {
	it('has the app\'s Help in it, as it is now', () => {
		const readme = read('README.md')
		expect(withHelp(readme, read('docs/help.md')), 'run npm run readme').toBe(readme)
	})

	it('links to its own sections on the page', () => {
		const readme = withHelp('a\n<!-- docs/help.md, the app\'s Help: change it there, then npm run readme -->\nold\n<!-- end of docs/help.md -->\nb', '[x](https://github.com/garethnunns/content-tracker#tables)')
		expect(readme).toContain('[x](#tables)')
		expect(readme).not.toContain('old')
	})
})

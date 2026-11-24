const START = '<!-- docs/help.md, the app\'s Help: change it there, then npm run readme -->'
const END = '<!-- end of docs/help.md -->'

/**
 * The README with the help between its markers, its links to the README made
 * links on the page
 * @param {string} readme
 * @param {string} help
 * @returns {string}
 */
export function withHelp(readme, help) {
	const start = readme.indexOf(START)
	const end = readme.indexOf(END)
	if(start < 0 || end < start)
		throw new Error('The README has lost its markers for the help')

	const local = help.trim().replaceAll('https://github.com/garethnunns/content-tracker#', '#')
	return readme.slice(0, start) + `${START}\n\n${local}\n\n` + readme.slice(end)
}

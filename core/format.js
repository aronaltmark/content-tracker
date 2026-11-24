// How things are written for people, kept apart so the app's page can use them too

const UNITS = ['KB', 'MB', 'GB', 'TB', 'PB']
// the Finder's decimal places for each, which it drops when they're 0
const PLACES = [0, 1, 2, 2, 2]

/**
 * A size as the Mac's Finder writes it: in 1000s, not 1024s, like 36 KB, 1.2 MB or 1.84 GB
 * @param {number} bytes
 * @returns {string}
 */
export function finderSize(bytes) {
	if(!bytes)
		return 'Zero bytes'
	if(bytes < 1000)
		return `${bytes} ${bytes == 1 ? 'byte' : 'bytes'}`

	let unit = 0
	let value = bytes / 1000
	// rounding up can make it the next unit, as 999,999 bytes is 1 MB, not 1000 KB
	while(unit < UNITS.length - 1 && Number(value.toFixed(PLACES[unit])) >= 1000) {
		value /= 1000
		unit++
	}
	return `${Number(value.toFixed(PLACES[unit]))} ${UNITS[unit]}`
}

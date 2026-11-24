export const delay = ms => new Promise(resolve => setTimeout(resolve, ms))

/**
 * Split a list into smaller lists
 * @param {array} list
 * @param {number} size most in each
 * @returns {array} of lists
 */
export function chunks(list, size) {
	const result = []
	for(let i = 0; i < list.length; i += size)
		result.push(list.slice(i, i + size))
	return result
}

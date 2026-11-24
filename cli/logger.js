import winston from 'winston'
const { combine, timestamp, printf, splat } = winston.format

const color = {
	error: '\x1b[31m', // red
	warn: '\x1b[43m', // yellow bg
	info: '\x1b[32m', // green
	http: '\x1b[35m', // magenta
	verbose: '\x1b[44m', // blue
	debug: '\x1b[34m', // blue bg
	silly: '\x1b[37m' // white
}

const consoleTransport = new winston.transports.Console({
	level: 'http',
	format: combine(
		splat(),
		timestamp({
			format: 'YYYY-MM-DD hh:mm:ss A'
		}),
		printf(({ level, message, timestamp }) => {
			return `[${timestamp}] ${color[level] || ''}${level}: ${typeof(message) == 'string' ? message : JSON.stringify(message, null, 4)}\x1b[0m`
		})
	)
})

export const logger = winston.createLogger({ transports: [consoleTransport] })

/**
 * @param {string} level one of the logger's levels
 * @returns {boolean} whether it was one
 */
export function setLevel(level) {
	if(!(level in logger.levels))
		return false
	consoleTransport.level = level
	return true
}

// core never prints anything, it logs to what it's given, printf style

const levels = ['error', 'warn', 'info', 'http', 'verbose', 'debug', 'silly']

export const silentLogger = Object.fromEntries(levels.map(level => [level, () => {}]))

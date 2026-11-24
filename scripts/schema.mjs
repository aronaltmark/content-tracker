// Writes core/config.schema.json, which editors use to help write a config, from
// core/config-schema.js. Run again after changing it: npm run schema
import { writeFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { configSchema } from '../core/config-schema.js'

writeFileSync(fileURLToPath(new URL('../core/config.schema.json', import.meta.url)), JSON.stringify(configSchema, null, 2) + '\n')

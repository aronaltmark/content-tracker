// Puts docs/help.md, the app's Help, into the README's App section, so they're
// written once. Run again after changing it: npm run readme
import { readFileSync, writeFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { withHelp } from './readme-help.mjs'

const file = name => fileURLToPath(new URL(`../${name}`, import.meta.url))

writeFileSync(file('README.md'), withHelp(readFileSync(file('README.md'), 'utf8'), readFileSync(file('docs/help.md'), 'utf8')))

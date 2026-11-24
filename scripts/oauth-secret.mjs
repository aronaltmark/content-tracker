// Writes core/oauth-secret.js, which git ignores, with Google's client secret from
// GOOGLE_CLIENT_SECRET. Run by npm install, and by the release with the repository's
// secret. Without one it keeps the file there is, or writes an empty secret, which
// signs in only with CONTENT_TRACKER_GOOGLE_CLIENT_SECRET set.
import { existsSync, writeFileSync } from 'fs'
import { fileURLToPath } from 'url'

const file = fileURLToPath(new URL('../core/oauth-secret.js', import.meta.url))
const secret = process.env.GOOGLE_CLIENT_SECRET

if(secret || !existsSync(file))
	writeFileSync(file, `// written by scripts/oauth-secret.mjs - not in git\nexport const GOOGLE_CLIENT_SECRET = ${JSON.stringify(secret ?? '')}\n`)

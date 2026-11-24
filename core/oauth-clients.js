// The app as it's registered with Google and Airtable, under Generative Noise.
// These go out with every copy, so they aren't secrets: Google says as much of
// a desktop app's client secret, and what keeps signing in safe is PKCE and
// the redirect coming back to this computer. Google's is still kept out of git,
// as Google may reset a secret it's told was published: it's in oauth-secret.js,
// which npm install writes (scripts/oauth-secret.mjs).
import { GOOGLE_CLIENT_SECRET } from './oauth-secret.js'

export const CLIENTS = {
	google: { id: '753051243527-0mntag98touvkaafcb8trj2219aa0ddh.apps.googleusercontent.com', secret: GOOGLE_CLIENT_SECRET },
	airtable: { id: '3ddde0e8-7ae1-405d-8f5a-467a7873a633', secret: '' }
}

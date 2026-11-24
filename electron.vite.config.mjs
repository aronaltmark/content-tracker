import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import vue from '@vitejs/plugin-vue'
import { licences } from './scripts/licences.mjs'

// Vite's hot reloading needs a websocket, which the built app has no use for
const contentSecurityPolicy = {
	name: 'content-security-policy',
	transformIndexHtml(html, { server }) {
		return html.replace('%CONNECT%', server ? "'self' ws:" : "'none'")
	}
}

// what the app ships that isn't ours, for About, from package-lock.json as it's built
const licenceList = {
	name: 'licences',
	resolveId: id => id == 'virtual:licences' ? '\0virtual:licences' : undefined,
	load: id => id == '\0virtual:licences' ? `export default ${JSON.stringify(licences())}` : undefined
}

export default defineConfig({
	main: {
		build: {
			outDir: 'out/main',
			lib: { entry: 'gui/main/index.js' }
		}
	},
	preload: {
		build: {
			outDir: 'out/preload',
			lib: { entry: 'gui/preload/index.js' },
			// a sandboxed preload has to be CommonJS
			rollupOptions: { output: { format: 'cjs', entryFileNames: '[name].cjs' } }
		}
	},
	renderer: {
		root: 'gui/renderer',
		plugins: [vue(), contentSecurityPolicy, licenceList],
		build: {
			outDir: 'out/renderer',
			// absolute, as the dev server reads it from the renderer's root and the build from here
			rollupOptions: { input: resolve(import.meta.dirname, 'gui/renderer/index.html') }
		}
	}
})

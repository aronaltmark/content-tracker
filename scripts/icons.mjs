// Renders build/icon.svg as build/icon.png, which electron-builder makes the
// Mac & Windows icons from, and build/tray.svg as the menu bar's icon at 1x
// and 2x, after writing the folder's outline into both (scripts/icon-outline.mjs). Run
// again after changing either SVG or the outline: npm run icons
import { readFileSync, writeFileSync } from 'fs'
import { fileURLToPath } from 'url'
import sharp from 'sharp'
import { folderOutline } from './icon-outline.mjs'

const file = name => fileURLToPath(new URL(`../build/${name}`, import.meta.url))

// the folder's outline first, worked out afresh, into both SVGs
const outline = folderOutline()
for(const [name, path] of [['icon.svg', /(<path id="squircle" d=")[^"]+(")/], ['tray.svg', /(<path fill="none"[^>]* d=")[^"]+(")/]]) {
	const svg = readFileSync(file(name), 'utf8')
	if(!path.test(svg))
		throw new Error(`Can't find the folder's outline in ${name}`)
	writeFileSync(file(name), svg.replace(path, (match, before, after) => before + outline + after))
}

// the SVGs' widths in their own units
const ICON = 76
const TRAY = 70

await sharp(file('icon.svg'), { density: 1024 / ICON * 72 })
	.resize(1024, 1024)
	.png()
	.toFile(file('icon.png'))

// square, as the folder is. 'Template' in the name is how the Mac knows to colour it for a light or dark menu bar
for(const [scale, suffix] of [[1, ''], [2, '@2x']])
	await sharp(file('tray.svg'), { density: 18 * scale / TRAY * 72 * 4 })
		.resize(18 * scale, 18 * scale)
		.png()
		.toFile(file(`trayTemplate${suffix}.png`))

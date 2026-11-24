// Renders build/icon.svg as build/icon.png, which electron-builder makes the
// Mac & Windows icons from, and build/tray.svg as the menu bar's icon at 1x
// and 2x. Run again after changing either SVG: npm run icons
import { fileURLToPath } from 'url'
import sharp from 'sharp'

const file = name => fileURLToPath(new URL(`../build/${name}`, import.meta.url))

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

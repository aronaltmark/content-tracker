// The folder the icon's drawn as: the plugins' squircle (a superellipse, n=5),
// with its top stepping down after a small tab, as the Finder's folder has it.
// npm run icons writes it into build/icon.svg and build/tray.svg, which share it:
// change the shape here, not in the SVGs.

export const SHAPE = {
	half: 32, // the squircle's half width, in the SVGs' units, centred on 32,32
	n: 5, // the superellipse's power, the plugins' squircle's
	tab: 6, // how far the top steps down after the tab
	tabEnd: 16, // where the step down starts, across the top
	bodyStart: 30, // and where it's reached the rest of the top
	spacing: 0.35 // between the points written out
}

// leaves the tab and meets the top flat, so there's no corner at either end
function smootherstep(from, to, x) {
	const t = Math.min(1, Math.max(0, (x - from) / (to - from)))
	return t * t * t * (t * (t * 6 - 15) + 10)
}

/**
 * The outline as an SVG path, its points evenly along it, so the flat top and the
 * tab's slope get as many as the corners do
 * @returns {string} d of a path
 */
export function folderOutline({ half, n, tab, tabEnd, bodyStart, spacing } = SHAPE) {
	const steps = 20000
	const curve = []
	for(let i = 0; i < steps; i++) {
		const angle = 2 * Math.PI * i / steps
		const u = Math.sign(Math.cos(angle)) * Math.abs(Math.cos(angle)) ** (2 / n)
		const v = Math.sign(Math.sin(angle)) * Math.abs(Math.sin(angle)) ** (2 / n)
		const x = 32 + half * u
		let y = 32 + half * v
		if(v < 0) {
			// the top: the tab's own height to the left, stepping down to the body's
			const step = smootherstep(tabEnd, bodyStart, x)
			y = (1 - step) * y + step * (32 + (half - tab) * v)
		}
		curve.push([x, y])
	}

	const points = [curve[0]]
	let run = 0
	for(let i = 1; i < curve.length; i++) {
		run += Math.hypot(curve[i][0] - curve[i - 1][0], curve[i][1] - curve[i - 1][1])
		if(run >= spacing) {
			points.push(curve[i])
			run = 0
		}
	}

	return 'M' + points.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(' L') + 'Z'
}

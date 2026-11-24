<script setup>
import licences from 'virtual:licences'
import icon from '../../../../build/icon.svg'
import { version } from '../../../../package.json'
import logo from '../assets/gn-logo.svg'

defineEmits(['release-notes'])

const REPOSITORY = 'https://github.com/garethnunns/content-tracker'
</script>

<template>
	<div class="about" data-test="about">
		<section class="app">
			<img :src="icon" alt="" class="icon">
			<div>
				<h2>Content Tracker</h2>
				<p>
					Version {{ version }} -
					<button class="link" data-test="about-notes" @click="$emit('release-notes')">What's new</button>
				</p>
				<p class="links">
					<a href="https://store.generativenoise.com/tools/content-tracker">Website</a>
					<a :href="REPOSITORY">Source code</a>
					<a :href="`${REPOSITORY}/issues`">Report a problem</a>
				</p>
			</div>
		</section>

		<section class="maker">
			<a href="https://generativenoise.com" class="logo" aria-label="Generative Noise">
				<span :style="{ maskImage: `url(${logo})` }" />
			</a>
			<div>
				<p>© Generative Noise 2024</p>
				<p>Licensed under <a :href="`${REPOSITORY}/blob/main/LICENSE`">GNU GPL 3</a></p>
			</div>
		</section>

		<details class="libraries">
			<summary>Open source libraries</summary>
			<p class="note">
				Including <a href="https://ffmpeg.org">FFmpeg</a>'s ffprobe, under the LGPL 2.1 on Apple Silicon and the GPL 3 elsewhere,
				and <a href="https://www.electronjs.org">Electron</a>, with the Chromium and Node.js it's built on.
			</p>
			<table data-test="licences">
				<tr v-for="entry in licences" :key="entry.name">
					<td>{{ entry.name }}</td>
					<td>{{ entry.version }}</td>
					<td>{{ entry.licence }}</td>
				</tr>
			</table>
		</details>
	</div>
</template>

<style scoped>
.about {
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: 28px;
	height: 100%;
	overflow: auto;
	padding: 36px 20px;
}

.app,
.maker {
	display: flex;
	gap: 16px;
	align-items: center;
}

.icon {
	width: 64px;
	height: 64px;
}

h2 {
	margin: 0;
	font-size: 18px;
	font-weight: 600;
}

p {
	margin: 2px 0 0;
}

.links {
	display: flex;
	gap: 14px;
}

.link {
	padding: 0;
	background: none;
	border: 0;
	color: var(--accent);
}

/* the logo's own shape, in the text's colour, so it suits light and dark */
.logo span {
	display: block;
	width: 112px;
	height: 64px;
	background: var(--text);
	mask-size: contain;
	mask-repeat: no-repeat;
	mask-position: center;
}

.libraries {
	width: min(560px, 100%);
}

summary {
	text-align: center;
	cursor: pointer;
}

.note {
	margin: 10px 0 8px;
	color: var(--text-soft);
	font-size: 12px;
}

table {
	width: 100%;
	border-collapse: collapse;
	font-size: 12px;
}

td {
	padding: 3px 12px 3px 0;
	border-top: 1px solid var(--border);
}

td:not(:first-child) {
	color: var(--text-soft);
	white-space: nowrap;
}
</style>

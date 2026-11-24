<script setup>
import { marked } from 'marked'
import { onMounted, ref } from 'vue'

const emit = defineEmits(['close'])

// every version's notes, bundled with the app, newest first
const files = import.meta.glob('../../../../docs/release-notes/*.md', { query: '?raw', import: 'default', eager: true })

const byVersion = (a, b) => b.version.localeCompare(a.version, undefined, { numeric: true })
const notes = Object.entries(files)
	.map(([file, text]) => ({ version: file.match(/([^/]+)\.md$/)[1], html: marked.parse(text) }))
	.sort(byVersion)

const dialog = ref(null)

onMounted(() => dialog.value.showModal())
</script>

<template>
	<dialog ref="dialog" class="notes" aria-labelledby="notes-title" data-test="release-notes" @close="emit('close')">
		<header>
			<h2 id="notes-title">What's new</h2>
			<button class="quiet" @click="dialog.close()">Close</button>
		</header>
		<div class="body">
			<section v-for="note in notes" :key="note.version">
				<h3>{{ note.version }}</h3>
				<!-- written by us and bundled when it's built, so it's safe as HTML -->
				<!-- eslint-disable-next-line vue/no-v-html -->
				<div class="note" v-html="note.html" />
			</section>
		</div>
	</dialog>
</template>

<style scoped>
.notes {
	width: min(640px, calc(100vw - 32px));
	max-height: calc(100vh - 64px);
	padding: 0;
	background: var(--background);
	border: 1px solid var(--border);
	border-radius: 12px;
	color: var(--text);
}

.notes[open] {
	display: flex;
	flex-direction: column;
}

.notes::backdrop {
	background: rgb(0 0 0 / 0.35);
}

header {
	display: flex;
	align-items: center;
	justify-content: space-between;
	padding: 12px 12px 12px 20px;
	border-bottom: 1px solid var(--border);
}

h2 {
	margin: 0;
	font-size: 15px;
	font-weight: 600;
}

.body {
	overflow: auto;
	padding: 4px 20px 20px;
}

h3 {
	margin: 16px 0 0;
	font-size: 14px;
	font-weight: 600;
}

.note :deep(h2) {
	margin: 12px 0 4px;
	color: var(--text-soft);
	font-size: 12px;
	font-weight: 600;
	text-transform: uppercase;
	letter-spacing: 0.04em;
}

.note :deep(ul) {
	margin: 0;
	padding-left: 18px;
}

.note :deep(li) {
	margin: 3px 0;
}

.note :deep(code) {
	font: 12px ui-monospace, Menlo, Consolas, monospace;
}
</style>

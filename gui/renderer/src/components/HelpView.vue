<script setup>
import { marked } from 'marked'
import help from '../../../../docs/help.md?raw'

// the README's App section is made from the same file
const html = marked.parse(help)
</script>

<template>
	<div class="help" data-test="help">
		<h2>Getting started</h2>
		<!-- written by us and bundled when it's built, so it's safe as HTML -->
		<!-- eslint-disable-next-line vue/no-v-html -->
		<div class="text" v-html="html" />
	</div>
</template>

<style scoped>
.help {
	height: 100%;
	overflow: auto;
	padding: 36px 20px;
}

.help > * {
	max-width: 640px;
	margin-left: auto;
	margin-right: auto;
}

h2 {
	margin: 0 0 8px;
	font-size: 15px;
	font-weight: 600;
}

.text :deep(p),
.text :deep(ol) {
	margin: 0 0 12px;
}

.text :deep(ol) {
	padding-left: 20px;
}

.text :deep(li) {
	margin: 4px 0;
}
</style>

<script setup>
// a step of setting up, which folds away to a line of what it's set to
defineProps({
	number: { type: Number, required: true },
	title: { type: String, required: true },
	summary: { type: String, default: '' },
	done: { type: Boolean, default: false },
	name: { type: String, required: true }
})

const open = defineModel('open', { type: Boolean, default: true })
</script>

<template>
	<section class="step" :class="{ open, done }" :data-test="`step-${name}`">
		<button type="button" class="header" :aria-expanded="open" @click="open = !open">
			<span class="number" aria-hidden="true">{{ done ? '✓' : number }}</span>
			<h2>{{ title }}</h2>
			<span class="summary">{{ open ? '' : summary }}</span>
			<span class="chevron" aria-hidden="true" />
		</button>
		<div class="body" :inert="!open">
			<div class="inner">
				<slot />
			</div>
		</div>
	</section>
</template>

<style scoped>
.step {
	background: var(--surface);
	border: 1px solid var(--border);
	border-radius: 10px;
}

.header {
	display: flex;
	align-items: center;
	gap: 10px;
	width: 100%;
	padding: 10px 14px;
	background: none;
	border: 0;
	text-align: left;
}

.number {
	display: grid;
	flex-shrink: 0;
	place-items: center;
	width: 22px;
	height: 22px;
	border: 1px solid var(--border);
	border-radius: 50%;
	color: var(--text-soft);
	font-size: 12px;
	transition: background 0.2s, border-color 0.2s, color 0.2s;
}

.done .number {
	background: var(--success);
	border-color: var(--success);
	color: var(--surface);
}

h2 {
	margin: 0;
	font-size: 15px;
	font-weight: 600;
}

.summary {
	flex: 1;
	min-width: 0;
	overflow: hidden;
	color: var(--text-soft);
	font-size: 12px;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.chevron {
	width: 7px;
	height: 7px;
	margin: 0 4px 3px;
	border-right: 1.5px solid var(--text-soft);
	border-bottom: 1.5px solid var(--text-soft);
	transform: rotate(45deg);
	transition: transform 0.25s ease;
}

.open .chevron {
	margin-bottom: -3px;
	transform: rotate(225deg);
}

/* folds by its height, whatever's in it */
.body {
	display: grid;
	grid-template-rows: 0fr;
	opacity: 0;
	/* hidden once it's folded, and not before */
	visibility: hidden;
	transition: grid-template-rows 0.25s ease, opacity 0.2s ease, visibility 0s 0.25s;
}

.open .body {
	grid-template-rows: 1fr;
	opacity: 1;
	visibility: visible;
	transition: grid-template-rows 0.25s ease, opacity 0.2s ease;
}

.inner {
	display: flex;
	flex-direction: column;
	gap: 12px;
	min-height: 0;
	overflow: hidden;
	padding: 0 14px;
	transition: padding 0.25s ease;
}

.open .inner {
	padding: 2px 14px 14px;
}

@media (prefers-reduced-motion: reduce) {
	.body,
	.inner,
	.chevron,
	.number {
		transition: none;
	}
}
</style>

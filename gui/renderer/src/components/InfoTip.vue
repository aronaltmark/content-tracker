<script setup>
// an i in a circle, saying a little more when it's pointed at or tabbed to
defineProps({
	text: { type: String, required: true }
})
</script>

<template>
	<span class="tip" tabindex="0" role="img" :aria-label="text">
		<span aria-hidden="true">i</span>
		<span class="bubble" aria-hidden="true">{{ text }}</span>
	</span>
</template>

<style scoped>
.tip {
	position: relative;
	display: inline-grid;
	place-items: center;
	width: 15px;
	height: 15px;
	margin-left: 5px;
	border: 1px solid var(--text-soft);
	border-radius: 50%;
	color: var(--text-soft);
	font-size: 10px;
	font-weight: 600;
	line-height: 1;
	vertical-align: 1px;
	cursor: help;
}

.bubble {
	position: absolute;
	z-index: 10;
	top: calc(100% + 6px);
	left: -8px;
	width: max-content;
	max-width: 240px;
	padding: 6px 9px;
	background: var(--text);
	border-radius: 6px;
	color: var(--background);
	font-size: 12px;
	font-style: normal;
	font-weight: 400;
	line-height: 1.4;
	opacity: 0;
	pointer-events: none;
	transform: translateY(-3px);
	transition: opacity 0.15s, transform 0.15s;
}

.tip:hover .bubble,
.tip:focus-visible .bubble {
	opacity: 1;
	transform: none;
}
</style>

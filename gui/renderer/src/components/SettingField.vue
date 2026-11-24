<script setup>
defineProps({
	label: { type: String, required: true },
	hint: { type: String, default: '' }
})
</script>

<template>
	<label class="field">
		<span class="label">{{ label }}</span>
		<slot />
		<span v-if="hint" class="hint">{{ hint }}</span>
	</label>
</template>

<style scoped>
.field {
	display: flex;
	flex-direction: column;
	gap: 4px;
}

.label {
	font-weight: 500;
}

.hint {
	color: var(--text-soft);
	font-size: 12px;
}
</style>

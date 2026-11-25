<script setup>
import InfoTip from './InfoTip.vue'

defineProps({
	label: { type: String, required: true },
	hint: { type: String, default: '' },
	tip: { type: String, default: '' }
})
</script>

<template>
	<label class="field">
		<span class="label">{{ label }}<InfoTip v-if="tip" :text="tip" /></span>
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

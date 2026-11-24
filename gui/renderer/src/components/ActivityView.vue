<script setup>
import { computed, nextTick, ref, watch } from 'vue'

const props = defineProps({
	lastRun: { type: Object, default: null },
	log: { type: Array, required: true }
})

const logElement = ref(null)

const changes = table => {
	const { inserted, updated, deleted } = props.lastRun.summary[table]
	return `${inserted} added, ${updated} updated, ${deleted} removed`
}

const when = computed(() => new Date(props.lastRun.time).toLocaleTimeString())
const time = entry => new Date(entry.time).toLocaleTimeString()

watch(() => props.log.length, async () => {
	await nextTick()
	logElement.value?.scrollTo({ top: logElement.value.scrollHeight })
}, { immediate: true })
</script>

<template>
	<div class="activity">
		<section v-if="lastRun?.error" class="result error" data-test="result">
			<h2>Last run failed at {{ when }}</h2>
			<p>{{ lastRun.error }}</p>
		</section>

		<section v-else-if="lastRun" class="result" data-test="result">
			<h2>{{ lastRun.summary.dryRun ? 'Dry run' : 'Last run' }} at {{ when }}</h2>
			<p>Found {{ lastRun.summary.found.folders }} folders and {{ lastRun.summary.found.files }} files.</p>
			<dl>
				<dt>Folders</dt>
				<dd data-test="folders">{{ changes('folders') }}</dd>
				<dt>Files</dt>
				<dd data-test="files">{{ changes('files') }}</dd>
			</dl>
			<p v-if="lastRun.summary.dryRun" class="note">Nothing was changed.</p>
			<p v-if="lastRun.summary.unreadable.length" class="warning">
				{{ lastRun.summary.unreadable.length }} paths couldn't be read, so nothing was removed.
			</p>
		</section>

		<p v-else class="empty">Nothing has run yet.</p>

		<div ref="logElement" class="log" data-test="log">
			<p v-for="(entry, index) in log" :key="index" :class="entry.level">
				<time>{{ time(entry) }}</time> {{ entry.message }}
			</p>
		</div>
	</div>
</template>

<style scoped>
.activity {
	display: flex;
	flex-direction: column;
	gap: 16px;
	height: 100%;
	padding: 18px 20px;
}

.result {
	padding: 14px 16px;
	background: var(--surface);
	border: 1px solid var(--border);
	border-radius: 10px;
}

.result.error {
	border-color: var(--error);
}

h2 {
	margin: 0 0 4px;
	font-size: 14px;
	font-weight: 600;
}

.result p {
	margin: 0;
	white-space: pre-wrap;
}

dl {
	display: grid;
	grid-template-columns: max-content 1fr;
	gap: 2px 14px;
	margin: 10px 0 0;
}

dt {
	color: var(--text-soft);
}

dd {
	margin: 0;
}

.result .note,
.result .warning {
	margin-top: 10px;
	color: var(--text-soft);
}

.result .warning {
	color: var(--warning);
}

.empty {
	margin: 0;
	color: var(--text-soft);
}

.log {
	flex: 1;
	min-height: 120px;
	overflow: auto;
	padding: 10px 12px;
	background: var(--surface);
	border: 1px solid var(--border);
	border-radius: 10px;
	font: 12px/1.5 ui-monospace, Menlo, Consolas, monospace;
}

.log p {
	margin: 0;
	white-space: pre-wrap;
	overflow-wrap: anywhere;
}

.log time {
	color: var(--text-soft);
}

.log .error {
	color: var(--error);
}

.log .warn {
	color: var(--warning);
}
</style>

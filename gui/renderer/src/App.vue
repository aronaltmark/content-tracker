<script setup>
import { computed, onMounted, ref } from 'vue'
import icon from '../../../build/icon.svg'
import { version } from '../../../package.json'
import AboutView from './components/AboutView.vue'
import ActivityView from './components/ActivityView.vue'
import HelpView from './components/HelpView.vue'
import ReleaseNotes from './components/ReleaseNotes.vue'
import SettingsView from './components/SettingsView.vue'
import TrackedView from './components/TrackedView.vue'

const { tracker } = window

const view = ref('activity')
const state = ref({ running: false, watching: false, lastRun: null })
const log = ref([])
const settings = ref(null)
const failure = ref('')
const showNotes = ref(false)
const update = ref({ version: null, progress: null, error: null })
const items = ref({ folders: [], files: [], dryRun: false })
const excluded = ref('')

const status = computed(() => {
	if(state.value.running)
		return 'Running'
	return state.value.watching ? 'Watching' : 'Stopped'
})

const ready = computed(() => settings.value?.config.settings.files.dirs.length > 0)

async function act(action) {
	failure.value = ''
	try {
		await action()
	}
	catch(err) {
		// Electron wraps these in a line about the remote method
		failure.value = err.message.replace(/^Error invoking remote method '.*?': (Error: )?/, '')
	}
}

// a rule from the list of what's tracked, which goes into the settings and takes effect next run
async function exclude({ type, pattern }) {
	await act(async () => {
		settings.value = await tracker.exclude(type, pattern)
		excluded.value = `Excluded ${pattern} - it'll go on the next run.`
	})
}

// a link opens in the browser, as the window only ever shows the app
function openLink(event) {
	const link = event.target.closest('a[href^="https:"]')
	if(!link)
		return
	event.preventDefault()
	window.open(link.href)
}

onMounted(async () => {
	// the menu bar's menu asking for a part of it
	tracker.onShow(name => view.value = name)
	tracker.onUpdate(state => update.value = state)
	tracker.onLog(entry => log.value.push(entry))
	tracker.onState(update => state.value = update)
	tracker.onItems(update => items.value = update)

	settings.value = await tracker.getConfig()

	const current = await tracker.getState()
	state.value = current.state
	log.value = current.log
	items.value = current.items
	update.value = await tracker.getUpdate()

	if(!ready.value)
		view.value = 'settings'
})
</script>

<template>
	<div class="app" @click="openLink">
		<header>
			<img :src="icon" alt="" class="icon">
			<h1>Content Tracker</h1>
			<button class="version" title="What's new" data-test="version" @click="showNotes = true">v{{ version }}</button>
			<span class="status" :class="status.toLowerCase()" data-test="status">{{ status }}</span>
			<div class="actions">
				<button :disabled="state.running || !ready" title="Shows what would change without changing it" @click="act(() => tracker.run(true))">Dry run</button>
				<button :disabled="state.running || !ready" title="Update the tables now" @click="act(() => tracker.run(false))">Run once</button>
				<button v-if="state.watching" class="primary" @click="act(tracker.stop)">Stop watching</button>
				<button v-else class="primary" :disabled="!ready" title="Keep updating the tracker at the set frequency" @click="act(tracker.start)">Start watching</button>
			</div>
		</header>

		<nav>
			<button :class="{ active: view == 'activity' }" @click="view = 'activity'">Activity</button>
			<button :class="{ active: view == 'tracked' }" @click="view = 'tracked'">Tracked</button>
			<button :class="{ active: view == 'settings' }" @click="view = 'settings'">Settings</button>
			<button :class="{ active: view == 'help' }" @click="view = 'help'">Help</button>
			<button :class="{ active: view == 'about' }" @click="view = 'about'">About</button>
		</nav>

		<div v-if="update.version" class="update" data-test="update">
			<template v-if="update.progress === null">
				<span>Version {{ update.version }} is out.</span>
				<button class="primary" title="Downloads it from GitHub, then restarts the app" @click="act(tracker.installUpdate)">Update and restart</button>
			</template>
			<span v-else>Downloading {{ update.version }}… {{ Math.round(update.progress * 100) }}%</span>
		</div>

		<p v-if="failure" class="failure" role="alert" data-test="failure">{{ failure }}</p>
		<p v-if="excluded && view == 'tracked'" class="excluded" role="status" data-test="excluded">{{ excluded }}</p>

		<main>
			<ActivityView v-if="view == 'activity'" :last-run="state.lastRun" :log="log" />
			<TrackedView v-else-if="view == 'tracked'" :items="items" @exclude="exclude" />
			<SettingsView v-else-if="view == 'settings' && settings" v-model="settings" />
			<HelpView v-else-if="view == 'help'" />
			<AboutView v-else-if="view == 'about'" @release-notes="showNotes = true" />
		</main>

		<ReleaseNotes v-if="showNotes" @close="showNotes = false" />
	</div>
</template>

<style scoped>
.app {
	display: flex;
	flex-direction: column;
	height: 100%;
}

header {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 12px;
	padding: 14px 20px 10px;
}

.icon {
	width: 30px;
	height: 30px;
	margin: -4px -6px -4px -4px;
}

h1 {
	margin: 0;
	font-size: 18px;
	font-weight: 600;
}

.version {
	margin-left: -6px;
	padding: 2px 4px;
	background: none;
	border: 0;
	color: var(--text-soft);
	font-size: 12px;
}

.version:hover {
	color: var(--accent);
}

.status {
	padding: 2px 9px;
	border-radius: 99px;
	background: var(--surface);
	border: 1px solid var(--border);
	color: var(--text-soft);
	font-size: 12px;
}

.status.running,
.status.watching {
	border-color: var(--success);
	color: var(--success);
}

.actions {
	display: flex;
	gap: 8px;
	margin-left: auto;
}

nav {
	display: flex;
	gap: 4px;
	padding: 0 20px;
	border-bottom: 1px solid var(--border);
}

nav button {
	border: 0;
	border-bottom: 2px solid transparent;
	border-radius: 0;
	background: none;
	color: var(--text-soft);
}

nav button.active {
	border-bottom-color: var(--accent);
	color: var(--text);
}

.update {
	display: flex;
	align-items: center;
	gap: 12px;
	margin: 12px 20px 0;
	padding: 8px 12px;
	border: 1px solid var(--accent);
	border-radius: 7px;
}

.update button {
	margin-left: auto;
}

.excluded {
	margin: 12px 20px 0;
	color: var(--text-soft);
}

.failure {
	margin: 12px 20px 0;
	padding: 8px 12px;
	border: 1px solid var(--error);
	border-radius: 7px;
	color: var(--error);
	white-space: pre-wrap;
}

main {
	flex: 1;
	min-height: 0;
}
</style>

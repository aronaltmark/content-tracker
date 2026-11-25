<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
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

// while watching, how far it is through the wait for the next look, kept up to date each second
const now = ref(Date.now())
const clock = setInterval(() => now.value = Date.now(), 1000)
onBeforeUnmount(() => clearInterval(clock))

const waited = computed(() => {
	const { watching, running, nextRun, interval } = state.value
	if(!watching || running || !nextRun || !interval)
		return null
	const left = Math.max(nextRun - now.value, 0)
	return { progress: 1 - left / interval, seconds: Math.ceil(left / 1000) }
})

const stopTitle = computed(() => waited.value
	? `Scanning again in ${waited.value.seconds < 60 ? `${waited.value.seconds}s` : `${Math.ceil(waited.value.seconds / 60)} min`}`
	: 'Stop updating the tracker')

const ready = computed(() => settings.value?.config.settings.files.dirs.length > 0)

// whether it has a way into the tables: a sign in, a token or a service account
const connected = computed(() => {
	const { config, signedIn, hasToken } = settings.value
	if(config.settings.target == 'googleSheets')
		return Boolean(signedIn?.google || config.settings.googleSheets?.credentials)
	return Boolean(signedIn?.airtable || hasToken)
})

// a run that fails while watching shows why, unless the settings are being changed
watch(() => state.value.lastRun, run => {
	if(run?.error && view.value != 'settings')
		view.value = 'activity'
})

// where a run's under way, and what it found
function run(dryRun) {
	view.value = 'activity'
	act(async () => {
		await tracker.run(dryRun)
		if(dryRun && !state.value.lastRun?.error)
			view.value = 'tracked'
	})
}

function startWatching() {
	view.value = 'activity'
	act(tracker.start)
}

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

	if(!ready.value || !connected.value)
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
				<button :disabled="state.running || !ready" title="Shows what would change without changing it" @click="run(true)">Dry run</button>
				<button :disabled="state.running || !ready" title="Update the tables now" @click="run(false)">Run once</button>
				<button v-if="state.watching" class="primary watching" :title="stopTitle" data-test="stop-watching" @click="act(tracker.stop)">
					Stop watching
					<span v-if="waited" class="countdown" :style="{ transform: `scaleX(${waited.progress})` }" data-test="countdown" />
				</button>
				<button v-else class="primary" :disabled="!ready" title="Keep updating the tracker at the set frequency" @click="startWatching">Start watching</button>
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

/* filling along its bottom until it next looks */
.watching {
	position: relative;
	overflow: hidden;
}

.countdown {
	position: absolute;
	right: 0;
	bottom: 0;
	left: 0;
	height: 3px;
	background: var(--accent-text);
	opacity: 0.55;
	transform-origin: left;
	transition: transform 1s linear;
}

@media (prefers-reduced-motion: reduce) {
	.countdown {
		transition: none;
	}
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

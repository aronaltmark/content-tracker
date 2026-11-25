<script setup>
import { computed, ref, watch } from 'vue'
import SettingField from './SettingField.vue'

const model = defineModel({ type: Object, required: true })

const { tracker } = window

const edited = ref()
const token = ref('')
const problems = ref([])
const saved = ref(false)
const saving = ref(false)
const signingIn = ref(false)
const authError = ref('')
const bases = ref([])
const chosenSheet = ref('')

// Electron wraps these in a line about the remote method
const reason = err => err.message.replace(/^Error invoking remote method '.*?': (Error: )?/, '')

const files = computed(() => edited.value.settings.files)
const airtable = computed(() => edited.value.settings.airtable)
const sheets = computed(() => edited.value.settings.googleSheets)
const target = computed(() => edited.value.settings.target ?? 'airtable')

const tokenHint = computed(() => {
	if(!model.value.tokenKept)
		return "This computer has no keychain, so you'll need to enter it each time the app opens."
	return model.value.hasToken ? 'Kept in your keychain. Enter a new one to replace it.' : 'Kept in your keychain.'
})

// rules are kept as lists, and edited as a line each
const lines = (type, rule) => ({
	get: () => files.value.rules[type][rule].join('\n'),
	set: text => files.value.rules[type][rule] = text.split('\n').map(line => line.trim()).filter(line => line)
})

const rules = {
	fileIncludes: computed(lines('files', 'includes')),
	fileExcludes: computed(lines('files', 'excludes')),
	dirIncludes: computed(lines('dirs', 'includes')),
	dirExcludes: computed(lines('dirs', 'excludes'))
}

// an imported config from before Google Sheets won't have a section for it
function withDefaults(config) {
	const copy = JSON.parse(JSON.stringify(config))
	copy.settings.googleSheets ??= { spreadsheetId: '', credentials: '', foldersSheet: 'Folders', filesSheet: 'Files' }
	copy.settings.airtable ??= { token: '', base: '', foldersTable: 'Folders', filesTable: 'Files', view: '' }
	copy.settings.target ??= 'airtable'
	copy.settings.files.rootPath ??= ''
	copy.settings.files.trackFolders ??= true
	copy.settings.removing = { enabled: true, confirm: true, ...copy.settings.removing }
	return copy
}

// what was last sent to be saved, so its own echo coming back doesn't replace what's being typed
let sent = ''

watch(() => model.value.config, config => {
	if(JSON.stringify(config) != sent)
		edited.value = withDefaults(config)
}, { immediate: true })

function took(result) {
	model.value = result
	problems.value = result.problems ?? []
	saved.value = !problems.value.length
}

async function save() {
	clearTimeout(timer)
	sent = JSON.stringify(edited.value)
	saving.value = true
	try {
		const result = await tracker.saveConfig(JSON.parse(sent), token.value)
		// keep what's here now, which may be newer than what was saved
		took({ ...result, config: JSON.parse(sent) })
		token.value = ''
	}
	finally {
		saving.value = false
	}
}

// settings save themselves a moment after they're changed
let timer
watch(edited, () => {
	if(JSON.stringify(edited.value) == sent)
		return
	saved.value = false
	clearTimeout(timer)
	timer = setTimeout(save, 600)
}, { deep: true })

async function exportConfig() {
	await save()
	await tracker.exportConfig()
}

async function addFolder() {
	const folder = await tracker.pickFolder()
	if(!folder || files.value.dirs.includes(folder))
		return
	files.value.dirs.push(folder)
	files.value.rootPath ||= folder
}

async function importConfig() {
	const result = await tracker.importConfig()
	if(result?.config)
		took(result)
	else if(result)
		problems.value = result.problems
}

async function pickCredentials() {
	sheets.value.credentials = await tracker.pickCredentials() ?? sheets.value.credentials
}

async function signIn(provider) {
	authError.value = ''
	signingIn.value = true
	try {
		keepEdits(await tracker.signIn(provider))
	}
	catch(err) {
		authError.value = reason(err)
	}
	finally {
		signingIn.value = false
	}
}

async function signOut(provider) {
	keepEdits(await tracker.signOut(provider))
}

// signing in or out says nothing about the settings, so what's not saved yet stays
function keepEdits({ hasToken, signedIn, canSignIn, tokenKept }) {
	model.value = { ...model.value, hasToken, signedIn, canSignIn, tokenKept }
}

async function chooseBase() {
	authError.value = ''
	try {
		// a token just typed in has to be saved before it can be used
		await save()
		bases.value = await tracker.airtableBases()
		if(!bases.value.length)
			authError.value = 'There are no bases you\'ve given it access to.'
	}
	catch(err) {
		authError.value = reason(err)
	}
}

async function chooseSpreadsheet() {
	authError.value = ''
	try {
		const chosen = await tracker.chooseSpreadsheet()
		if(chosen) {
			sheets.value.spreadsheetId = chosen.id
			chosenSheet.value = chosen.name
		}
	}
	catch(err) {
		authError.value = reason(err)
	}
}

const cacheMessage = ref('')

async function wipeCache() {
	try {
		await tracker.wipeCache()
		cacheMessage.value = 'Cleared'
	}
	catch(err) {
		cacheMessage.value = reason(err)
	}
}

async function clearToken() {
	keepEdits(await tracker.clearToken())
}
</script>

<template>
	<form class="settings" @submit.prevent="save">
		<div class="fields">
			<div v-if="problems.length" class="problems" role="alert" data-test="problems">
				<p>Saved, but it won't run until these are sorted:</p>
				<ul>
					<li v-for="problem in problems" :key="problem">{{ problem }}</li>
				</ul>
			</div>

			<section>
				<h2>Folders</h2>

				<div class="field-group">
					<span class="heading">Folders to track</span>
					<ul class="folders" data-test="folders">
						<li v-for="(dir, index) in files.dirs" :key="dir">
							<span>{{ dir }}</span>
							<button type="button" class="quiet" :aria-label="`Remove ${dir}`" @click="files.dirs.splice(index, 1)">Remove</button>
						</li>
					</ul>
					<div>
						<button type="button" data-test="add-folder" @click="addFolder">Add folder</button>
					</div>
				</div>

				<SettingField label="Project root" hint="Removed from the start of paths, so it doesn't matter where the drive is mounted.">
					<input v-model="files.rootPath" spellcheck="false">
				</SettingField>

				<div class="columns">
					<SettingField label="Check every (seconds)" hint="How often it looks for changes while watching.">
						<input v-model.number="files.frequency" type="number" min="0">
					</SettingField>
					<SettingField label="Files at once (concurrency)" hint="Lower this for streamed drives.">
						<input v-model.number="files.concurrency" type="number" min="1">
					</SettingField>
				</div>

				<label class="check">
					<input v-model="files.mediaMetadata" type="checkbox">
					<span>Media metadata <small>Duration, codec, resolution, etc.</small></span>
				</label>
				<label class="check">
					<input v-model="files.limitToFirstFile" type="checkbox">
					<span>First file only <small>One file per folder, for image sequences</small></span>
				</label>
				<label class="check">
					<input v-model="files.trackFolders" type="checkbox" data-test="track-folders">
					<span>Track folders <small>Also track the folders, with linked records to the files</small></span>
				</label>

				<div class="field-group">
					<div>
						<button type="button" data-test="wipe-cache" @click="wipeCache">Clear media metadata cache</button>
						<span v-if="cacheMessage" class="cache-message" role="status" data-test="cache-message">{{ cacheMessage }}</span>
					</div>
					<span class="hint">Read every file's metadata again on next run (files will already be automatically scanned if they change size or the modified time changed).</span>
				</div>
			</section>

			<section>
				<h2>Deleted files</h2>
				<label class="check">
					<input v-model="edited.settings.removing.enabled" type="checkbox" data-test="removing">
					<span>Remove their records <small>When off, will keep deleted files listed</small></span>
				</label>
				<label class="check">
					<input v-model="edited.settings.removing.confirm" type="checkbox" :disabled="!edited.settings.removing.enabled" data-test="confirm-removing">
					<span>Warn before removing more than 10%</span>
				</label>
			</section>

			<section>
				<h2>Rules</h2>
				<p class="intro">One per line, like <code>*.mov</code> or <code>shots/**</code>.</p>
				<div class="columns">
					<SettingField label="Include files">
						<textarea v-model="rules.fileIncludes.value" spellcheck="false" />
					</SettingField>
					<SettingField label="Exclude files">
						<textarea v-model="rules.fileExcludes.value" spellcheck="false" />
					</SettingField>
					<SettingField label="Include folders">
						<textarea v-model="rules.dirIncludes.value" spellcheck="false" />
					</SettingField>
					<SettingField label="Exclude folders">
						<textarea v-model="rules.dirExcludes.value" spellcheck="false" />
					</SettingField>
				</div>
			</section>

			<section>
				<h2>Tables</h2>

				<div class="choice" role="radiogroup" aria-label="Tables">
					<button type="button" role="radio" :aria-checked="target == 'airtable'" :class="{ active: target == 'airtable' }" @click="edited.settings.target = 'airtable'">Airtable</button>
					<button type="button" role="radio" :aria-checked="target == 'googleSheets'" :class="{ active: target == 'googleSheets' }" @click="edited.settings.target = 'googleSheets'">Google Sheets</button>
				</div>

				<template v-if="target == 'airtable'">
					<div v-if="model.canSignIn?.airtable" class="sign-in">
						<template v-if="model.signedIn?.airtable">
							<span data-test="airtable-account">Signed in as {{ model.signedIn.airtable }}</span>
							<button type="button" class="quiet" @click="signOut('airtable')">Sign out</button>
						</template>
						<button v-else type="button" class="primary" :disabled="signingIn" data-test="sign-in-airtable" @click="signIn('airtable')">Sign in with Airtable</button>
					</div>

					<details :open="model.hasToken || !model.canSignIn?.airtable">
						<summary>{{ model.canSignIn?.airtable ? 'Or use a token' : 'Token' }}</summary>
						<SettingField label="Token" :hint="tokenHint">
							<input v-model="token" type="password" autocomplete="off" :placeholder="model.hasToken ? 'Saved' : ''" data-test="token" @change="save">
						</SettingField>
						<div v-if="model.hasToken">
							<button type="button" class="quiet" @click="clearToken">Forget token</button>
						</div>
					</details>

					<div class="field-group">
						<span class="heading">Base</span>
						<div class="picker">
							<input v-model="airtable.base" spellcheck="false" placeholder="app..." aria-label="Base ID" data-test="base">
							<button type="button" :disabled="!model.signedIn?.airtable && !model.hasToken && !token" data-test="choose-base" @click="chooseBase">Choose</button>
						</div>
						<ul v-if="bases.length" class="bases" data-test="bases">
							<li v-for="base in bases" :key="base.id">
								<button type="button" :class="{ active: base.id == airtable.base }" @click="airtable.base = base.id; bases = []">
									{{ base.name }} <small>{{ base.id }}</small>
								</button>
							</li>
						</ul>
						<span class="hint">Choose from yours, or the ID from the base's address.</span>
					</div>
					<div class="columns">
						<SettingField label="Folders table" hint="A name, or a table's ID.">
							<input v-model="airtable.foldersTable" spellcheck="false">
						</SettingField>
						<SettingField label="Files table" hint="A name, or a table's ID.">
							<input v-model="airtable.filesTable" spellcheck="false">
						</SettingField>
					</div>
					<SettingField label="View" hint="Only compare against this view. Leave empty for the whole table.">
						<input v-model="airtable.view" spellcheck="false">
					</SettingField>
				</template>

				<template v-else>
					<div v-if="model.canSignIn?.google" class="field-group">
						<div class="sign-in">
							<template v-if="model.signedIn?.google">
								<span data-test="google-account">Signed in as {{ model.signedIn.google }}</span>
								<button type="button" class="quiet" @click="signOut('google')">Sign out</button>
							</template>
							<button v-else type="button" class="primary" :disabled="signingIn" data-test="sign-in-google" @click="signIn('google')">Sign in with Google</button>
						</div>
						<span v-if="!model.signedIn?.google" class="hint">Google will say it hasn't checked this app yet: choose Advanced, then Go to Content Tracker.</span>
					</div>

					<div class="field-group">
						<span class="heading">Spreadsheet</span>
						<div class="picker">
							<input v-model="sheets.spreadsheetId" spellcheck="false" placeholder="https://docs.google.com/spreadsheets/d/..." aria-label="Spreadsheet" data-test="spreadsheet" @input="chosenSheet = ''">
							<button v-if="model.canSignIn?.google" type="button" :disabled="!model.signedIn?.google" data-test="choose-spreadsheet" @click="chooseSpreadsheet">Choose</button>
						</div>
						<span v-if="chosenSheet" class="hint" data-test="chosen-spreadsheet">{{ chosenSheet }}</span>
						<span v-else class="hint">Choose it from your Google Drive, or give its link.</span>
					</div>

					<details :open="Boolean(sheets.credentials) || !model.canSignIn?.google">
						<summary>{{ model.canSignIn?.google ? 'Or use a service account' : 'Service account' }}</summary>
						<div class="field-group">
							<span class="heading">Service account key</span>
							<div class="picker">
								<input v-model="sheets.credentials" spellcheck="false" aria-label="Service account key">
								<button type="button" @click="pickCredentials">Choose</button>
							</div>
							<span class="hint">For computers no one signs in on. Share the spreadsheet with the service account's email address.</span>
						</div>
					</details>

					<div class="columns">
						<SettingField label="Folders sheet">
							<input v-model="sheets.foldersSheet" spellcheck="false">
						</SettingField>
						<SettingField label="Files sheet">
							<input v-model="sheets.filesSheet" spellcheck="false">
						</SettingField>
					</div>
				</template>

				<p v-if="signingIn" class="hint" role="status">Waiting for you to sign in, in your browser…</p>
				<p v-if="authError" class="auth-error" role="alert" data-test="auth-error">{{ authError }}</p>
			</section>
		</div>

		<footer>
			<button type="button" title="Use settings from a config file, like the command line's" @click="importConfig">Import settings</button>
			<button type="button" title="Save these settings as a config file, for the command line or another computer - without your token or sign ins" data-test="export" @click="exportConfig">Export settings</button>
			<span v-if="saving" class="saved">Saving…</span>
			<span v-else-if="saved" class="saved" data-test="saved">Saved</span>
		</footer>
	</form>
</template>

<style scoped>
/* the fields scroll, the buttons stay where they are below them */
.settings {
	display: flex;
	flex-direction: column;
	height: 100%;
}

.fields {
	display: flex;
	flex: 1;
	flex-direction: column;
	gap: 24px;
	min-height: 0;
	overflow: auto;
	padding: 18px max(20px, calc((100% - 680px) / 2));
}

section {
	display: flex;
	flex-direction: column;
	gap: 12px;
}

h2 {
	margin: 0;
	font-size: 15px;
	font-weight: 600;
}

.intro {
	margin: 0;
	color: var(--text-soft);
}

.columns {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
	gap: 12px;
}

.field-group {
	display: flex;
	flex-direction: column;
	gap: 6px;
}

.heading {
	font-weight: 500;
}

.hint,
small {
	color: var(--text-soft);
	font-size: 12px;
}

.folders {
	display: flex;
	flex-direction: column;
	gap: 4px;
	margin: 0;
	padding: 0;
	list-style: none;
}

.folders li button {
	flex-shrink: 0;
	white-space: nowrap;
}

.folders li {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 8px;
	padding: 4px 4px 4px 10px;
	background: var(--surface);
	border: 1px solid var(--border);
	border-radius: 7px;
	overflow-wrap: anywhere;
}

.picker {
	display: flex;
	gap: 8px;
}

.sign-in {
	display: flex;
	align-items: center;
	gap: 8px;
}

details {
	display: flex;
	flex-direction: column;
	gap: 8px;
}

details[open] {
	display: flex;
}

summary {
	color: var(--text-soft);
	cursor: pointer;
}

.bases {
	display: flex;
	flex-direction: column;
	gap: 4px;
	margin: 0;
	padding: 0;
	list-style: none;
}

.bases button {
	width: 100%;
	text-align: left;
}

.bases button.active {
	border-color: var(--accent);
}

.cache-message {
	margin-left: 8px;
	color: var(--text-soft);
}

.auth-error {
	margin: 0;
	color: var(--error);
}

.check {
	display: flex;
	align-items: center;
	gap: 8px;
}

.choice {
	display: flex;
	gap: 4px;
}

.choice .active {
	border-color: var(--accent);
	color: var(--accent);
}

.problems {
	padding: 8px 12px;
	border: 1px solid var(--warning);
	border-radius: 7px;
}

.problems p,
.problems ul {
	margin: 0;
}

.problems ul {
	padding-left: 18px;
}

footer {
	display: flex;
	align-items: center;
	gap: 8px;
	padding: 12px max(20px, calc((100% - 680px) / 2));
	border-top: 1px solid var(--border);
}

.saved {
	color: var(--success);
}
</style>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { finderSize } from '../../../../core/format.js'

const props = defineProps({
	items: { type: Object, required: true }
})

const emit = defineEmits(['exclude'])

const STATUS = {
	new: 'New',
	modified: 'Modified',
	deleted: 'Deleted',
	same: 'Unchanged'
}

const kind = ref('files')
const search = ref('')
const menu = ref(null)
const sort = ref({ by: 'path', descending: false })
// after a dry run, only what it would do one way: new, modified and so on
const only = ref('')

// how each column sorts: a path by its text, dates as the ISO strings they are, the rest as numbers
const SORTS = {
	path: item => item.path.toLowerCase(),
	found: item => item.found,
	modified: item => item.modified,
	size: item => item.size ?? 0,
	items: item => item.items ?? 0,
	duration: item => item.duration ?? 0,
	codec: item => item.codec,
	resolution: item => (item.width ?? 0) * (item.height ?? 0)
}

function sortBy(by) {
	// a column of dates or sizes is most use biggest first, a path A to Z
	const first = !['path', 'codec'].includes(by)
	sort.value = sort.value.by == by ? { by, descending: !sort.value.descending } : { by, descending: first }
}

const shown = computed(() => {
	const text = search.value.trim().toLowerCase()
	const status = props.items.dryRun ? only.value : ''
	const list = (props.items[kind.value] ?? []).filter(item => (!text || item.path.toLowerCase().includes(text)) && (!status || item.status == status))
	const key = SORTS[sort.value.by]
	const order = sort.value.descending ? -1 : 1
	return list.toSorted((a, b) => {
		const [x, y] = [key(a), key(b)]
		return (x < y ? -1 : x > y ? 1 : 0) * order || a.path.localeCompare(b.path)
	})
})

const arrow = by => sort.value.by == by ? (sort.value.descending ? '↓' : '↑') : ''

const counts = computed(() => Object.fromEntries(Object.keys(STATUS).map(status =>
	[status, (props.items[kind.value] ?? []).filter(item => item.status == status).length])))

// a glob matches these literally once they're escaped, so a name like shot[1].mov excludes just that
const literal = text => text.replace(/[\\*?[\]{}()!+@]/g, '\\$&')

const nameOf = path => path.split('/').pop()
const folderOf = path => path.split('/').slice(0, -1).join('/')

function choices(item) {
	if(kind.value == 'folders') {
		if(item.path == '/')
			return []
		return [{ label: 'Exclude the folder', subject: item.path, type: 'dirs', pattern: `${literal(item.path.slice(1))}/**` }]
	}

	const name = nameOf(item.path)
	const folder = folderOf(item.path)
	const extension = name.includes('.') && !name.startsWith('.') ? name.split('.').pop() : ''
	return [
		{ label: 'Exclude files called', subject: name, type: 'files', pattern: literal(name) },
		folder && { label: 'Exclude everything in', subject: folder, type: 'files', pattern: `${literal(folder.slice(1))}/**` },
		extension && { label: 'Exclude every', subject: `.${extension}`, after: 'file', type: 'files', pattern: `*.${literal(extension)}` }
	].filter(choice => choice)
}

function openMenu(event, item) {
	const options = choices(item)
	if(!options.length)
		return
	// kept inside the window, however near its edge the click was
	const x = Math.min(event.clientX, window.innerWidth - 300)
	const y = Math.min(event.clientY, window.innerHeight - 40 * options.length - 16)
	menu.value = { x: Math.max(x, 8), y: Math.max(y, 8), options }
}

function choose(option) {
	menu.value = null
	emit('exclude', option)
}

// the media columns only once there's media to show
const hasMedia = computed(() => (props.items.files ?? []).some(item => item.duration || item.codec || item.width))

const columns = computed(() => kind.value == 'files'
	? [
		{ by: 'path', label: 'Path' },
		{ by: 'size', label: 'Size', class: 'number' },
		{ by: 'modified', label: 'Modified' },
		{ by: 'found', label: 'Found', class: 'found' },
		...(hasMedia.value ? [
			{ by: 'duration', label: 'Duration', class: 'number media' },
			{ by: 'codec', label: 'Codec', class: 'media' },
			{ by: 'resolution', label: 'Resolution', class: 'media' }
		] : [])
	]
	: [
		{ by: 'path', label: 'Path' },
		{ by: 'items', label: 'Items', class: 'number' },
		{ by: 'modified', label: 'Modified' },
		{ by: 'found', label: 'Found', class: 'found' }
	])

const size = finderSize

const modified = date => date ? new Date(date).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }) : '-'

function duration(seconds) {
	if(!seconds)
		return '-'
	const whole = Math.round(seconds)
	return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`
}

const resolution = item => item.width && item.height ? `${item.width} × ${item.height}` : '-'

const close = () => menu.value = null
const closeOnEscape = event => event.key == 'Escape' && close()

onMounted(() => {
	window.addEventListener('click', close)
	window.addEventListener('keydown', closeOnEscape)
})

onBeforeUnmount(() => {
	window.removeEventListener('click', close)
	window.removeEventListener('keydown', closeOnEscape)
})
</script>

<template>
	<div class="tracked" @contextmenu.prevent>
		<div class="bar">
			<div class="choice" role="radiogroup" aria-label="Show">
				<button role="radio" :aria-checked="kind == 'files'" :class="{ active: kind == 'files' }" @click="kind = 'files'">Files <small>{{ items.files.length }}</small></button>
				<button v-if="items.folders.length" role="radio" :aria-checked="kind == 'folders'" :class="{ active: kind == 'folders' }" @click="kind = 'folders'">Folders <small>{{ items.folders.length }}</small></button>
			</div>
			<input v-model="search" type="search" placeholder="Search" aria-label="Search" spellcheck="false">
		</div>

		<p v-if="items.dryRun" class="legend" data-test="legend">
			<span>Dry run:</span>
			<button
				v-for="(label, status) in STATUS"
				:key="status"
				type="button"
				:class="[status, { dimmed: only && only != status }]"
				:aria-pressed="only == status"
				:title="only == status ? 'Show everything' : `Show only what's ${label.toLowerCase()}`"
				:data-test="`only-${status}`"
				@click="only = only == status ? '' : status"
			>
				{{ counts[status] }} {{ label.toLowerCase() }}
			</button>
		</p>

		<p v-if="!items.files.length && !items.folders.length" class="empty">Nothing yet - run it, or try a dry run, to see what it tracks.</p>

		<div v-else class="list">
			<table data-test="tracked">
				<thead>
					<tr>
						<th v-for="column in columns" :key="column.by" :class="column.class" :aria-sort="sort.by == column.by ? (sort.descending ? 'descending' : 'ascending') : 'none'">
							<button type="button" :data-test="`sort-${column.by}`" @click="sortBy(column.by)">{{ column.label }} <span class="arrow">{{ arrow(column.by) }}</span></button>
						</th>
					</tr>
				</thead>
				<tbody>
					<tr
						v-for="item in shown"
						:key="item.path"
						:class="items.dryRun ? item.status : ''"
						:title="items.dryRun ? STATUS[item.status] : ''"
						@click.stop="openMenu($event, item)"
						@contextmenu.prevent.stop="openMenu($event, item)"
					>
						<td class="path">{{ item.path }}</td>
						<template v-if="kind == 'files'">
							<td class="number">{{ size(item.size) }}</td>
							<td>{{ modified(item.modified) }}</td>
							<td class="found">{{ modified(item.found) }}</td>
							<template v-if="hasMedia">
								<td class="number media">{{ duration(item.duration) }}</td>
								<td class="media">{{ item.codec || '-' }}</td>
								<td class="media">{{ resolution(item) }}</td>
							</template>
						</template>
						<template v-else>
							<td class="number">{{ item.items ?? '-' }}</td>
							<td>{{ modified(item.modified) }}</td>
							<td class="found">{{ modified(item.found) }}</td>
						</template>
					</tr>
				</tbody>
			</table>
		</div>


		<ul v-if="menu" class="menu" role="menu" :style="{ left: `${menu.x}px`, top: `${menu.y}px` }" data-test="exclude-menu">
			<li v-for="option in menu.options" :key="option.pattern" role="none">
				<button role="menuitem" @click.stop="choose(option)">{{ option.label }} <span class="subject">{{ option.subject }}</span>{{ option.after ? ` ${option.after}` : '' }}</button>
			</li>
		</ul>
	</div>
</template>

<style scoped>
.tracked {
	display: flex;
	flex-direction: column;
	gap: 12px;
	height: 100%;
	padding: 18px 20px;
}

.bar {
	display: flex;
	align-items: center;
	gap: 12px;
}

.bar input {
	max-width: 280px;
	margin-left: auto;
}

.choice {
	display: flex;
	gap: 4px;
}

.choice .active {
	border-color: var(--accent);
	color: var(--accent);
}

.choice small {
	color: var(--text-soft);
}

.legend {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 6px;
	margin: 0;
	font-size: 13px;
}

/* each a filter: pressed shows only those, pressed again shows everything */
.legend button {
	padding: 2px 9px;
	background: none;
	border: 1px solid transparent;
	border-radius: 99px;
	transition: opacity 0.15s, border-color 0.15s;
}

.legend button:hover,
.legend button[aria-pressed='true'] {
	border-color: currentColor;
}

.legend button.dimmed {
	opacity: 0.45;
}

.list {
	flex: 1;
	min-height: 0;
	overflow: auto;
	background: var(--surface);
	border: 1px solid var(--border);
	border-radius: 10px;
}

table {
	width: 100%;
	border-collapse: collapse;
	font-size: 12px;
}

th {
	position: sticky;
	top: 0;
	padding: 0;
	background: var(--surface);
	border-bottom: 1px solid var(--border);
	color: var(--text-soft);
	font-weight: 500;
	text-align: left;
	white-space: nowrap;
}

th button {
	width: 100%;
	padding: 7px 12px;
	border: 0;
	border-radius: 0;
	background: none;
	color: inherit;
	font: inherit;
	text-align: inherit;
}

th button:hover {
	color: var(--text);
}

.arrow {
	display: inline-block;
	width: 1ch;
	color: var(--accent);
}

td {
	padding: 4px 12px;
	white-space: nowrap;
}

/* a narrow window keeps the path, its size and dates */
@media (max-width: 820px) {
	.media {
		display: none;
	}
}

@media (max-width: 640px) {
	.found {
		display: none;
	}
}

td.path {
	width: 100%;
	white-space: normal;
	overflow-wrap: anywhere;
	font-family: ui-monospace, Menlo, Consolas, monospace;
}

.number {
	text-align: right;
	font-variant-numeric: tabular-nums;
}

tbody tr {
	cursor: pointer;
}

tbody tr:hover {
	background: var(--background);
}

.new {
	color: var(--success);
}

.modified {
	color: var(--warning);
}

.deleted {
	color: var(--error);
}

tbody .deleted td {
	text-decoration: line-through;
}

.same {
	color: var(--text-soft);
}

.empty {
	margin: 0;
	color: var(--text-soft);
}

.menu {
	position: fixed;
	z-index: 10;
	min-width: 220px;
	margin: 0;
	padding: 4px;
	list-style: none;
	background: var(--surface);
	border: 1px solid var(--border);
	border-radius: 8px;
	box-shadow: 0 6px 24px rgb(0 0 0 / 0.18);
}

.menu button {
	width: 100%;
	padding: 6px 10px;
	border: 0;
	background: none;
	text-align: left;
}

.menu button:hover,
.menu button:focus-visible {
	background: var(--accent);
	color: var(--accent-text);
}

/* the name, folder or extension it'd exclude, so it stands out from the words round it */
.subject {
	padding: 1px 5px;
	border-radius: 4px;
	background: var(--background);
	color: var(--accent);
	font: 12px ui-monospace, Menlo, Consolas, monospace;
}

.menu button:hover .subject,
.menu button:focus-visible .subject {
	background: rgb(255 255 255 / 0.2);
	color: inherit;
}
</style>

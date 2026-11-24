import { contextBridge, ipcRenderer } from 'electron'

// everything the page can do, it never gets ipcRenderer itself
contextBridge.exposeInMainWorld('tracker', {
	getConfig: () => ipcRenderer.invoke('config:get'),
	saveConfig: (config, token) => ipcRenderer.invoke('config:save', config, token),
	clearToken: () => ipcRenderer.invoke('config:clear-token'),
	importConfig: () => ipcRenderer.invoke('config:import'),
	exportConfig: () => ipcRenderer.invoke('config:export'),
	exclude: (type, pattern) => ipcRenderer.invoke('config:exclude', type, pattern),
	signIn: provider => ipcRenderer.invoke('auth:sign-in', provider),
	signOut: provider => ipcRenderer.invoke('auth:sign-out', provider),
	airtableBases: () => ipcRenderer.invoke('airtable:bases'),
	pickFolder: () => ipcRenderer.invoke('dialog:folder'),
	wipeCache: () => ipcRenderer.invoke('cache:wipe'),
	pickCredentials: () => ipcRenderer.invoke('dialog:credentials'),
	getState: () => ipcRenderer.invoke('tracker:get'),
	run: dryRun => ipcRenderer.invoke('tracker:run', dryRun),
	start: () => ipcRenderer.invoke('tracker:start'),
	stop: () => ipcRenderer.invoke('tracker:stop'),
	onLog: callback => ipcRenderer.on('tracker:log', (event, entry) => callback(entry)),
	onState: callback => ipcRenderer.on('tracker:state', (event, state) => callback(state)),
	onItems: callback => ipcRenderer.on('tracker:items', (event, items) => callback(items)),
	getUpdate: () => ipcRenderer.invoke('update:get'),
	installUpdate: () => ipcRenderer.invoke('update:install'),
	onUpdate: callback => ipcRenderer.on('update:state', (event, state) => callback(state)),
	onShow: callback => ipcRenderer.on('app:show', (event, view) => callback(view))
})

import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import {
  IPC_CHANNELS,
  type AgentActivityEvent,
  type AppSettings,
  type BranchGraph,
  type GitSyncStatus,
  type MessageBackup,
  type RulesData,
  type SyncStatus,
  type UpdateCheckResult,
  type VaultChangeEvent,
  type VaultNote,
  type WorkLogEntry
} from '@shared/types'

const EXTRA_CHANNELS = {
  VAULT_SAVE_RULES: 'vault:save-rules',
  VAULT_GET_SYSTEM_MAP: 'vault:get-system-map',
  VAULT_SAVE_SYSTEM_MAP: 'vault:save-system-map'
} as const

export interface CrowBrainApi {
  getNotes: () => Promise<VaultNote[]>
  getNote: (pathOrTitle: string) => Promise<VaultNote | null>
  saveNote: (
    relPath: string,
    content: string,
    frontmatter?: Record<string, unknown>
  ) => Promise<VaultNote>
  deleteNote: (relPath: string) => Promise<boolean>
  getGraph: (folderFilter?: string) => Promise<BranchGraph>
  getRules: () => Promise<RulesData>
  saveRules: (
    type: 'global' | 'chat' | 'context',
    content: string,
    contextName?: string
  ) => Promise<RulesData>
  getSystemMap: () => Promise<string>
  updateSystemMap: (content: string) => Promise<string>
  selectVaultDirectory: () => Promise<string | null>
  getMessages: (opts?: {
    harness?: string
    sessionId?: string
    query?: string
    limit?: number
  }) => Promise<MessageBackup[]>
  saveMessage: (input: Omit<MessageBackup, 'id' | 'timestamp'>) => Promise<MessageBackup>
  getLogs: (opts?: {
    harness?: string
    category?: string
    query?: string
    limit?: number
  }) => Promise<WorkLogEntry[]>
  createLog: (input: Omit<WorkLogEntry, 'id' | 'timestamp'>) => Promise<WorkLogEntry>
  getSettings: () => Promise<AppSettings>
  setSettings: (partial: Partial<AppSettings>) => Promise<AppSettings>
  createProject: (name: string, customPath?: string) => Promise<AppSettings>
  switchProject: (projectId: string) => Promise<AppSettings>
  renameProject: (projectId: string, newName: string) => Promise<AppSettings>
  deleteProject: (projectId: string) => Promise<AppSettings>
  togglePinProject: (projectId: string) => Promise<AppSettings>
  getRecentActivity: () => Promise<AgentActivityEvent[]>
  onActivity: (cb: (event: AgentActivityEvent) => void) => () => void
  getVersion: () => Promise<string>
  checkUpdates: () => Promise<UpdateCheckResult>
  getStatus: () => Promise<{ mcpRunning: boolean; mcpPort: number; vaultPath: string }>
  getSyncStatus: () => Promise<SyncStatus>
  connectGoogleDrive: (clientId: string, clientSecret?: string) => Promise<SyncStatus>
  disconnectGoogleDrive: () => Promise<SyncStatus>
  syncNow: () => Promise<SyncStatus>
  onSyncStatus: (cb: (status: SyncStatus) => void) => () => void
  getGitSyncStatus: () => Promise<GitSyncStatus>
  runGitSyncNow: () => Promise<GitSyncStatus>
  selectGitSyncRoot: () => Promise<string | null>
  onGitSyncStatus: (cb: (status: GitSyncStatus) => void) => () => void
  onVaultChange: (cb: (event: VaultChangeEvent) => void) => () => void
  onUpdateAvailable: (cb: (result: UpdateCheckResult) => void) => () => void
}

const crowbrainApi: CrowBrainApi = {
  getNotes: () => ipcRenderer.invoke(IPC_CHANNELS.VAULT_GET_NOTES),
  getNote: (pathOrTitle) => ipcRenderer.invoke(IPC_CHANNELS.VAULT_GET_NOTE, pathOrTitle),
  saveNote: (relPath, content, frontmatter) =>
    ipcRenderer.invoke(IPC_CHANNELS.VAULT_SAVE_NOTE, relPath, content, frontmatter),
  deleteNote: (relPath) => ipcRenderer.invoke(IPC_CHANNELS.VAULT_DELETE_NOTE, relPath),
  getGraph: (folderFilter) => ipcRenderer.invoke(IPC_CHANNELS.VAULT_GET_GRAPH, folderFilter),
  getRules: () => ipcRenderer.invoke(IPC_CHANNELS.VAULT_GET_RULES),
  saveRules: (type, content, contextName) =>
    ipcRenderer.invoke(EXTRA_CHANNELS.VAULT_SAVE_RULES, type, content, contextName),
  getSystemMap: () => ipcRenderer.invoke(EXTRA_CHANNELS.VAULT_GET_SYSTEM_MAP),
  updateSystemMap: (content) => ipcRenderer.invoke(EXTRA_CHANNELS.VAULT_SAVE_SYSTEM_MAP, content),
  selectVaultDirectory: () => ipcRenderer.invoke(IPC_CHANNELS.VAULT_SELECT_DIRECTORY),
  getMessages: (opts) => ipcRenderer.invoke(IPC_CHANNELS.BACKUP_GET_MESSAGES, opts),
  saveMessage: (input) => ipcRenderer.invoke(IPC_CHANNELS.BACKUP_SAVE_MESSAGE, input),
  getLogs: (opts) => ipcRenderer.invoke(IPC_CHANNELS.LOG_GET_ENTRIES, opts),
  createLog: (input) => ipcRenderer.invoke(IPC_CHANNELS.LOG_CREATE_ENTRY, input),
  getSettings: () => ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_GET),
  setSettings: (partial) => ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_SET, partial),
  createProject: (name, customPath) =>
    ipcRenderer.invoke(IPC_CHANNELS.PROJECT_CREATE, name, customPath),
  switchProject: (projectId) => ipcRenderer.invoke(IPC_CHANNELS.PROJECT_SWITCH, projectId),
  renameProject: (projectId, newName) =>
    ipcRenderer.invoke(IPC_CHANNELS.PROJECT_RENAME, projectId, newName),
  deleteProject: (projectId) => ipcRenderer.invoke(IPC_CHANNELS.PROJECT_DELETE, projectId),
  togglePinProject: (projectId) =>
    ipcRenderer.invoke(IPC_CHANNELS.PROJECT_TOGGLE_PIN, projectId),
  getRecentActivity: () => ipcRenderer.invoke(IPC_CHANNELS.ACTIVITY_GET_RECENT),
  onActivity: (cb) => {
    const listener = (_event: IpcRendererEvent, payload: AgentActivityEvent): void => {
      cb(payload)
    }
    ipcRenderer.on(IPC_CHANNELS.ACTIVITY_ON_EVENT, listener)
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.ACTIVITY_ON_EVENT, listener)
    }
  },
  getVersion: () => ipcRenderer.invoke(IPC_CHANNELS.APP_GET_VERSION),
  checkUpdates: () => ipcRenderer.invoke(IPC_CHANNELS.APP_CHECK_UPDATES),
  getStatus: () => ipcRenderer.invoke(IPC_CHANNELS.APP_GET_STATUS),
  getSyncStatus: () => ipcRenderer.invoke(IPC_CHANNELS.SYNC_GET_STATUS),
  connectGoogleDrive: (clientId, clientSecret) =>
    ipcRenderer.invoke(IPC_CHANNELS.SYNC_CONNECT_GOOGLE, clientId, clientSecret),
  disconnectGoogleDrive: () => ipcRenderer.invoke(IPC_CHANNELS.SYNC_DISCONNECT_GOOGLE),
  syncNow: () => ipcRenderer.invoke(IPC_CHANNELS.SYNC_RUN_NOW),
  onSyncStatus: (cb) => {
    const listener = (_event: IpcRendererEvent, payload: SyncStatus): void => {
      cb(payload)
    }
    ipcRenderer.on(IPC_CHANNELS.SYNC_ON_STATUS, listener)
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.SYNC_ON_STATUS, listener)
    }
  },
  getGitSyncStatus: () => ipcRenderer.invoke(IPC_CHANNELS.GIT_SYNC_STATUS),
  runGitSyncNow: () => ipcRenderer.invoke(IPC_CHANNELS.GIT_SYNC_NOW),
  selectGitSyncRoot: () => ipcRenderer.invoke(IPC_CHANNELS.GIT_SYNC_SELECT_ROOT),
  onGitSyncStatus: (cb) => {
    const listener = (_event: IpcRendererEvent, payload: GitSyncStatus): void => {
      cb(payload)
    }
    ipcRenderer.on(IPC_CHANNELS.GIT_SYNC_ON_STATUS, listener)
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.GIT_SYNC_ON_STATUS, listener)
    }
  },
  onVaultChange: (cb) => {
    const listener = (_event: IpcRendererEvent, payload: VaultChangeEvent): void => {
      cb(payload)
    }
    ipcRenderer.on(IPC_CHANNELS.VAULT_ON_CHANGE, listener)
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.VAULT_ON_CHANGE, listener)
    }
  },
  onUpdateAvailable: (cb) => {
    const listener = (_event: IpcRendererEvent, payload: UpdateCheckResult): void => {
      cb(payload)
    }
    ipcRenderer.on(IPC_CHANNELS.APP_ON_UPDATE, listener)
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.APP_ON_UPDATE, listener)
    }
  }
}

if (process.contextIsolated) {
  contextBridge.exposeInMainWorld('crowbrain', crowbrainApi)
} else {
  ;(window as unknown as { crowbrain: CrowBrainApi }).crowbrain = crowbrainApi
}

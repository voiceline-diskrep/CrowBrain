export interface VaultNote {
  path: string
  title: string
  folder: string
  content: string
  frontmatter: Record<string, unknown>
  tags: string[]
  links: string[]
  backlinks: string[]
  updatedAt: number
}

export interface BranchGraphNode {
  id: string
  title: string
  path: string
  folder: string
  tags: string[]
  linkCount: number
}

export interface BranchGraphEdge {
  source: string
  target: string
}

export interface BranchGraph {
  nodes: BranchGraphNode[]
  edges: BranchGraphEdge[]
}

export interface MessageBackup {
  id: string
  timestamp: number
  harness: string
  sessionId: string
  role: 'user' | 'assistant' | 'system' | string
  message: string
  summaryForFutureSelf: string
  relatedFiles: string[]
  tags: string[]
}

export type WorkLogCategory = 'feature' | 'fix' | 'refactor' | 'release' | 'note' | string

export interface WorkLogEntry {
  id: string
  timestamp: number
  harness: string
  category: WorkLogCategory
  version?: string
  title: string
  details: string
  filesChanged: string[]
}

export interface ContextNote {
  name: string
  path: string
  content: string
}

export interface RulesData {
  globalRules: string
  chatRules: string
  contextNotes: ContextNote[]
}

export type ThemeMode = 'light' | 'dark' | 'custom'

export interface CustomThemeTokens {
  background: string
  surface: string
  surfaceAlt: string
  border: string
  text: string
  textMuted: string
  accent: string
  accentText: string
}

export type AnimationSpeed = 'normal' | 'reduced' | 'disabled'

export interface ProjectEntry {
  id: string
  name: string
  vaultPath: string
  createdAt: number
  pinned?: boolean
}

export type SyncState = 'idle' | 'syncing' | 'error'

export interface GitSyncConfig {
  repoUrl: string
  branch: string
  syncRootPath: string
  autoSync: boolean
  syncIntervalSeconds: number
}

export interface GitSyncStatus {
  configured: boolean
  state: SyncState
  lastSyncedAt?: number
  lastSummary?: string
  error?: string
}

export interface GoogleDriveConfig {
  clientId: string
  clientSecret?: string
  refreshToken?: string
  accessToken?: string
  tokenExpiresAt?: number
  accountEmail?: string
  autoSync: boolean
  syncIntervalSeconds: number
}

export interface SyncStatus {
  connected: boolean
  accountEmail?: string
  state: SyncState
  lastSyncedAt?: number
  lastSummary?: string
  error?: string
}

export interface AppSettings {
  vaultPath: string
  projects: ProjectEntry[]
  activeProjectId: string
  theme: ThemeMode
  customTheme: CustomThemeTokens
  animationSpeed: AnimationSpeed
  mcpPort: number
  checkUpdatesOnStartup: boolean
  googleDrive: GoogleDriveConfig
  gitSync: GitSyncConfig
}

export interface UpdateCheckResult {
  currentVersion: string
  latestVersion: string
  hasUpdate: boolean
  releaseUrl: string
  releaseNotes: string
  publishedAt: string
  error?: string
}

export interface AgentActivityEvent {
  id: string
  timestamp: number
  harness: string
  action: string
  detail: string
  project?: string
}

export const IPC_CHANNELS = {
  // Vault operations
  VAULT_GET_NOTES: 'vault:get-notes',
  VAULT_GET_NOTE: 'vault:get-note',
  VAULT_SAVE_NOTE: 'vault:save-note',
  VAULT_DELETE_NOTE: 'vault:delete-note',
  VAULT_GET_GRAPH: 'vault:get-graph',
  VAULT_GET_RULES: 'vault:get-rules',
  VAULT_SELECT_DIRECTORY: 'vault:select-directory',

  // Backup operations
  BACKUP_GET_MESSAGES: 'backup:get-messages',
  BACKUP_SAVE_MESSAGE: 'backup:save-message',

  // Work log operations
  LOG_GET_ENTRIES: 'logs:get-entries',
  LOG_CREATE_ENTRY: 'logs:create-entry',

  // Settings
  SETTINGS_GET: 'settings:get',
  SETTINGS_SET: 'settings:set',

  // Projects
  PROJECT_CREATE: 'project:create',
  PROJECT_SWITCH: 'project:switch',
  PROJECT_RENAME: 'project:rename',
  PROJECT_DELETE: 'project:delete',
  PROJECT_TOGGLE_PIN: 'project:toggle-pin',

  // Agent activity
  ACTIVITY_GET_RECENT: 'activity:get-recent',
  ACTIVITY_ON_EVENT: 'activity:on-event',

  // System and updates
  APP_GET_VERSION: 'app:get-version',
  APP_CHECK_UPDATES: 'app:check-updates',
  APP_GET_STATUS: 'app:get-status',

  // Cloud sync
  SYNC_GET_STATUS: 'sync:get-status',
  SYNC_CONNECT_GOOGLE: 'sync:connect-google',
  SYNC_DISCONNECT_GOOGLE: 'sync:disconnect-google',
  SYNC_RUN_NOW: 'sync:run-now',
  SYNC_ON_STATUS: 'sync:on-status',

  // Private Git sync
  GIT_SYNC_STATUS: 'git-sync:status',
  GIT_SYNC_NOW: 'git-sync:now',
  GIT_SYNC_SELECT_ROOT: 'git-sync:select-root',
  GIT_SYNC_ON_STATUS: 'git-sync:on-status'
} as const

export type IpcChannelKey = keyof typeof IPC_CHANNELS
export type IpcChannelValue = (typeof IPC_CHANNELS)[IpcChannelKey]

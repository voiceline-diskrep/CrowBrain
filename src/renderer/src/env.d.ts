/// <reference types="vite/client" />

declare module '*.jpg' {
  const src: string
  export default src
}

declare module '*.jpeg' {
  const src: string
  export default src
}

declare module '*.png' {
  const src: string
  export default src
}

declare module '*.svg' {
  const src: string
  export default src
}

import type {
  AgentActivityEvent,
  AppSettings,
  BranchGraph,
  GitSyncStatus,
  MessageBackup,
  RulesData,
  SyncStatus,
  UpdateCheckResult,
  VaultNote,
  WorkLogEntry
} from '@shared/types'

export interface CrowBrainAPI {
  getNotes(): Promise<VaultNote[]>
  getNote(pathOrTitle: string): Promise<VaultNote | null>
  saveNote(
    relPath: string,
    content: string,
    frontmatter?: Record<string, unknown>
  ): Promise<VaultNote>
  deleteNote(relPath: string): Promise<boolean>
  getGraph(folderFilter?: string): Promise<BranchGraph>
  getRules(): Promise<RulesData>
  saveRules(
    type: 'global' | 'chat' | 'context',
    content: string,
    contextName?: string
  ): Promise<RulesData>
  getSystemMap(): Promise<string>
  updateSystemMap(content: string): Promise<string>
  selectVaultDirectory(): Promise<string | null>
  getMessages(opts?: {
    harness?: string
    sessionId?: string
    query?: string
    limit?: number
  }): Promise<MessageBackup[]>
  saveMessage(input: Omit<MessageBackup, 'id' | 'timestamp'>): Promise<MessageBackup>
  getLogs(opts?: {
    harness?: string
    category?: string
    query?: string
    limit?: number
  }): Promise<WorkLogEntry[]>
  createLog(input: Omit<WorkLogEntry, 'id' | 'timestamp'>): Promise<WorkLogEntry>
  getSettings(): Promise<AppSettings>
  setSettings(partial: Partial<AppSettings>): Promise<AppSettings>
  createProject(name: string, customPath?: string): Promise<AppSettings>
  switchProject(projectId: string): Promise<AppSettings>
  renameProject(projectId: string, newName: string): Promise<AppSettings>
  deleteProject(projectId: string): Promise<AppSettings>
  togglePinProject(projectId: string): Promise<AppSettings>
  getRecentActivity(): Promise<AgentActivityEvent[]>
  onActivity(cb: (event: AgentActivityEvent) => void): () => void
  getVersion(): Promise<string>
  checkUpdates(): Promise<UpdateCheckResult>
  getStatus(): Promise<{ mcpRunning: boolean; mcpPort: number; vaultPath: string }>
  getSyncStatus(): Promise<SyncStatus>
  connectGoogleDrive(clientId: string, clientSecret?: string): Promise<SyncStatus>
  disconnectGoogleDrive(): Promise<SyncStatus>
  syncNow(): Promise<SyncStatus>
  onSyncStatus(cb: (status: SyncStatus) => void): () => void
  getGitSyncStatus(): Promise<GitSyncStatus>
  runGitSyncNow(): Promise<GitSyncStatus>
  selectGitSyncRoot(): Promise<string | null>
  onGitSyncStatus(cb: (status: GitSyncStatus) => void): () => void
}

declare global {
  interface Window {
    crowbrain: CrowBrainAPI
  }
}

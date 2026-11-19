import { existsSync, mkdirSync } from 'node:fs'
import { basename, join } from 'node:path'
import { app, BrowserWindow, dialog, ipcMain, nativeImage, shell } from 'electron'
import {
  IPC_CHANNELS,
  type AgentActivityEvent,
  type AppSettings,
  type GitSyncStatus,
  type MessageBackup,
  type SyncStatus,
  type VaultChangeEvent,
  type WorkLogEntry
} from '@shared/types'
import { SettingsManager } from './settings'
import { ProjectPool } from './vault/ProjectPool'
import { CrowBrainMcpServer } from './mcp/McpServer'
import { SyncManager } from './sync/SyncManager'
import { GitSyncManager } from './sync/GitSyncManager'
import { checkForUpdates } from './updater'

const EXTRA_CHANNELS = {
  VAULT_SAVE_RULES: 'vault:save-rules',
  VAULT_GET_SYSTEM_MAP: 'vault:get-system-map',
  VAULT_SAVE_SYSTEM_MAP: 'vault:save-system-map'
} as const

const MAX_ACTIVITY_HISTORY = 200

let mainWindow: BrowserWindow | null = null
let settingsManager: SettingsManager
let projectPool: ProjectPool
let mcpServer: CrowBrainMcpServer
let syncManager: SyncManager
let gitSyncManager: GitSyncManager
const recentActivity: AgentActivityEvent[] = []

function resolveWindowIconPath(): string | undefined {
  const candidates = [
    join(app.getAppPath(), 'assets', 'logo.jpg'),
    join(__dirname, '../../assets/logo.jpg'),
    join(process.resourcesPath, 'assets', 'logo.jpg')
  ]
  return candidates.find((candidate) => existsSync(candidate))
}

function recordAndBroadcastActivity(event: AgentActivityEvent): void {
  recentActivity.unshift(event)
  if (recentActivity.length > MAX_ACTIVITY_HISTORY) {
    recentActivity.length = MAX_ACTIVITY_HISTORY
  }
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(IPC_CHANNELS.ACTIVITY_ON_EVENT, event)
  }
}

function broadcastVaultChange(event: VaultChangeEvent): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(IPC_CHANNELS.VAULT_ON_CHANGE, event)
  }
}

async function syncProjectPool(): Promise<void> {
  const settings = settingsManager.getSettings()
  await projectPool.syncProjects(settings.projects, settings.activeProjectId)
}

function createWindow(): void {
  const iconPath = resolveWindowIconPath()
  const icon = iconPath ? nativeImage.createFromPath(iconPath) : undefined

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    show: false,
    title: 'CrowBrain',
    ...(icon && !icon.isEmpty() ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) {
      void shell.openExternal(url)
    }
    return { action: 'deny' }
  })

  mainWindow.webContents.once('did-finish-load', () => {
    const settings = settingsManager.getSettings()
    if (settings.checkUpdatesOnStartup) {
      void checkForUpdates(app.getVersion()).then((result) => {
        if (result.hasUpdate && mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send(IPC_CHANNELS.APP_ON_UPDATE, result)
        }
      })
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function registerIpcHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.VAULT_GET_NOTES, async () => {
    return projectPool.resolve().vault.getNotes()
  })

  ipcMain.handle(IPC_CHANNELS.VAULT_GET_NOTE, async (_event, pathOrTitle: string) => {
    return projectPool.resolve().vault.getNote(pathOrTitle)
  })

  ipcMain.handle(
    IPC_CHANNELS.VAULT_SAVE_NOTE,
    async (
      _event,
      relPath: string,
      content: string,
      frontmatter?: Record<string, unknown>
    ) => {
      return projectPool.resolve().vault.saveNote(relPath, content, frontmatter)
    }
  )

  ipcMain.handle(IPC_CHANNELS.VAULT_DELETE_NOTE, async (_event, relPath: string) => {
    return projectPool.resolve().vault.deleteNote(relPath)
  })

  ipcMain.handle(IPC_CHANNELS.VAULT_GET_GRAPH, async (_event, folderFilter?: string) => {
    return projectPool.resolve().vault.getBranchGraph(folderFilter)
  })

  ipcMain.handle(IPC_CHANNELS.VAULT_GET_RULES, async () => {
    return projectPool.resolve().vault.getRules()
  })

  ipcMain.handle(
    EXTRA_CHANNELS.VAULT_SAVE_RULES,
    async (
      _event,
      type: 'global' | 'chat' | 'context',
      content: string,
      contextName?: string
    ) => {
      return projectPool.resolve().vault.saveRules(type, content, contextName)
    }
  )

  ipcMain.handle(EXTRA_CHANNELS.VAULT_GET_SYSTEM_MAP, async () => {
    return projectPool.resolve().vault.getSystemMap()
  })

  ipcMain.handle(EXTRA_CHANNELS.VAULT_SAVE_SYSTEM_MAP, async (_event, content: string) => {
    return projectPool.resolve().vault.updateSystemMap(content)
  })

  ipcMain.handle(IPC_CHANNELS.VAULT_SELECT_DIRECTORY, async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory', 'createDirectory'],
      title: 'Select CrowBrain Vault Directory'
    })
    if (result.canceled || result.filePaths.length === 0) {
      return null
    }
    const selectedPath = result.filePaths[0]
    const current = settingsManager.getSettings()
    const existing = current.projects.find(
      (p) => p.vaultPath.toLowerCase() === selectedPath.toLowerCase()
    )
    if (existing) {
      settingsManager.updateSettings({
        vaultPath: existing.vaultPath,
        activeProjectId: existing.id
      })
    } else {
      const id = `proj-${Date.now()}`
      const projectName = basename(selectedPath) || 'Project'
      settingsManager.updateSettings({
        vaultPath: selectedPath,
        activeProjectId: id,
        projects: [
          ...current.projects,
          { id, name: projectName, vaultPath: selectedPath, createdAt: Date.now() }
        ]
      })
    }
    await syncProjectPool()
    return selectedPath
  })

  ipcMain.handle(
    IPC_CHANNELS.PROJECT_CREATE,
    async (_event, name: string, customPath?: string) => {
      const trimmed = name.trim()
      if (!trimmed) {
        return settingsManager.getSettings()
      }
      const current = settingsManager.getSettings()
      const slug =
        trimmed
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-+|-+$/g, '') || `project-${Date.now()}`
      const baseParent =
        current.gitSync.syncRootPath || join(app.getPath('documents'), 'CrowBrainProjects')
      let targetPath = customPath?.trim() || join(baseParent, slug)
      if (!customPath?.trim() && existsSync(targetPath)) {
        targetPath = join(baseParent, `${slug}-${Date.now()}`)
      }
      mkdirSync(targetPath, { recursive: true })

      const id = `proj-${Date.now()}`
      const now = Date.now()
      const updated = settingsManager.updateSettings({
        vaultPath: targetPath,
        activeProjectId: id,
        projects: [
          ...current.projects,
          { id, name: trimmed, slug, vaultPath: targetPath, createdAt: now, updatedAt: now }
        ]
      })
      await syncProjectPool()
      return updated
    }
  )

  ipcMain.handle(IPC_CHANNELS.PROJECT_SWITCH, async (_event, projectId: string) => {
    const current = settingsManager.getSettings()
    const target = current.projects.find((p) => p.id === projectId)
    if (!target) {
      return current
    }
    const updated = settingsManager.updateSettings({
      vaultPath: target.vaultPath,
      activeProjectId: target.id
    })
    await syncProjectPool()
    return updated
  })

  ipcMain.handle(
    IPC_CHANNELS.PROJECT_RENAME,
    async (_event, projectId: string, newName: string) => {
      const trimmed = newName.trim()
      const current = settingsManager.getSettings()
      if (!trimmed) return current
      const projects = current.projects.map((p) =>
        p.id === projectId ? { ...p, name: trimmed, updatedAt: Date.now() } : p
      )
      const updated = settingsManager.updateSettings({ projects })
      await syncProjectPool()
      return updated
    }
  )

  ipcMain.handle(IPC_CHANNELS.PROJECT_DELETE, async (_event, projectId: string) => {
    const current = settingsManager.getSettings()
    if (current.projects.length <= 1) {
      return current
    }
    const remaining = current.projects.filter((p) => p.id !== projectId)
    if (remaining.length === current.projects.length) {
      return current
    }
    const nextActive =
      current.activeProjectId === projectId
        ? remaining[0]
        : remaining.find((p) => p.id === current.activeProjectId) ?? remaining[0]
    const updated = settingsManager.updateSettings({
      projects: remaining,
      deletedProjectIds: [...(current.deletedProjectIds ?? []), projectId],
      activeProjectId: nextActive.id,
      vaultPath: nextActive.vaultPath
    })
    await syncProjectPool()
    return updated
  })

  ipcMain.handle(IPC_CHANNELS.PROJECT_TOGGLE_PIN, async (_event, projectId: string) => {
    const current = settingsManager.getSettings()
    const projects = current.projects.map((p) =>
      p.id === projectId ? { ...p, pinned: !p.pinned, updatedAt: Date.now() } : p
    )
    const updated = settingsManager.updateSettings({ projects })
    await syncProjectPool()
    return updated
  })

  ipcMain.handle(
    IPC_CHANNELS.BACKUP_GET_MESSAGES,
    async (
      _event,
      opts?: { harness?: string; sessionId?: string; query?: string; limit?: number }
    ) => {
      return projectPool.resolve().backups.getMessages(opts)
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.BACKUP_SAVE_MESSAGE,
    async (_event, input: Omit<MessageBackup, 'id' | 'timestamp'>) => {
      return projectPool.resolve().backups.saveMessage(input)
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.LOG_GET_ENTRIES,
    async (
      _event,
      opts?: { harness?: string; category?: string; query?: string; limit?: number }
    ) => {
      return projectPool.resolve().logs.getLogs(opts)
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.LOG_CREATE_ENTRY,
    async (_event, input: Omit<WorkLogEntry, 'id' | 'timestamp'>) => {
      return projectPool.resolve().logs.saveLog(input)
    }
  )

  ipcMain.handle(IPC_CHANNELS.SETTINGS_GET, () => {
    return settingsManager.getSettings()
  })

  ipcMain.handle(IPC_CHANNELS.SETTINGS_SET, async (_event, partial: Partial<AppSettings>) => {
    const previous = settingsManager.getSettings()
    const updated = settingsManager.updateSettings(partial)

    if (
      (partial.vaultPath && partial.vaultPath !== previous.vaultPath) ||
      partial.projects ||
      partial.activeProjectId
    ) {
      await syncProjectPool()
    }

    if (typeof partial.mcpPort === 'number' && partial.mcpPort !== previous.mcpPort) {
      await mcpServer.start(updated.mcpPort)
    }

    if (partial.googleDrive) {
      if (updated.googleDrive.autoSync && updated.googleDrive.refreshToken) {
        syncManager.startAutoSync()
      } else {
        syncManager.stopAutoSync()
      }
    }

    if (partial.gitSync) {
      gitSyncManager.refreshConfigured()
      if (updated.gitSync.autoSync && updated.gitSync.repoUrl.trim()) {
        gitSyncManager.startAutoSync()
      } else {
        gitSyncManager.stopAutoSync()
      }
    }

    return updated
  })

  ipcMain.handle(IPC_CHANNELS.GIT_SYNC_STATUS, () => {
    return gitSyncManager.getStatus()
  })

  ipcMain.handle(IPC_CHANNELS.GIT_SYNC_NOW, async () => {
    return gitSyncManager.syncNow()
  })

  ipcMain.handle(IPC_CHANNELS.GIT_SYNC_SELECT_ROOT, async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory', 'createDirectory'],
      title: 'Select CrowBrain Projects Root Folder'
    })
    if (result.canceled || result.filePaths.length === 0) {
      return null
    }
    const selectedRoot = result.filePaths[0]
    const current = settingsManager.getSettings()
    settingsManager.updateSettings({
      gitSync: {
        ...current.gitSync,
        syncRootPath: selectedRoot
      }
    })
    return selectedRoot
  })

  ipcMain.handle(IPC_CHANNELS.SYNC_GET_STATUS, () => {
    return syncManager.getStatus()
  })

  ipcMain.handle(
    IPC_CHANNELS.SYNC_CONNECT_GOOGLE,
    async (_event, clientId: string, clientSecret?: string) => {
      return syncManager.connectGoogleDrive(clientId, clientSecret)
    }
  )

  ipcMain.handle(IPC_CHANNELS.SYNC_DISCONNECT_GOOGLE, () => {
    return syncManager.disconnectGoogleDrive()
  })

  ipcMain.handle(IPC_CHANNELS.SYNC_RUN_NOW, async () => {
    return syncManager.syncNow()
  })

  ipcMain.handle(IPC_CHANNELS.ACTIVITY_GET_RECENT, () => {
    return [...recentActivity]
  })

  ipcMain.handle(IPC_CHANNELS.APP_GET_VERSION, () => {
    return app.getVersion()
  })

  ipcMain.handle(IPC_CHANNELS.APP_CHECK_UPDATES, async () => {
    return checkForUpdates(app.getVersion())
  })

  ipcMain.handle(IPC_CHANNELS.APP_GET_STATUS, () => {
    return {
      mcpRunning: mcpServer.isRunning(),
      mcpPort: mcpServer.getPort(),
      vaultPath: settingsManager.getSettings().vaultPath
    }
  })
}

async function bootstrap(): Promise<void> {
  settingsManager = new SettingsManager(app.getPath('userData'))
  const settings = settingsManager.getSettings()

  projectPool = new ProjectPool(broadcastVaultChange)
  await projectPool.syncProjects(settings.projects, settings.activeProjectId)

  mcpServer = new CrowBrainMcpServer({
    resolveProject: (projectRef) => projectPool.resolve(projectRef),
    listProjects: () => projectPool.listProjects(),
    onActivity: recordAndBroadcastActivity,
    onVaultChange: broadcastVaultChange,
    version: app.getVersion()
  })

  try {
    await mcpServer.start(settings.mcpPort)
  } catch (err) {
    console.error('Failed to start MCP server:', err)
  }

  syncManager = new SyncManager(
    settingsManager,
    async () => {
      await syncProjectPool()
    },
    (status: SyncStatus) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(IPC_CHANNELS.SYNC_ON_STATUS, status)
      }
    }
  )
  if (settings.googleDrive.refreshToken && settings.googleDrive.autoSync) {
    syncManager.startAutoSync()
    void syncManager.syncNow()
  }

  gitSyncManager = new GitSyncManager(
    settingsManager,
    async () => {
      await syncProjectPool()
    },
    (status: GitSyncStatus) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(IPC_CHANNELS.GIT_SYNC_ON_STATUS, status)
      }
    }
  )
  if (settings.gitSync.repoUrl.trim() && settings.gitSync.autoSync) {
    gitSyncManager.startAutoSync()
    void gitSyncManager.syncNow()
  }

  registerIpcHandlers()
  createWindow()
}

app.whenReady().then(() => {
  void bootstrap()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('before-quit', () => {
  syncManager?.stopAutoSync()
  gitSyncManager?.stopAutoSync()
  void mcpServer?.stop()
  void projectPool?.closeAll()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

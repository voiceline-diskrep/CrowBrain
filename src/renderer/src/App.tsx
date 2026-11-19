import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import { Download, ExternalLink, X } from 'lucide-react'
import type {
  AppSettings,
  CustomThemeTokens,
  GitSyncStatus,
  SyncStatus,
  UpdateCheckResult,
  VaultNote
} from '@shared/types'
import { BackupsView } from './components/BackupsView'
import { BranchesView } from './components/BranchesView'
import { LogsView } from './components/LogsView'
import { McpConnectView } from './components/McpConnectView'
import { RulesView } from './components/RulesView'
import { SettingsView } from './components/SettingsView'
import { Sidebar } from './components/Sidebar'
import { SystemMapView } from './components/SystemMapView'
import type { NavTab } from './components/types'

const DEFAULT_CUSTOM_THEME: CustomThemeTokens = {
  background: '#0a0a0a',
  surface: '#121212',
  surfaceAlt: '#1c1c1e',
  border: '#2a2a2d',
  text: '#f4f4f5',
  textMuted: '#8e8e93',
  accent: '#e4e4e7',
  accentText: '#0a0a0a'
}

const DEFAULT_SETTINGS: AppSettings = {
  vaultPath: '',
  projects: [],
  activeProjectId: 'default',
  theme: 'dark',
  customTheme: DEFAULT_CUSTOM_THEME,
  animationSpeed: 'normal',
  mcpPort: 3345,
  checkUpdatesOnStartup: false,
  googleDrive: {
    clientId: '',
    clientSecret: '',
    autoSync: true,
    syncIntervalSeconds: 60
  },
  gitSync: {
    repoUrl: '',
    branch: 'main',
    syncRootPath: '',
    autoSync: false,
    syncIntervalSeconds: 60
  }
}

const CUSTOM_CSS_VARS: Array<[string, keyof CustomThemeTokens]> = [
  ['--cb-bg', 'background'],
  ['--cb-surface', 'surface'],
  ['--cb-surface-alt', 'surfaceAlt'],
  ['--cb-border', 'border'],
  ['--cb-text', 'text'],
  ['--cb-text-muted', 'textMuted'],
  ['--cb-accent', 'accent'],
  ['--cb-accent-text', 'accentText']
]

export function App(): ReactElement {
  const [activeTab, setActiveTab] = useState<NavTab>('branches')
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS)
  const [notes, setNotes] = useState<VaultNote[]>([])
  const [selectedNotePath, setSelectedNotePath] = useState<string | null>(null)
  const [mcpRunning, setMcpRunning] = useState<boolean>(false)
  const [mcpPort, setMcpPort] = useState<number>(3345)
  const [appVersion, setAppVersion] = useState<string>('0.6.1')
  const [syncStatus, setSyncStatus] = useState<SyncStatus>({ connected: false, state: 'idle' })
  const [gitSyncStatus, setGitSyncStatus] = useState<GitSyncStatus>({
    configured: false,
    state: 'idle'
  })
  const [availableUpdate, setAvailableUpdate] = useState<UpdateCheckResult | null>(null)
  const [backupsRevision, setBackupsRevision] = useState<number>(0)
  const [logsRevision, setLogsRevision] = useState<number>(0)
  const activeProjectIdRef = useRef<string>(settings.activeProjectId)

  useEffect(() => {
    activeProjectIdRef.current = settings.activeProjectId
  }, [settings.activeProjectId])

  const refreshNotes = useCallback(async () => {
    try {
      const list = await window.crowbrain.getNotes()
      setNotes(list)
    } catch (err) {
      console.error('Failed to load vault notes:', err)
    }
  }, [])

  const refreshStatus = useCallback(async () => {
    try {
      const status = await window.crowbrain.getStatus()
      setMcpRunning(status.mcpRunning)
      setMcpPort(status.mcpPort)
    } catch (err) {
      console.error('Failed to load status:', err)
    }
  }, [])

  useEffect(() => {
    let mounted = true
    async function init(): Promise<void> {
      try {
        const [loadedSettings, loadedVersion, loadedSync, loadedGitSync] = await Promise.all([
          window.crowbrain.getSettings(),
          window.crowbrain.getVersion(),
          window.crowbrain.getSyncStatus(),
          window.crowbrain.getGitSyncStatus()
        ])
        if (!mounted) return
        setSettings(loadedSettings)
        setAppVersion(loadedVersion)
        setSyncStatus(loadedSync)
        setGitSyncStatus(loadedGitSync)
      } catch (err) {
        console.error('Failed to initialize settings:', err)
      }
      await Promise.all([refreshNotes(), refreshStatus()])
    }
    void init()
    const unsubscribeSync = window.crowbrain.onSyncStatus((nextStatus) => {
      setSyncStatus(nextStatus)
      if (nextStatus.state === 'idle' && nextStatus.lastSyncedAt) {
        void window.crowbrain.getSettings().then(setSettings)
        void refreshNotes()
      }
    })
    const unsubscribeGitSync = window.crowbrain.onGitSyncStatus((nextStatus) => {
      setGitSyncStatus(nextStatus)
      if (nextStatus.state === 'idle' && nextStatus.lastSyncedAt) {
        void window.crowbrain.getSettings().then(setSettings)
        void refreshNotes()
      }
    })
    const unsubscribeVaultChange = window.crowbrain.onVaultChange((event) => {
      if (event.projectId !== activeProjectIdRef.current) return
      if (event.kind === 'backups') {
        setBackupsRevision((r) => r + 1)
      } else if (event.kind === 'logs') {
        setLogsRevision((r) => r + 1)
      } else {
        void refreshNotes()
      }
    })
    const unsubscribeUpdate = window.crowbrain.onUpdateAvailable((result) => {
      if (result.hasUpdate) {
        setAvailableUpdate(result)
      }
    })
    return () => {
      mounted = false
      unsubscribeSync()
      unsubscribeGitSync()
      unsubscribeVaultChange()
      unsubscribeUpdate()
    }
  }, [refreshNotes, refreshStatus])

  // Apply theme and animation attributes + custom CSS variables
  useEffect(() => {
    const root = document.documentElement
    root.setAttribute('data-theme', settings.theme)
    root.setAttribute('data-animation', settings.animationSpeed)

    if (settings.theme === 'custom') {
      for (const [cssVar, tokenKey] of CUSTOM_CSS_VARS) {
        root.style.setProperty(cssVar, settings.customTheme[tokenKey])
      }
    } else {
      for (const [cssVar] of CUSTOM_CSS_VARS) {
        root.style.removeProperty(cssVar)
      }
    }
  }, [settings.theme, settings.customTheme, settings.animationSpeed])

  const handleUpdateSettings = async (partial: Partial<AppSettings>): Promise<void> => {
    try {
      const updated = await window.crowbrain.setSettings(partial)
      setSettings(updated)
      if (typeof partial.mcpPort === 'number') {
        await refreshStatus()
      }
    } catch (err) {
      console.error('Failed to update settings:', err)
    }
  }

  const handleSelectVaultDirectory = async (): Promise<void> => {
    try {
      const selected = await window.crowbrain.selectVaultDirectory()
      if (selected) {
        const updated = await window.crowbrain.getSettings()
        setSettings(updated)
        setSelectedNotePath(null)
        await Promise.all([refreshNotes(), refreshStatus()])
      }
    } catch (err) {
      console.error('Failed to select vault directory:', err)
    }
  }

  const handleCreateProject = async (name: string): Promise<void> => {
    try {
      const updated = await window.crowbrain.createProject(name)
      setSettings(updated)
      setSelectedNotePath(null)
      await Promise.all([refreshNotes(), refreshStatus()])
    } catch (err) {
      console.error('Failed to create project:', err)
    }
  }

  const handleSwitchProject = async (projectId: string): Promise<void> => {
    if (projectId === settings.activeProjectId) return
    try {
      const updated = await window.crowbrain.switchProject(projectId)
      setSettings(updated)
      setSelectedNotePath(null)
      await Promise.all([refreshNotes(), refreshStatus()])
    } catch (err) {
      console.error('Failed to switch project:', err)
    }
  }

  const handleRenameProject = async (projectId: string, newName: string): Promise<void> => {
    try {
      const updated = await window.crowbrain.renameProject(projectId, newName)
      setSettings(updated)
    } catch (err) {
      console.error('Failed to rename project:', err)
    }
  }

  const handleDeleteProject = async (projectId: string): Promise<void> => {
    try {
      const updated = await window.crowbrain.deleteProject(projectId)
      setSettings(updated)
      setSelectedNotePath(null)
      await Promise.all([refreshNotes(), refreshStatus()])
    } catch (err) {
      console.error('Failed to delete project:', err)
    }
  }

  const handleTogglePinProject = async (projectId: string): Promise<void> => {
    try {
      const updated = await window.crowbrain.togglePinProject(projectId)
      setSettings(updated)
    } catch (err) {
      console.error('Failed to toggle pin:', err)
    }
  }

  const handleSelectGitSyncRoot = async (): Promise<void> => {
    try {
      const selected = await window.crowbrain.selectGitSyncRoot()
      if (selected) {
        const updated = await window.crowbrain.getSettings()
        setSettings(updated)
      }
    } catch (err) {
      console.error('Failed to select projects root folder:', err)
    }
  }

  const handleSelectNoteFromSidebar = (note: VaultNote): void => {
    const normalized = note.path.replace(/\\/g, '/')
    if (normalized === 'system-map.md') {
      setActiveTab('system-map')
      return
    }
    if (normalized.startsWith('rules/')) {
      setActiveTab('rules')
      return
    }
    setSelectedNotePath(note.path)
    setActiveTab('branches')
  }

  return (
    <div
      className="h-screen w-screen flex overflow-hidden cb-transition"
      style={{
        backgroundColor: 'var(--cb-bg)',
        color: 'var(--cb-text)'
      }}
    >
      <Sidebar
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        projects={settings.projects}
        activeProjectId={settings.activeProjectId}
        onSelectProject={(id) => void handleSwitchProject(id)}
        onCreateProject={(name) => void handleCreateProject(name)}
        onRenameProject={(id, name) => void handleRenameProject(id, name)}
        onDeleteProject={(id) => void handleDeleteProject(id)}
        onTogglePinProject={(id) => void handleTogglePinProject(id)}
        notes={notes}
        selectedNotePath={selectedNotePath}
        onSelectNote={handleSelectNoteFromSidebar}
        mcpRunning={mcpRunning}
        mcpPort={mcpPort}
      />

      <main className="flex-1 min-w-0 h-full flex flex-col overflow-hidden">
        {availableUpdate && (
          <div
            className="px-4 py-2 flex items-center justify-between gap-3 text-xs shrink-0"
            style={{
              backgroundColor: 'var(--cb-surface-alt)',
              borderBottom: '1px solid var(--cb-border)',
              color: 'var(--cb-text)'
            }}
          >
            <div className="flex items-center gap-2 min-w-0">
              <Download size={13} className="shrink-0" />
              <span className="truncate">
                Update available: v{availableUpdate.latestVersion} (current v
                {availableUpdate.currentVersion})
              </span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {availableUpdate.releaseUrl && (
                <a
                  href={availableUpdate.releaseUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded font-medium"
                  style={{
                    backgroundColor: 'var(--cb-accent)',
                    color: 'var(--cb-accent-text)'
                  }}
                >
                  <span>Download</span>
                  <ExternalLink size={11} />
                </a>
              )}
              <button
                type="button"
                onClick={() => setAvailableUpdate(null)}
                title="Dismiss"
                className="p-0.5 rounded cursor-pointer opacity-70 hover:opacity-100"
              >
                <X size={13} />
              </button>
            </div>
          </div>
        )}
        <div key={activeTab} className="flex-1 min-h-0 cb-view-enter">
          {activeTab === 'branches' && (
            <BranchesView
              key={settings.activeProjectId}
              notes={notes}
              selectedNotePath={selectedNotePath}
              onSelectNotePath={setSelectedNotePath}
              onRefreshNotes={refreshNotes}
            />
          )}

          {activeTab === 'backups' && (
            <BackupsView key={settings.activeProjectId} refreshSignal={backupsRevision} />
          )}

          {activeTab === 'logs' && (
            <LogsView key={settings.activeProjectId} refreshSignal={logsRevision} />
          )}

          {activeTab === 'system-map' && (
            <SystemMapView key={settings.activeProjectId} onRefreshNotes={refreshNotes} />
          )}

          {activeTab === 'rules' && (
            <RulesView key={settings.activeProjectId} onRefreshNotes={refreshNotes} />
          )}

          {activeTab === 'mcp' && (
            <McpConnectView
              mcpRunning={mcpRunning}
              mcpPort={mcpPort}
              projects={settings.projects}
              onRefreshStatus={refreshStatus}
            />
          )}

          {activeTab === 'settings' && (
            <SettingsView
              settings={settings}
              appVersion={appVersion}
              syncStatus={syncStatus}
              gitSyncStatus={gitSyncStatus}
              onUpdateSettings={handleUpdateSettings}
              onSelectVaultDirectory={handleSelectVaultDirectory}
              onSelectGitSyncRoot={handleSelectGitSyncRoot}
            />
          )}
        </div>
      </main>
    </div>
  )
}

export default App

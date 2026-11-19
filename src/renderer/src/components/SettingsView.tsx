import { useEffect, useState } from 'react'
import type { ReactElement } from 'react'
import { Cloud, CloudOff, Download, ExternalLink, FolderOpen, GitBranch, RefreshCw } from 'lucide-react'
import type {
  AnimationSpeed,
  AppSettings,
  CustomThemeTokens,
  GitSyncStatus,
  SyncStatus,
  ThemeMode,
  UpdateCheckResult
} from '@shared/types'
import { formatTimestamp } from './types'

interface SettingsViewProps {
  settings: AppSettings
  appVersion: string
  syncStatus: SyncStatus
  gitSyncStatus: GitSyncStatus
  onUpdateSettings: (partial: Partial<AppSettings>) => Promise<void>
  onSelectVaultDirectory: () => Promise<void>
  onSelectGitSyncRoot: () => Promise<void>
}

const CUSTOM_TOKEN_FIELDS: Array<{ key: keyof CustomThemeTokens; label: string }> = [
  { key: 'background', label: 'Background' },
  { key: 'surface', label: 'Surface' },
  { key: 'surfaceAlt', label: 'Surface Alt' },
  { key: 'border', label: 'Border' },
  { key: 'text', label: 'Text' },
  { key: 'textMuted', label: 'Muted Text' },
  { key: 'accent', label: 'Accent' },
  { key: 'accentText', label: 'Accent Text' }
]

const ANIMATION_OPTIONS: Array<{
  id: AnimationSpeed
  label: string
  detail: string
}> = [
  { id: 'normal', label: 'Normal', detail: '220ms cubic-bezier(0.4, 0, 0.2, 1)' },
  { id: 'reduced', label: 'Reduced', detail: '90ms cubic-bezier(0.4, 0, 0.2, 1)' },
  { id: 'disabled', label: 'Disabled', detail: '0ms' }
]

export function SettingsView({
  settings,
  appVersion,
  syncStatus,
  gitSyncStatus,
  onUpdateSettings,
  onSelectVaultDirectory,
  onSelectGitSyncRoot
}: SettingsViewProps): ReactElement {
  const [checkingUpdates, setCheckingUpdates] = useState(false)
  const [updateResult, setUpdateResult] = useState<UpdateCheckResult | null>(null)
  const [clientIdInput, setClientIdInput] = useState(settings.googleDrive.clientId || '')
  const [clientSecretInput, setClientSecretInput] = useState(
    settings.googleDrive.clientSecret || ''
  )
  const [syncBusy, setSyncBusy] = useState(false)
  const [gitRepoInput, setGitRepoInput] = useState(settings.gitSync.repoUrl || '')
  const [gitBranchInput, setGitBranchInput] = useState(settings.gitSync.branch || 'main')
  const [gitBusy, setGitBusy] = useState(false)
  const [mcpPortInput, setMcpPortInput] = useState(String(settings.mcpPort || 3345))

  useEffect(() => {
    setClientIdInput(settings.googleDrive.clientId || '')
    setClientSecretInput(settings.googleDrive.clientSecret || '')
  }, [settings.googleDrive.clientId, settings.googleDrive.clientSecret])

  useEffect(() => {
    setGitRepoInput(settings.gitSync.repoUrl || '')
    setGitBranchInput(settings.gitSync.branch || 'main')
  }, [settings.gitSync.repoUrl, settings.gitSync.branch])

  useEffect(() => {
    setMcpPortInput(String(settings.mcpPort || 3345))
  }, [settings.mcpPort])

  const handleSaveMcpPort = (): void => {
    const parsed = Number.parseInt(mcpPortInput, 10)
    if (Number.isNaN(parsed) || parsed < 1024 || parsed > 65535) {
      setMcpPortInput(String(settings.mcpPort))
      return
    }
    if (parsed !== settings.mcpPort) {
      void onUpdateSettings({ mcpPort: parsed })
    }
  }

  const handleSaveGitConfig = async (): Promise<void> => {
    await onUpdateSettings({
      gitSync: {
        ...settings.gitSync,
        repoUrl: gitRepoInput.trim(),
        branch: gitBranchInput.trim() || 'main'
      }
    })
  }

  const handleGitSyncNow = async (): Promise<void> => {
    setGitBusy(true)
    try {
      await handleSaveGitConfig()
      await window.crowbrain.runGitSyncNow()
    } finally {
      setGitBusy(false)
    }
  }

  const handleConnectGoogleDrive = async (): Promise<void> => {
    if (!clientIdInput.trim()) return
    setSyncBusy(true)
    try {
      await window.crowbrain.connectGoogleDrive(clientIdInput.trim(), clientSecretInput.trim())
    } finally {
      setSyncBusy(false)
    }
  }

  const handleDisconnectGoogleDrive = async (): Promise<void> => {
    setSyncBusy(true)
    try {
      await window.crowbrain.disconnectGoogleDrive()
    } finally {
      setSyncBusy(false)
    }
  }

  const handleSyncNow = async (): Promise<void> => {
    setSyncBusy(true)
    try {
      await window.crowbrain.syncNow()
    } finally {
      setSyncBusy(false)
    }
  }

  const handleThemeChange = (theme: ThemeMode): void => {
    void onUpdateSettings({ theme })
  }

  const handleCustomTokenChange = (key: keyof CustomThemeTokens, value: string): void => {
    void onUpdateSettings({
      customTheme: {
        ...settings.customTheme,
        [key]: value
      }
    })
  }

  const handleAnimationChange = (animationSpeed: AnimationSpeed): void => {
    void onUpdateSettings({ animationSpeed })
  }

  const handleCheckUpdates = async (): Promise<void> => {
    setCheckingUpdates(true)
    try {
      const result = await window.crowbrain.checkUpdates()
      setUpdateResult(result)
    } catch (err) {
      setUpdateResult({
        currentVersion: appVersion,
        latestVersion: appVersion,
        hasUpdate: false,
        releaseUrl: '',
        releaseNotes: '',
        publishedAt: '',
        error: err instanceof Error ? err.message : 'Update check failed'
      })
    } finally {
      setCheckingUpdates(false)
    }
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div
        className="px-5 py-3 shrink-0"
        style={{
          backgroundColor: 'var(--cb-surface)',
          borderBottom: '1px solid var(--cb-border)'
        }}
      >
        <h1 className="text-sm font-semibold">Settings</h1>
        <p className="text-xs" style={{ color: 'var(--cb-text-muted)' }}>
          Configure vault location, appearance, animations, and updates.
        </p>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6 max-w-3xl">
        {/* Vault Location */}
        <section
          className="p-4 rounded-lg space-y-3"
          style={{
            backgroundColor: 'var(--cb-surface)',
            border: '1px solid var(--cb-border)'
          }}
        >
          <div>
            <h2 className="text-xs font-semibold">Vault Directory</h2>
            <p className="text-xs mt-0.5" style={{ color: 'var(--cb-text-muted)' }}>
              Local folder where branch notes, rules, system map, and backups are stored.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <div
              className="flex-1 px-3 py-2 rounded text-xs font-mono truncate"
              style={{
                backgroundColor: 'var(--cb-surface-alt)',
                border: '1px solid var(--cb-border)',
                color: 'var(--cb-text)'
              }}
              title={settings.vaultPath}
            >
              {settings.vaultPath || 'Not configured'}
            </div>
            <button
              type="button"
              onClick={() => void onSelectVaultDirectory()}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded text-xs font-medium cb-transition cursor-pointer"
              style={{
                backgroundColor: 'var(--cb-accent)',
                color: 'var(--cb-accent-text)'
              }}
            >
              <FolderOpen size={14} />
              <span>Choose Folder</span>
            </button>
          </div>

          <div
            className="pt-3 flex items-center justify-between gap-3 flex-wrap"
            style={{ borderTop: '1px solid var(--cb-border)' }}
          >
            <div>
              <div className="text-xs font-medium">MCP Server Port</div>
              <div className="text-[11px]" style={{ color: 'var(--cb-text-muted)' }}>
                Local port for SSE connections on 127.0.0.1 (1024-65535).
              </div>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={1024}
                max={65535}
                value={mcpPortInput}
                onChange={(e) => setMcpPortInput(e.target.value)}
                onBlur={handleSaveMcpPort}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSaveMcpPort()
                }}
                className="w-24 px-2.5 py-1.5 rounded text-xs font-mono outline-none"
                style={{
                  backgroundColor: 'var(--cb-bg)',
                  border: '1px solid var(--cb-border)',
                  color: 'var(--cb-text)'
                }}
              />
              <button
                type="button"
                onClick={handleSaveMcpPort}
                className="px-2.5 py-1.5 rounded text-xs font-medium cb-transition cursor-pointer"
                style={{
                  backgroundColor: 'var(--cb-surface-alt)',
                  border: '1px solid var(--cb-border)',
                  color: 'var(--cb-text)'
                }}
              >
                Apply
              </button>
            </div>
          </div>
        </section>

        {/* Theme */}
        <section
          className="p-4 rounded-lg space-y-4"
          style={{
            backgroundColor: 'var(--cb-surface)',
            border: '1px solid var(--cb-border)'
          }}
        >
          <div>
            <h2 className="text-xs font-semibold">Theme</h2>
            <p className="text-xs mt-0.5" style={{ color: 'var(--cb-text-muted)' }}>
              Select a preset theme or customize every surface color token.
            </p>
          </div>

          <div className="grid grid-cols-3 gap-2">
            {(['light', 'dark', 'custom'] as ThemeMode[]).map((mode) => {
              const active = settings.theme === mode
              return (
                <button
                  key={mode}
                  type="button"
                  onClick={() => handleThemeChange(mode)}
                  className="px-3 py-2 rounded text-xs font-medium capitalize cb-transition cursor-pointer"
                  style={{
                    backgroundColor: active ? 'var(--cb-accent)' : 'var(--cb-surface-alt)',
                    color: active ? 'var(--cb-accent-text)' : 'var(--cb-text)',
                    border: '1px solid var(--cb-border)'
                  }}
                >
                  {mode}
                </button>
              )
            })}
          </div>

          {settings.theme === 'custom' && (
            <div
              className="pt-3 grid grid-cols-2 sm:grid-cols-4 gap-3 cb-view-enter"
              style={{ borderTop: '1px solid var(--cb-border)' }}
            >
              {CUSTOM_TOKEN_FIELDS.map(({ key, label }) => {
                const value = settings.customTheme[key]
                return (
                  <div key={key} className="space-y-1">
                    <label
                      className="block text-[11px]"
                      style={{ color: 'var(--cb-text-muted)' }}
                    >
                      {label}
                    </label>
                    <div className="flex items-center gap-1.5">
                      <input
                        type="color"
                        value={value}
                        onChange={(e) => handleCustomTokenChange(key, e.target.value)}
                        className="w-7 h-7 rounded cursor-pointer border-0 bg-transparent p-0"
                      />
                      <input
                        type="text"
                        value={value}
                        onChange={(e) => handleCustomTokenChange(key, e.target.value)}
                        className="w-full min-w-0 px-2 py-1 rounded text-[11px] font-mono outline-none"
                        style={{
                          backgroundColor: 'var(--cb-surface-alt)',
                          border: '1px solid var(--cb-border)',
                          color: 'var(--cb-text)'
                        }}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </section>

        {/* Animation Speed */}
        <section
          className="p-4 rounded-lg space-y-3"
          style={{
            backgroundColor: 'var(--cb-surface)',
            border: '1px solid var(--cb-border)'
          }}
        >
          <div>
            <h2 className="text-xs font-semibold">Animation Speed</h2>
            <p className="text-xs mt-0.5" style={{ color: 'var(--cb-text-muted)' }}>
              Controls transition durations for views, drawers, and modals.
            </p>
          </div>

          <div className="grid grid-cols-3 gap-2">
            {ANIMATION_OPTIONS.map((opt) => {
              const active = settings.animationSpeed === opt.id
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => handleAnimationChange(opt.id)}
                  className="p-2.5 rounded text-left cb-transition cursor-pointer"
                  style={{
                    backgroundColor: active ? 'var(--cb-surface-alt)' : 'var(--cb-bg)',
                    border: active
                      ? '1px solid var(--cb-accent)'
                      : '1px solid var(--cb-border)'
                  }}
                >
                  <div className="text-xs font-medium">{opt.label}</div>
                  <div className="text-[10px] mt-0.5" style={{ color: 'var(--cb-text-muted)' }}>
                    {opt.detail}
                  </div>
                </button>
              )
            })}
          </div>
        </section>

        {/* Private GitHub Sync */}
        <section
          className="p-4 rounded-lg space-y-3"
          style={{
            backgroundColor: 'var(--cb-surface)',
            border: '1px solid var(--cb-border)'
          }}
        >
          <div className="flex items-center justify-between gap-2">
            <div>
              <h2 className="text-xs font-semibold flex items-center gap-1.5">
                <GitBranch size={14} />
                <span>Private GitHub Sync</span>
              </h2>
              <p className="text-xs mt-0.5" style={{ color: 'var(--cb-text-muted)' }}>
                Stores all new projects inside one root folder and syncs them with a private GitHub
                repository across devices.
              </p>
            </div>
            {gitSyncStatus.configured && (
              <span
                className="px-2 py-0.5 rounded text-[11px] font-medium shrink-0"
                style={{
                  backgroundColor: 'var(--cb-surface-alt)',
                  border: '1px solid var(--cb-border)',
                  color: 'var(--cb-text)'
                }}
              >
                Configured
              </span>
            )}
          </div>

          <div className="space-y-2">
            <div className="text-[11px] font-medium" style={{ color: 'var(--cb-text-muted)' }}>
              Projects Root Folder (all new projects are created inside this folder)
            </div>
            <div className="flex items-center gap-2">
              <div
                className="flex-1 px-3 py-1.5 rounded text-xs font-mono truncate"
                style={{
                  backgroundColor: 'var(--cb-surface-alt)',
                  border: '1px solid var(--cb-border)',
                  color: 'var(--cb-text)'
                }}
                title={settings.gitSync.syncRootPath}
              >
                {settings.gitSync.syncRootPath || 'Default'}
              </div>
              <button
                type="button"
                onClick={() => void onSelectGitSyncRoot()}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium cb-transition cursor-pointer"
                style={{
                  backgroundColor: 'var(--cb-surface-alt)',
                  color: 'var(--cb-text)',
                  border: '1px solid var(--cb-border)'
                }}
              >
                <FolderOpen size={13} />
                <span>Change Folder</span>
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            <input
              type="text"
              value={gitRepoInput}
              onChange={(e) => setGitRepoInput(e.target.value)}
              onBlur={() => void handleSaveGitConfig()}
              placeholder="owner/repo or https://github.com/owner/repo.git"
              className="md:col-span-2 px-3 py-1.5 rounded text-xs font-mono outline-none"
              style={{
                backgroundColor: 'var(--cb-bg)',
                color: 'var(--cb-text)',
                border: '1px solid var(--cb-border)'
              }}
            />
            <input
              type="text"
              value={gitBranchInput}
              onChange={(e) => setGitBranchInput(e.target.value)}
              onBlur={() => void handleSaveGitConfig()}
              placeholder="Branch (main)"
              className="px-3 py-1.5 rounded text-xs font-mono outline-none"
              style={{
                backgroundColor: 'var(--cb-bg)',
                color: 'var(--cb-text)',
                border: '1px solid var(--cb-border)'
              }}
            />
          </div>

          <div className="flex items-center justify-between gap-2 flex-wrap">
            <label className="flex items-center gap-2 text-xs cursor-pointer select-none">
              <input
                type="checkbox"
                checked={settings.gitSync.autoSync}
                onChange={(e) =>
                  void onUpdateSettings({
                    gitSync: {
                      ...settings.gitSync,
                      repoUrl: gitRepoInput.trim(),
                      branch: gitBranchInput.trim() || 'main',
                      autoSync: e.target.checked
                    }
                  })
                }
              />
              <span style={{ color: 'var(--cb-text-muted)' }}>
                Auto-sync every {settings.gitSync.syncIntervalSeconds}s
              </span>
            </label>

            <button
              type="button"
              disabled={gitBusy || gitSyncStatus.state === 'syncing' || !gitRepoInput.trim()}
              onClick={() => void handleGitSyncNow()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium cb-transition cursor-pointer disabled:opacity-50"
              style={{
                backgroundColor: 'var(--cb-accent)',
                color: 'var(--cb-accent-text)'
              }}
            >
              <RefreshCw
                size={13}
                className={gitBusy || gitSyncStatus.state === 'syncing' ? 'animate-spin' : ''}
              />
              <span>{gitSyncStatus.state === 'syncing' ? 'Syncing...' : 'Sync Now'}</span>
            </button>
          </div>

          {(gitSyncStatus.lastSummary || gitSyncStatus.lastSyncedAt) && (
            <div className="text-[11px]" style={{ color: 'var(--cb-text-muted)' }}>
              {gitSyncStatus.lastSummary || 'Ready'}
              {gitSyncStatus.lastSyncedAt ? ` — ${formatTimestamp(gitSyncStatus.lastSyncedAt)}` : ''}
            </div>
          )}

          {gitSyncStatus.error && (
            <div
              className="p-2.5 rounded text-xs"
              style={{
                backgroundColor: 'var(--cb-surface-alt)',
                border: '1px solid var(--cb-border)',
                color: '#ef4444'
              }}
            >
              {gitSyncStatus.error}
            </div>
          )}
        </section>

        {/* Cloud Sync (Google Drive) */}
        <section
          className="p-4 rounded-lg space-y-3"
          style={{
            backgroundColor: 'var(--cb-surface)',
            border: '1px solid var(--cb-border)'
          }}
        >
          <div className="flex items-center justify-between gap-2">
            <div>
              <h2 className="text-xs font-semibold flex items-center gap-1.5">
                {syncStatus.connected ? <Cloud size={14} /> : <CloudOff size={14} />}
                <span>Cloud Sync (Google Drive)</span>
              </h2>
              <p className="text-xs mt-0.5" style={{ color: 'var(--cb-text-muted)' }}>
                Mirrors all projects, branches, backups, logs, rules, and system maps to /CrowBrain/
                in Google Drive while keeping local storage primary.
              </p>
            </div>
            {syncStatus.connected && (
              <span
                className="px-2 py-0.5 rounded text-[11px] font-medium shrink-0"
                style={{
                  backgroundColor: 'var(--cb-surface-alt)',
                  border: '1px solid var(--cb-border)',
                  color: 'var(--cb-text)'
                }}
              >
                {syncStatus.accountEmail || 'Connected'}
              </span>
            )}
          </div>

          {!syncStatus.connected ? (
            <div className="space-y-2.5">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                <input
                  type="text"
                  value={clientIdInput}
                  onChange={(e) => setClientIdInput(e.target.value)}
                  placeholder="Google OAuth Desktop Client ID"
                  className="px-3 py-1.5 rounded text-xs font-mono outline-none"
                  style={{
                    backgroundColor: 'var(--cb-bg)',
                    color: 'var(--cb-text)',
                    border: '1px solid var(--cb-border)'
                  }}
                />
                <input
                  type="password"
                  value={clientSecretInput}
                  onChange={(e) => setClientSecretInput(e.target.value)}
                  placeholder="Client Secret (if required by your OAuth client)"
                  className="px-3 py-1.5 rounded text-xs font-mono outline-none"
                  style={{
                    backgroundColor: 'var(--cb-bg)',
                    color: 'var(--cb-text)',
                    border: '1px solid var(--cb-border)'
                  }}
                />
              </div>
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <p className="text-[11px]" style={{ color: 'var(--cb-text-muted)' }}>
                  Uses Google Drive API v3 (scope: drive.file). Create a Desktop OAuth Client ID in
                  Google Cloud Console.
                </p>
                <button
                  type="button"
                  disabled={syncBusy || !clientIdInput.trim()}
                  onClick={() => void handleConnectGoogleDrive()}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium cb-transition cursor-pointer disabled:opacity-50"
                  style={{
                    backgroundColor: 'var(--cb-accent)',
                    color: 'var(--cb-accent-text)'
                  }}
                >
                  <Cloud size={13} />
                  <span>{syncBusy ? 'Connecting...' : 'Connect Google Drive'}</span>
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-2.5">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <label className="flex items-center gap-2 text-xs cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={settings.googleDrive.autoSync}
                    onChange={(e) =>
                      void onUpdateSettings({
                        googleDrive: {
                          ...settings.googleDrive,
                          autoSync: e.target.checked
                        }
                      })
                    }
                  />
                  <span style={{ color: 'var(--cb-text-muted)' }}>
                    Auto-sync every {settings.googleDrive.syncIntervalSeconds}s
                  </span>
                </label>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={syncBusy || syncStatus.state === 'syncing'}
                    onClick={() => void handleSyncNow()}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium cb-transition cursor-pointer disabled:opacity-50"
                    style={{
                      backgroundColor: 'var(--cb-accent)',
                      color: 'var(--cb-accent-text)'
                    }}
                  >
                    <RefreshCw
                      size={13}
                      className={syncBusy || syncStatus.state === 'syncing' ? 'animate-spin' : ''}
                    />
                    <span>{syncStatus.state === 'syncing' ? 'Syncing...' : 'Sync Now'}</span>
                  </button>

                  <button
                    type="button"
                    disabled={syncBusy}
                    onClick={() => void handleDisconnectGoogleDrive()}
                    className="px-3 py-1.5 rounded text-xs font-medium cb-transition cursor-pointer disabled:opacity-50"
                    style={{
                      backgroundColor: 'var(--cb-surface-alt)',
                      color: 'var(--cb-text)',
                      border: '1px solid var(--cb-border)'
                    }}
                  >
                    Disconnect
                  </button>
                </div>
              </div>

              {(syncStatus.lastSummary || syncStatus.lastSyncedAt) && (
                <div className="text-[11px]" style={{ color: 'var(--cb-text-muted)' }}>
                  {syncStatus.lastSummary ? `${syncStatus.lastSummary}` : 'Ready'}
                  {syncStatus.lastSyncedAt ? ` — ${formatTimestamp(syncStatus.lastSyncedAt)}` : ''}
                </div>
              )}
            </div>
          )}

          {syncStatus.error && (
            <div
              className="p-2.5 rounded text-xs"
              style={{
                backgroundColor: 'var(--cb-surface-alt)',
                border: '1px solid var(--cb-border)',
                color: '#ef4444'
              }}
            >
              {syncStatus.error}
            </div>
          )}
        </section>

        {/* Updates */}
        <section
          className="p-4 rounded-lg space-y-3"
          style={{
            backgroundColor: 'var(--cb-surface)',
            border: '1px solid var(--cb-border)'
          }}
        >
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-xs font-semibold">Updates</h2>
              <p className="text-xs mt-0.5" style={{ color: 'var(--cb-text-muted)' }}>
                Current version: <span className="font-mono">{appVersion || '0.1.0'}</span>
              </p>
            </div>

            <button
              type="button"
              disabled={checkingUpdates}
              onClick={() => void handleCheckUpdates()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium cb-transition cursor-pointer disabled:opacity-50"
              style={{
                backgroundColor: 'var(--cb-accent)',
                color: 'var(--cb-accent-text)'
              }}
            >
              <RefreshCw size={13} className={checkingUpdates ? 'animate-spin' : ''} />
              <span>{checkingUpdates ? 'Checking...' : 'Check for Updates'}</span>
            </button>
          </div>

          <label className="flex items-center gap-2 text-xs cursor-pointer select-none">
            <input
              type="checkbox"
              checked={settings.checkUpdatesOnStartup}
              onChange={(e) =>
                void onUpdateSettings({ checkUpdatesOnStartup: e.target.checked })
              }
            />
            <span style={{ color: 'var(--cb-text-muted)' }}>
              Check GitHub Releases automatically on startup
            </span>
          </label>

          {updateResult && (
            <div
              className="p-3 rounded text-xs space-y-2 cb-view-enter"
              style={{
                backgroundColor: 'var(--cb-surface-alt)',
                border: '1px solid var(--cb-border)'
              }}
            >
              {updateResult.error ? (
                <div style={{ color: '#ef4444' }}>{updateResult.error}</div>
              ) : updateResult.hasUpdate ? (
                <>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5 font-medium">
                      <Download size={13} style={{ color: 'var(--cb-accent)' }} />
                      <span>
                        Update available: v{updateResult.latestVersion} (current v
                        {updateResult.currentVersion})
                      </span>
                    </div>
                    {updateResult.releaseUrl && (
                      <a
                        href={updateResult.releaseUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 font-medium"
                        style={{ color: 'var(--cb-accent)' }}
                      >
                        <span>Open Release</span>
                        <ExternalLink size={12} />
                      </a>
                    )}
                  </div>
                  {updateResult.releaseNotes && (
                    <pre
                      className="p-2 rounded text-[11px] font-mono whitespace-pre-wrap max-h-40 overflow-y-auto"
                      style={{
                        backgroundColor: 'var(--cb-bg)',
                        border: '1px solid var(--cb-border)'
                      }}
                    >
                      {updateResult.releaseNotes}
                    </pre>
                  )}
                </>
              ) : (
                <div style={{ color: 'var(--cb-text-muted)' }}>
                  You are running the latest version (v{updateResult.currentVersion}).
                </div>
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

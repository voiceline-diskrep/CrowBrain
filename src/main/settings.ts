import fs from 'fs'
import os from 'os'
import path from 'path'
import { app } from 'electron'
import type {
  AppSettings,
  CustomThemeTokens,
  GitSyncConfig,
  GoogleDriveConfig
} from '@shared/types'

const DEFAULT_GOOGLE_DRIVE: GoogleDriveConfig = {
  clientId: '',
  clientSecret: '',
  autoSync: true,
  syncIntervalSeconds: 60
}

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

function resolveDefaultVaultPath(): string {
  try {
    if (app && typeof app.getPath === 'function') {
      return path.join(app.getPath('documents'), 'CrowBrainVault')
    }
  } catch {
    // Fallback when running outside Electron main process (e.g., unit tests).
  }
  return path.join(os.homedir(), 'Documents', 'CrowBrainVault')
}

export class SettingsManager {
  private readonly settingsFile: string
  private readonly defaults: AppSettings
  private settings: AppSettings

  constructor(userDataPath: string, defaultVaultPath?: string) {
    this.settingsFile = path.join(userDataPath, 'settings.json')
    const initialVault = defaultVaultPath ?? resolveDefaultVaultPath()
    const defaultSyncRoot = path.join(path.dirname(initialVault), 'CrowBrainProjects')
    const defaultGitSync: GitSyncConfig = {
      repoUrl: '',
      branch: 'main',
      syncRootPath: defaultSyncRoot,
      autoSync: false,
      syncIntervalSeconds: 60
    }
    this.defaults = {
      vaultPath: initialVault,
      projects: [
        {
          id: 'default',
          name: 'Default',
          vaultPath: initialVault,
          createdAt: Date.now()
        }
      ],
      activeProjectId: 'default',
      theme: 'dark',
      customTheme: { ...DEFAULT_CUSTOM_THEME },
      animationSpeed: 'normal',
      mcpPort: 3345,
      checkUpdatesOnStartup: true,
      googleDrive: { ...DEFAULT_GOOGLE_DRIVE },
      gitSync: defaultGitSync
    }
    this.settings = this.load()
  }

  getSettings(): AppSettings {
    return {
      ...this.settings,
      projects: this.settings.projects.map((p) => ({ ...p })),
      customTheme: { ...this.settings.customTheme },
      googleDrive: { ...this.settings.googleDrive },
      gitSync: { ...this.settings.gitSync }
    }
  }

  updateSettings(partial: Partial<AppSettings>): AppSettings {
    const next: AppSettings = {
      ...this.settings,
      ...partial,
      projects: partial.projects
        ? partial.projects.map((p) => ({ ...p }))
        : this.settings.projects.map((p) => ({ ...p })),
      customTheme: {
        ...this.settings.customTheme,
        ...(partial.customTheme ?? {})
      },
      googleDrive: {
        ...this.settings.googleDrive,
        ...(partial.googleDrive ?? {})
      },
      gitSync: {
        ...this.settings.gitSync,
        ...(partial.gitSync ?? {})
      }
    }
    this.settings = next
    this.persist()
    return this.getSettings()
  }

  private load(): AppSettings {
    try {
      if (fs.existsSync(this.settingsFile)) {
        const raw = fs.readFileSync(this.settingsFile, 'utf-8')
        const parsed = JSON.parse(raw) as Partial<AppSettings>
        const vaultPath = parsed.vaultPath || this.defaults.vaultPath
        const projects =
          Array.isArray(parsed.projects) && parsed.projects.length > 0
            ? parsed.projects
            : [
                {
                  id: 'default',
                  name: path.basename(vaultPath) || 'Default',
                  vaultPath,
                  createdAt: Date.now()
                }
              ]
        const activeProjectId =
          parsed.activeProjectId && projects.some((p) => p.id === parsed.activeProjectId)
            ? parsed.activeProjectId
            : projects[0].id
        return {
          ...this.defaults,
          ...parsed,
          vaultPath,
          projects,
          activeProjectId,
          customTheme: {
            ...this.defaults.customTheme,
            ...(parsed.customTheme ?? {})
          },
          googleDrive: {
            ...DEFAULT_GOOGLE_DRIVE,
            ...(parsed.googleDrive ?? {})
          },
          gitSync: {
            ...this.defaults.gitSync,
            ...(parsed.gitSync ?? {})
          }
        }
      }
    } catch {
      // Fall back to defaults if settings.json is unreadable or corrupt.
    }
    return {
      ...this.defaults,
      projects: this.defaults.projects.map((p) => ({ ...p })),
      customTheme: { ...this.defaults.customTheme },
      googleDrive: { ...DEFAULT_GOOGLE_DRIVE },
      gitSync: { ...this.defaults.gitSync }
    }
  }

  private persist(): void {
    const dir = path.dirname(this.settingsFile)
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(this.settingsFile, JSON.stringify(this.settings, null, 2), 'utf-8')
  }
}

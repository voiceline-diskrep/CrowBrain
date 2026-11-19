import fs from 'fs'
import os from 'os'
import path from 'path'
import { app, safeStorage } from 'electron'
import type {
  AppSettings,
  CustomThemeTokens,
  GitSyncConfig,
  GoogleDriveConfig,
  ProjectEntry
} from '@shared/types'

const SECRET_PREFIX = 'enc:'

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

function makeSlug(name: string, fallbackId: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug || fallbackId
}

function normalizeProject(p: ProjectEntry): ProjectEntry {
  return {
    ...p,
    slug: p.slug?.trim() || makeSlug(p.name, p.id),
    updatedAt: p.updatedAt ?? p.createdAt
  }
}

function encryptSecret(value?: string): string | undefined {
  if (!value) return value
  if (value.startsWith(SECRET_PREFIX)) return value
  try {
    if (safeStorage && typeof safeStorage.isEncryptionAvailable === 'function' && safeStorage.isEncryptionAvailable()) {
      return `${SECRET_PREFIX}${safeStorage.encryptString(value).toString('base64')}`
    }
  } catch {
    // Fallback when running outside Electron (e.g. unit tests)
  }
  return value
}

function decryptSecret(value?: string): string | undefined {
  if (!value) return value
  if (!value.startsWith(SECRET_PREFIX)) return value
  try {
    if (safeStorage && typeof safeStorage.isEncryptionAvailable === 'function' && safeStorage.isEncryptionAvailable()) {
      const buf = Buffer.from(value.slice(SECRET_PREFIX.length), 'base64')
      return safeStorage.decryptString(buf)
    }
  } catch {
    return ''
  }
  return ''
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
    const now = Date.now()
    this.defaults = {
      vaultPath: initialVault,
      projects: [
        {
          id: 'default',
          name: 'Default',
          slug: 'default',
          vaultPath: initialVault,
          createdAt: now,
          updatedAt: now
        }
      ],
      deletedProjectIds: [],
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
      deletedProjectIds: [...(this.settings.deletedProjectIds ?? [])],
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
        ? partial.projects.map((p) => normalizeProject({ ...p }))
        : this.settings.projects.map((p) => ({ ...p })),
      deletedProjectIds: partial.deletedProjectIds
        ? Array.from(new Set(partial.deletedProjectIds))
        : [...(this.settings.deletedProjectIds ?? [])],
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
        const rawProjects =
          Array.isArray(parsed.projects) && parsed.projects.length > 0
            ? parsed.projects
            : [
                {
                  id: 'default',
                  name: path.basename(vaultPath) || 'Default',
                  slug: 'default',
                  vaultPath,
                  createdAt: Date.now()
                }
              ]
        const projects = rawProjects.map((p) => normalizeProject(p))
        const activeProjectId =
          parsed.activeProjectId && projects.some((p) => p.id === parsed.activeProjectId)
            ? parsed.activeProjectId
            : projects[0].id
        const gd = {
          ...DEFAULT_GOOGLE_DRIVE,
          ...(parsed.googleDrive ?? {})
        }
        gd.clientSecret = decryptSecret(gd.clientSecret)
        gd.refreshToken = decryptSecret(gd.refreshToken)
        gd.accessToken = decryptSecret(gd.accessToken)

        return {
          ...this.defaults,
          ...parsed,
          vaultPath,
          projects,
          deletedProjectIds: Array.isArray(parsed.deletedProjectIds)
            ? Array.from(new Set(parsed.deletedProjectIds))
            : [],
          activeProjectId,
          customTheme: {
            ...this.defaults.customTheme,
            ...(parsed.customTheme ?? {})
          },
          googleDrive: gd,
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
      deletedProjectIds: [],
      customTheme: { ...this.defaults.customTheme },
      googleDrive: { ...DEFAULT_GOOGLE_DRIVE },
      gitSync: { ...this.defaults.gitSync }
    }
  }

  private persist(): void {
    const dir = path.dirname(this.settingsFile)
    fs.mkdirSync(dir, { recursive: true })
    const toWrite: AppSettings = {
      ...this.settings,
      googleDrive: {
        ...this.settings.googleDrive,
        clientSecret: encryptSecret(this.settings.googleDrive.clientSecret),
        refreshToken: encryptSecret(this.settings.googleDrive.refreshToken),
        accessToken: encryptSecret(this.settings.googleDrive.accessToken)
      }
    }
    fs.writeFileSync(this.settingsFile, JSON.stringify(toWrite, null, 2), 'utf-8')
  }
}

import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { ProjectEntry, SyncStatus } from '@shared/types'
import type { SettingsManager } from '../settings'
import {
  authenticateWithGoogle,
  GoogleDriveClient,
  refreshGoogleToken,
  type DriveFileItem
} from './GoogleDriveClient'

const FOLDER_MIME = 'application/vnd.google-apps.folder'

export interface PortableProjectManifestItem {
  id: string
  name: string
  slug: string
  createdAt: number
  updatedAt?: number
  pinned?: boolean
  deleted?: boolean
}

export interface PortableManifest {
  version: number
  updatedAt: number
  projects: PortableProjectManifestItem[]
}

export interface JsonlMergeResult {
  mergedText: string
  changedLocal: boolean
  changedRemote: boolean
}

export function sha256(text: string): string {
  return crypto.createHash('sha256').update(text, 'utf-8').digest('hex')
}

export function slugifyProjectName(name: string, fallbackId: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug || fallbackId
}

export function mergeJsonlContent(localText: string, remoteText: string): JsonlMergeResult {
  const byId = new Map<string, Record<string, unknown>>()
  const orderlessFallback: string[] = []

  const ingest = (raw: string): void => {
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim()
      if (!trimmed) continue
      try {
        const parsed = JSON.parse(trimmed) as Record<string, unknown>
        const id = typeof parsed.id === 'string' && parsed.id ? parsed.id : undefined
        if (id) {
          if (!byId.has(id)) {
            byId.set(id, parsed)
          }
        } else {
          if (!orderlessFallback.includes(trimmed)) {
            orderlessFallback.push(trimmed)
          }
        }
      } catch {
        // Ignore malformed lines
      }
    }
  }

  ingest(localText)
  ingest(remoteText)

  const items = Array.from(byId.values()).sort((a, b) => {
    const tsA = typeof a.timestamp === 'number' ? a.timestamp : 0
    const tsB = typeof b.timestamp === 'number' ? b.timestamp : 0
    return tsA - tsB
  })

  const lines = items.map((item) => JSON.stringify(item)).concat(orderlessFallback)
  const mergedText = lines.length > 0 ? `${lines.join('\n')}\n` : ''

  return {
    mergedText,
    changedLocal: sha256(localText) !== sha256(mergedText),
    changedRemote: sha256(remoteText) !== sha256(mergedText)
  }
}

export function mergeManifestProjects(
  localProjects: ProjectEntry[],
  remoteManifest: PortableManifest | null,
  deletedProjectIds: string[] = []
): PortableProjectManifestItem[] {
  const deletedSet = new Set(deletedProjectIds)
  const merged = new Map<string, PortableProjectManifestItem>()

  for (const remote of remoteManifest?.projects ?? []) {
    merged.set(remote.id, { ...remote })
  }

  for (const local of localProjects) {
    if (deletedSet.has(local.id)) continue
    const localSlug = local.slug?.trim() || slugifyProjectName(local.name, local.id)
    const localUpdatedAt = local.updatedAt ?? local.createdAt
    const existing = merged.get(local.id)

    if (!existing) {
      merged.set(local.id, {
        id: local.id,
        name: local.name,
        slug: localSlug,
        createdAt: local.createdAt,
        updatedAt: localUpdatedAt,
        pinned: Boolean(local.pinned),
        deleted: false
      })
    } else if (!existing.deleted) {
      const remoteUpdatedAt = existing.updatedAt ?? existing.createdAt
      if (localUpdatedAt >= remoteUpdatedAt) {
        merged.set(local.id, {
          ...existing,
          name: local.name,
          slug: existing.slug || localSlug,
          updatedAt: localUpdatedAt,
          pinned: Boolean(local.pinned)
        })
      }
    }
  }

  for (const delId of deletedSet) {
    const existing = merged.get(delId)
    if (existing) {
      merged.set(delId, { ...existing, deleted: true, updatedAt: Date.now() })
    } else {
      merged.set(delId, {
        id: delId,
        name: delId,
        slug: delId,
        createdAt: 0,
        updatedAt: Date.now(),
        deleted: true
      })
    }
  }

  return Array.from(merged.values()).sort((a, b) => a.createdAt - b.createdAt)
}

interface SyncStateMap {
  [relKey: string]: string
}

export class SyncManager {
  private status: SyncStatus = {
    connected: false,
    state: 'idle'
  }
  private timer: NodeJS.Timeout | null = null
  private syncing = false

  constructor(
    private readonly settingsManager: SettingsManager,
    private readonly onProjectsUpdated: () => Promise<void>,
    private readonly onStatusChange?: (status: SyncStatus) => void
  ) {
    const settings = this.settingsManager.getSettings()
    this.status = {
      connected: Boolean(settings.googleDrive.refreshToken),
      accountEmail: settings.googleDrive.accountEmail,
      state: 'idle'
    }
  }

  getStatus(): SyncStatus {
    return { ...this.status }
  }

  private updateStatus(next: Partial<SyncStatus>): void {
    this.status = { ...this.status, ...next }
    this.onStatusChange?.(this.getStatus())
  }

  startAutoSync(): void {
    this.stopAutoSync()
    const settings = this.settingsManager.getSettings()
    if (!settings.googleDrive.refreshToken || !settings.googleDrive.autoSync) {
      return
    }
    const intervalMs = Math.max(15, settings.googleDrive.syncIntervalSeconds || 60) * 1000
    this.timer = setInterval(() => {
      void this.syncNow()
    }, intervalMs)
  }

  stopAutoSync(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  async connectGoogleDrive(clientId: string, clientSecret?: string): Promise<SyncStatus> {
    this.updateStatus({ state: 'syncing', error: undefined })
    try {
      const tokens = await authenticateWithGoogle(clientId, clientSecret)
      const current = this.settingsManager.getSettings()
      this.settingsManager.updateSettings({
        googleDrive: {
          ...current.googleDrive,
          clientId: clientId.trim(),
          clientSecret: clientSecret?.trim() || '',
          refreshToken: tokens.refreshToken ?? current.googleDrive.refreshToken,
          accessToken: tokens.accessToken,
          tokenExpiresAt: tokens.tokenExpiresAt,
          accountEmail: tokens.accountEmail ?? current.googleDrive.accountEmail
        }
      })
      this.updateStatus({
        connected: true,
        accountEmail: tokens.accountEmail,
        state: 'idle',
        error: undefined
      })
      this.startAutoSync()
      return await this.syncNow()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Google Drive sign-in failed'
      this.updateStatus({ state: 'error', error: message })
      return this.getStatus()
    }
  }

  disconnectGoogleDrive(): SyncStatus {
    this.stopAutoSync()
    const current = this.settingsManager.getSettings()
    this.settingsManager.updateSettings({
      googleDrive: {
        ...current.googleDrive,
        refreshToken: undefined,
        accessToken: undefined,
        tokenExpiresAt: undefined,
        accountEmail: undefined
      }
    })
    this.updateStatus({
      connected: false,
      accountEmail: undefined,
      state: 'idle',
      lastSummary: undefined,
      error: undefined
    })
    return this.getStatus()
  }

  private async getValidAccessToken(): Promise<string> {
    const current = this.settingsManager.getSettings()
    const gd = current.googleDrive
    if (!gd.clientId || !gd.refreshToken) {
      throw new Error('Google Drive is not connected.')
    }
    if (gd.accessToken && gd.tokenExpiresAt && Date.now() < gd.tokenExpiresAt) {
      return gd.accessToken
    }
    const refreshed = await refreshGoogleToken(gd.clientId, gd.refreshToken, gd.clientSecret)
    this.settingsManager.updateSettings({
      googleDrive: {
        ...gd,
        accessToken: refreshed.accessToken,
        tokenExpiresAt: refreshed.tokenExpiresAt
      }
    })
    return refreshed.accessToken
  }

  async syncNow(): Promise<SyncStatus> {
    if (this.syncing) {
      return this.getStatus()
    }

    const initialSettings = this.settingsManager.getSettings()
    if (!initialSettings.googleDrive.refreshToken) {
      this.updateStatus({ connected: false, state: 'idle' })
      return this.getStatus()
    }

    this.syncing = true
    this.updateStatus({ state: 'syncing', error: undefined })

    try {
      const client = new GoogleDriveClient(() => this.getValidAccessToken())
      const rootFolderId = await client.ensureFolder('CrowBrain')
      const projectsFolderId = await client.ensureFolder('projects', rootFolderId)
      const rootFiles = await client.listFiles(rootFolderId)

      const manifestFile = rootFiles.find((f) => f.name === 'manifest.json')
      let remoteManifest: PortableManifest | null = null
      if (manifestFile) {
        const raw = await client.downloadText(manifestFile.id)
        try {
          remoteManifest = JSON.parse(raw) as PortableManifest
        } catch {
          remoteManifest = null
        }
      }

      const mergedItems = mergeManifestProjects(
        initialSettings.projects,
        remoteManifest,
        initialSettings.deletedProjectIds ?? []
      )
      const projectsBaseDir =
        initialSettings.gitSync.syncRootPath ||
        path.join(os.homedir(), 'Documents', 'CrowBrainProjects')

      const activeItems = mergedItems.filter((item) => !item.deleted)
      const deletedIds = new Set(
        mergedItems.filter((item) => item.deleted).map((item) => item.id)
      )

      const updatedLocalProjects: ProjectEntry[] = []
      let projectsChanged = false

      for (const local of initialSettings.projects) {
        if (deletedIds.has(local.id)) {
          projectsChanged = true
          continue
        }
        const match = activeItems.find((m) => m.id === local.id)
        if (match) {
          if (match.name !== local.name || Boolean(match.pinned) !== Boolean(local.pinned)) {
            projectsChanged = true
          }
          updatedLocalProjects.push({
            ...local,
            name: match.name,
            slug: match.slug,
            pinned: Boolean(match.pinned),
            updatedAt: match.updatedAt ?? local.updatedAt
          })
        } else {
          updatedLocalProjects.push(local)
        }
      }

      for (const item of activeItems) {
        if (!updatedLocalProjects.some((p) => p.id === item.id)) {
          const localPath = path.join(projectsBaseDir, item.slug)
          fs.mkdirSync(localPath, { recursive: true })
          updatedLocalProjects.push({
            id: item.id,
            name: item.name,
            slug: item.slug,
            vaultPath: localPath,
            createdAt: item.createdAt,
            updatedAt: item.updatedAt ?? item.createdAt,
            pinned: Boolean(item.pinned)
          })
          projectsChanged = true
        }
      }

      if (projectsChanged && updatedLocalProjects.length > 0) {
        const nextActive =
          updatedLocalProjects.find((p) => p.id === initialSettings.activeProjectId) ??
          updatedLocalProjects[0]
        this.settingsManager.updateSettings({
          projects: updatedLocalProjects,
          activeProjectId: nextActive.id,
          vaultPath: nextActive.vaultPath,
          deletedProjectIds: Array.from(deletedIds)
        })
        await this.onProjectsUpdated()
      }

      const nextManifest: PortableManifest = {
        version: 1,
        updatedAt: Date.now(),
        projects: mergedItems
      }
      await client.uploadText(
        'manifest.json',
        rootFolderId,
        JSON.stringify(nextManifest, null, 2),
        manifestFile?.id,
        'application/json'
      )

      let uploadedCount = 0
      let downloadedCount = 0

      for (const item of activeItems) {
        const localProj = updatedLocalProjects.find((p) => p.id === item.id)
        if (!localProj) continue

        const remoteProjFolderId = await client.ensureFolder(item.slug, projectsFolderId)
        const counts = await this.syncProjectDirectory(
          client,
          localProj.vaultPath,
          remoteProjFolderId
        )
        uploadedCount += counts.uploaded
        downloadedCount += counts.downloaded
      }

      await this.onProjectsUpdated()

      this.updateStatus({
        connected: true,
        state: 'idle',
        lastSyncedAt: Date.now(),
        lastSummary: `${activeItems.length} projects synced (${uploadedCount} uploaded, ${downloadedCount} downloaded)`,
        error: undefined
      })
      return this.getStatus()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Google Drive sync failed'
      this.updateStatus({ state: 'error', error: message })
      return this.getStatus()
    } finally {
      this.syncing = false
    }
  }

  private async syncProjectDirectory(
    client: GoogleDriveClient,
    localRoot: string,
    remoteRootId: string
  ): Promise<{ uploaded: number; downloaded: number }> {
    let uploaded = 0
    let downloaded = 0

    const stateFile = path.join(localRoot, '.crowbrain', 'sync-state.json')
    const syncState = this.loadSyncState(stateFile)

    const localFiles = this.collectLocalFiles(localRoot)
    const remoteFiles = await this.collectRemoteFiles(client, remoteRootId)
    const allKeys = new Set<string>([...localFiles.keys(), ...remoteFiles.keys()])

    for (const relKey of allKeys) {
      const localAbs = localFiles.get(relKey)
      const remoteEntry = remoteFiles.get(relKey)

      if (relKey.endsWith('.jsonl')) {
        const localText = localAbs ? fs.readFileSync(localAbs, 'utf-8') : ''
        const remoteText = remoteEntry ? await client.downloadText(remoteEntry.file.id) : ''
        const merged = mergeJsonlContent(localText, remoteText)

        if (merged.changedLocal) {
          const targetAbs = path.join(localRoot, ...relKey.split('/'))
          fs.mkdirSync(path.dirname(targetAbs), { recursive: true })
          fs.writeFileSync(targetAbs, merged.mergedText, 'utf-8')
          downloaded++
        }
        if (merged.changedRemote) {
          const parentId = await this.ensureRemoteParentFolder(client, remoteRootId, relKey)
          const fileName = path.posix.basename(relKey)
          await client.uploadText(
            fileName,
            parentId,
            merged.mergedText,
            remoteEntry?.file.id,
            'application/x-ndjson'
          )
          uploaded++
        }
        syncState[relKey] = sha256(merged.mergedText)
        continue
      }

      const localText = localAbs ? fs.readFileSync(localAbs, 'utf-8') : null
      const remoteText = remoteEntry ? await client.downloadText(remoteEntry.file.id) : null
      const baseHash = syncState[relKey]

      if (localText !== null && remoteText === null) {
        const parentId = await this.ensureRemoteParentFolder(client, remoteRootId, relKey)
        await client.uploadText(path.posix.basename(relKey), parentId, localText, undefined, 'text/markdown')
        syncState[relKey] = sha256(localText)
        uploaded++
      } else if (localText === null && remoteText !== null) {
        const targetAbs = path.join(localRoot, ...relKey.split('/'))
        fs.mkdirSync(path.dirname(targetAbs), { recursive: true })
        fs.writeFileSync(targetAbs, remoteText, 'utf-8')
        syncState[relKey] = sha256(remoteText)
        downloaded++
      } else if (localText !== null && remoteText !== null) {
        const localHash = sha256(localText)
        const remoteHash = sha256(remoteText)
        if (localHash === remoteHash) {
          syncState[relKey] = localHash
          continue
        }
        if (!baseHash || baseHash === localHash) {
          const targetAbs = path.join(localRoot, ...relKey.split('/'))
          fs.writeFileSync(targetAbs, remoteText, 'utf-8')
          syncState[relKey] = remoteHash
          downloaded++
        } else if (baseHash === remoteHash) {
          const parentId = await this.ensureRemoteParentFolder(client, remoteRootId, relKey)
          await client.uploadText(
            path.posix.basename(relKey),
            parentId,
            localText,
            remoteEntry?.file.id,
            'text/markdown'
          )
          syncState[relKey] = localHash
          uploaded++
        } else {
          // Both changed since last sync: preserve remote in a conflict file and push local
          const ext = path.extname(relKey)
          const stem = relKey.slice(0, relKey.length - ext.length)
          const conflictRel = `${stem}.conflict-${Date.now()}${ext}`
          const conflictAbs = path.join(localRoot, ...conflictRel.split('/'))
          fs.mkdirSync(path.dirname(conflictAbs), { recursive: true })
          fs.writeFileSync(conflictAbs, remoteText, 'utf-8')
          downloaded++

          const parentId = await this.ensureRemoteParentFolder(client, remoteRootId, relKey)
          await client.uploadText(
            path.posix.basename(relKey),
            parentId,
            localText,
            remoteEntry?.file.id,
            'text/markdown'
          )
          syncState[relKey] = localHash
          uploaded++
        }
      }
    }

    this.saveSyncState(stateFile, syncState)
    return { uploaded, downloaded }
  }

  private collectLocalFiles(localRoot: string): Map<string, string> {
    const map = new Map<string, string>()
    if (!fs.existsSync(localRoot)) return map

    const walk = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name.startsWith('.')) continue
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) {
          walk(full)
        } else if (entry.isFile() && (entry.name.endsWith('.md') || entry.name.endsWith('.jsonl'))) {
          const rel = path.relative(localRoot, full).split(path.sep).join('/')
          map.set(rel, full)
        }
      }
    }

    walk(localRoot)
    return map
  }

  private async collectRemoteFiles(
    client: GoogleDriveClient,
    remoteRootId: string
  ): Promise<Map<string, { file: DriveFileItem; parentId: string }>> {
    const map = new Map<string, { file: DriveFileItem; parentId: string }>()

    const walk = async (folderId: string, prefix: string): Promise<void> => {
      const items = await client.listFiles(folderId)
      for (const item of items) {
        const rel = prefix ? `${prefix}/${item.name}` : item.name
        if (item.mimeType === FOLDER_MIME) {
          await walk(item.id, rel)
        } else {
          map.set(rel, { file: item, parentId: folderId })
        }
      }
    }

    await walk(remoteRootId, '')
    return map
  }

  private async ensureRemoteParentFolder(
    client: GoogleDriveClient,
    remoteRootId: string,
    relKey: string
  ): Promise<string> {
    const segments = relKey.split('/')
    segments.pop()
    let currentId = remoteRootId
    for (const seg of segments) {
      currentId = await client.ensureFolder(seg, currentId)
    }
    return currentId
  }

  private loadSyncState(stateFile: string): SyncStateMap {
    try {
      if (fs.existsSync(stateFile)) {
        return JSON.parse(fs.readFileSync(stateFile, 'utf-8')) as SyncStateMap
      }
    } catch {
      // Ignore corrupt sync state
    }
    return {}
  }

  private saveSyncState(stateFile: string, state: SyncStateMap): void {
    fs.mkdirSync(path.dirname(stateFile), { recursive: true })
    fs.writeFileSync(stateFile, JSON.stringify(state, null, 2), 'utf-8')
  }
}

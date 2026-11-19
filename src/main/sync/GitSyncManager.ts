import { execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'
import type { GitSyncStatus, ProjectEntry } from '@shared/types'
import type { SettingsManager } from '../settings'
import {
  mergeJsonlContent,
  mergeManifestProjects,
  slugifyProjectName,
  type PortableManifest
} from './SyncManager'

const execFileAsync = promisify(execFile)

export function normalizeGitRepoUrl(input: string): string {
  const trimmed = input.trim()
  if (!trimmed) return ''
  if (!trimmed.includes('://') && !trimmed.startsWith('git@') && /^[\w.-]+\/[\w.-]+$/.test(trimmed)) {
    return `https://github.com/${trimmed}.git`
  }
  return trimmed
}

export class GitSyncManager {
  private status: GitSyncStatus = {
    configured: false,
    state: 'idle'
  }
  private timer: NodeJS.Timeout | null = null
  private syncing = false

  constructor(
    private readonly settingsManager: SettingsManager,
    private readonly onProjectsUpdated: () => Promise<void>,
    private readonly onStatusChange?: (status: GitSyncStatus) => void
  ) {
    const settings = this.settingsManager.getSettings()
    this.status = {
      configured: Boolean(settings.gitSync.repoUrl.trim()),
      state: 'idle'
    }
  }

  getStatus(): GitSyncStatus {
    return { ...this.status }
  }

  refreshConfigured(): void {
    const settings = this.settingsManager.getSettings()
    this.updateStatus({
      configured: Boolean(settings.gitSync.repoUrl.trim())
    })
  }

  private updateStatus(next: Partial<GitSyncStatus>): void {
    this.status = { ...this.status, ...next }
    this.onStatusChange?.(this.getStatus())
  }

  startAutoSync(): void {
    this.stopAutoSync()
    const settings = this.settingsManager.getSettings()
    if (!settings.gitSync.repoUrl.trim() || !settings.gitSync.autoSync) {
      return
    }
    const intervalMs = Math.max(15, settings.gitSync.syncIntervalSeconds || 60) * 1000
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

  private async git(cwd: string, args: string[]): Promise<string> {
    const { stdout } = await execFileAsync('git', args, {
      cwd,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }
    })
    return stdout.trim()
  }

  private async ensureGitRepo(syncRoot: string, repoUrl: string, branch: string): Promise<void> {
    fs.mkdirSync(syncRoot, { recursive: true })

    if (!fs.existsSync(path.join(syncRoot, '.git'))) {
      await this.git(syncRoot, ['init', '-b', branch])
    }

    const gitignorePath = path.join(syncRoot, '.gitignore')
    if (!fs.existsSync(gitignorePath)) {
      fs.writeFileSync(gitignorePath, '.crowbrain/\n**/.crowbrain/\n.DS_Store\nThumbs.db\n', 'utf-8')
    }

    let hasOrigin = false
    try {
      const currentRemote = await this.git(syncRoot, ['remote', 'get-url', 'origin'])
      hasOrigin = true
      if (currentRemote !== repoUrl) {
        await this.git(syncRoot, ['remote', 'set-url', 'origin', repoUrl])
      }
    } catch {
      hasOrigin = false
    }

    if (!hasOrigin) {
      await this.git(syncRoot, ['remote', 'add', 'origin', repoUrl])
    }
  }

  private async hasGitIdentity(cwd: string): Promise<boolean> {
    try {
      const name = await this.git(cwd, ['config', '--get', 'user.name'])
      const email = await this.git(cwd, ['config', '--get', 'user.email'])
      return Boolean(name && email)
    } catch {
      return false
    }
  }

  private getProjectSlug(project: ProjectEntry): string {
    return project.slug?.trim() || slugifyProjectName(project.name, project.id)
  }

  private isExternalProject(project: ProjectEntry, syncRoot: string): boolean {
    const resolvedSrc = path.resolve(project.vaultPath)
    const resolvedRoot = path.resolve(syncRoot)
    return (
      resolvedSrc !== resolvedRoot &&
      !resolvedSrc.startsWith(resolvedRoot + path.sep) &&
      resolvedSrc.toLowerCase() !== resolvedRoot.toLowerCase() &&
      !resolvedSrc.toLowerCase().startsWith((resolvedRoot + path.sep).toLowerCase())
    )
  }

  private mirrorExternalProjectToRoot(project: ProjectEntry, syncRoot: string): void {
    if (!this.isExternalProject(project, syncRoot)) {
      return
    }
    const slug = this.getProjectSlug(project)
    const destRoot = path.join(syncRoot, slug)
    const resolvedSrc = path.resolve(project.vaultPath)
    const resolvedDest = path.resolve(destRoot)

    if (!fs.existsSync(resolvedSrc)) {
      return
    }

    const copyDir = (srcDir: string, targetDir: string): void => {
      fs.mkdirSync(targetDir, { recursive: true })
      for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
        if (entry.name.startsWith('.')) continue
        const srcPath = path.join(srcDir, entry.name)
        const targetPath = path.join(targetDir, entry.name)
        if (entry.isDirectory()) {
          copyDir(srcPath, targetPath)
        } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
          const localText = fs.readFileSync(srcPath, 'utf-8')
          const existingText = fs.existsSync(targetPath) ? fs.readFileSync(targetPath, 'utf-8') : ''
          const merged = mergeJsonlContent(localText, existingText)
          fs.writeFileSync(targetPath, merged.mergedText, 'utf-8')
        } else if (entry.isFile() && entry.name.endsWith('.md')) {
          fs.copyFileSync(srcPath, targetPath)
        }
      }
    }

    copyDir(resolvedSrc, resolvedDest)
  }

  private mirrorRootBackToExternalProject(project: ProjectEntry, syncRoot: string): void {
    if (!this.isExternalProject(project, syncRoot)) {
      return
    }
    const slug = this.getProjectSlug(project)
    const srcRoot = path.join(syncRoot, slug)
    const destRoot = path.resolve(project.vaultPath)
    if (!fs.existsSync(srcRoot)) {
      return
    }

    const copyBack = (srcDir: string, targetDir: string): void => {
      fs.mkdirSync(targetDir, { recursive: true })
      for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
        if (entry.name.startsWith('.')) continue
        const srcPath = path.join(srcDir, entry.name)
        const targetPath = path.join(targetDir, entry.name)
        if (entry.isDirectory()) {
          copyBack(srcPath, targetPath)
        } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
          const pulledText = fs.readFileSync(srcPath, 'utf-8')
          const localText = fs.existsSync(targetPath) ? fs.readFileSync(targetPath, 'utf-8') : ''
          const merged = mergeJsonlContent(localText, pulledText)
          if (merged.changedLocal) {
            fs.writeFileSync(targetPath, merged.mergedText, 'utf-8')
          }
        } else if (entry.isFile() && entry.name.endsWith('.md')) {
          const pulledText = fs.readFileSync(srcPath, 'utf-8')
          const localText = fs.existsSync(targetPath) ? fs.readFileSync(targetPath, 'utf-8') : null
          if (localText !== pulledText) {
            fs.writeFileSync(targetPath, pulledText, 'utf-8')
          }
        }
      }
    }

    copyBack(srcRoot, destRoot)
  }

  async syncNow(): Promise<GitSyncStatus> {
    if (this.syncing) {
      return this.getStatus()
    }

    const settings = this.settingsManager.getSettings()
    const repoUrl = normalizeGitRepoUrl(settings.gitSync.repoUrl)
    const branch = settings.gitSync.branch.trim() || 'main'
    const syncRoot = settings.gitSync.syncRootPath

    if (!repoUrl) {
      this.updateStatus({
        configured: false,
        state: 'error',
        error: 'Set a private GitHub repository URL first.'
      })
      return this.getStatus()
    }

    this.syncing = true
    this.updateStatus({ configured: true, state: 'syncing', error: undefined })

    try {
      await this.ensureGitRepo(syncRoot, repoUrl, branch)

      for (const proj of settings.projects) {
        this.mirrorExternalProjectToRoot(proj, syncRoot)
      }

      const manifestPath = path.join(syncRoot, 'manifest.json')
      let existingManifest: PortableManifest | null = null
      if (fs.existsSync(manifestPath)) {
        try {
          existingManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as PortableManifest
        } catch {
          existingManifest = null
        }
      }

      const mergedBeforePull = mergeManifestProjects(
        settings.projects,
        existingManifest,
        settings.deletedProjectIds ?? []
      )
      fs.writeFileSync(
        manifestPath,
        JSON.stringify(
          { version: 1, updatedAt: Date.now(), projects: mergedBeforePull } satisfies PortableManifest,
          null,
          2
        ),
        'utf-8'
      )

      await this.git(syncRoot, ['add', '-A'])
      const statusOut = await this.git(syncRoot, ['status', '--porcelain'])
      if (statusOut) {
        const hasIdentity = await this.hasGitIdentity(syncRoot)
        const commitArgs = hasIdentity
          ? ['commit', '-m', 'Sync CrowBrain vault']
          : [
              '-c',
              'user.name=CrowBrain',
              '-c',
              'user.email=crowbrain@local',
              'commit',
              '-m',
              'Sync CrowBrain vault'
            ]
        await this.git(syncRoot, commitArgs)
      }

      let remoteBranchExists = false
      try {
        const lsOut = await this.git(syncRoot, ['ls-remote', '--heads', 'origin', branch])
        remoteBranchExists = Boolean(lsOut)
      } catch {
        remoteBranchExists = false
      }

      if (remoteBranchExists) {
        try {
          await this.git(syncRoot, ['pull', '--rebase', 'origin', branch])
        } catch (pullErr) {
          try {
            await this.git(syncRoot, ['rebase', '--abort'])
          } catch {
            // Ignore if no rebase in progress
          }
          throw pullErr
        }
      }

      // Reconcile pulled manifest (additions, renames, pins, tombstones) and mirror back to external vaults
      if (fs.existsSync(manifestPath)) {
        const pulledManifest = JSON.parse(
          fs.readFileSync(manifestPath, 'utf-8')
        ) as PortableManifest
        const latestSettings = this.settingsManager.getSettings()
        const reconciled = mergeManifestProjects(
          latestSettings.projects,
          pulledManifest,
          latestSettings.deletedProjectIds ?? []
        )
        const activeItems = reconciled.filter((item) => !item.deleted)
        const deletedIds = new Set(reconciled.filter((item) => item.deleted).map((item) => item.id))

        const nextProjects: ProjectEntry[] = []
        let changed = false

        for (const local of latestSettings.projects) {
          if (deletedIds.has(local.id)) {
            changed = true
            continue
          }
          const match = activeItems.find((item) => item.id === local.id)
          if (match) {
            if (match.name !== local.name || Boolean(match.pinned) !== Boolean(local.pinned)) {
              changed = true
            }
            nextProjects.push({
              ...local,
              name: match.name,
              slug: match.slug,
              pinned: Boolean(match.pinned),
              updatedAt: match.updatedAt ?? local.updatedAt
            })
          } else {
            nextProjects.push(local)
          }
        }

        for (const item of activeItems) {
          if (!nextProjects.some((p) => p.id === item.id)) {
            const localPath = path.join(syncRoot, item.slug)
            fs.mkdirSync(localPath, { recursive: true })
            nextProjects.push({
              id: item.id,
              name: item.name,
              slug: item.slug,
              vaultPath: localPath,
              createdAt: item.createdAt,
              updatedAt: item.updatedAt ?? item.createdAt,
              pinned: Boolean(item.pinned)
            })
            changed = true
          }
        }

        if (changed && nextProjects.length > 0) {
          const nextActive =
            nextProjects.find((p) => p.id === latestSettings.activeProjectId) ?? nextProjects[0]
          this.settingsManager.updateSettings({
            projects: nextProjects,
            activeProjectId: nextActive.id,
            vaultPath: nextActive.vaultPath,
            deletedProjectIds: Array.from(deletedIds)
          })
          await this.onProjectsUpdated()
        }

        for (const proj of nextProjects) {
          this.mirrorRootBackToExternalProject(proj, syncRoot)
        }
      }

      await this.git(syncRoot, ['push', '-u', 'origin', branch])

      const finalCount = this.settingsManager.getSettings().projects.length
      this.updateStatus({
        configured: true,
        state: 'idle',
        lastSyncedAt: Date.now(),
        lastSummary: `${finalCount} projects synced to ${branch}`,
        error: undefined
      })
      return this.getStatus()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Git sync failed'
      this.updateStatus({ configured: true, state: 'error', error: message })
      return this.getStatus()
    } finally {
      this.syncing = false
    }
  }
}

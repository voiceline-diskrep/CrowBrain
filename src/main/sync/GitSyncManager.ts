import { execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'
import type { GitSyncStatus, ProjectEntry } from '@shared/types'
import type { SettingsManager } from '../settings'
import {
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

  private mirrorExternalProjectToRoot(project: ProjectEntry, syncRoot: string): void {
    const slug = slugifyProjectName(project.name, project.id)
    const destRoot = path.join(syncRoot, slug)
    const resolvedSrc = path.resolve(project.vaultPath)
    const resolvedDest = path.resolve(destRoot)

    if (resolvedSrc === resolvedDest || resolvedSrc.startsWith(path.resolve(syncRoot) + path.sep)) {
      return
    }
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
        } else if (entry.isFile() && (entry.name.endsWith('.md') || entry.name.endsWith('.jsonl'))) {
          fs.copyFileSync(srcPath, targetPath)
        }
      }
    }

    copyDir(resolvedSrc, resolvedDest)
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

      const mergedBeforePull = mergeManifestProjects(settings.projects, existingManifest)
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
        await this.git(syncRoot, ['commit', '-m', 'Sync CrowBrain vault'])
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

      // Import any projects added by another device from manifest.json
      if (fs.existsSync(manifestPath)) {
        const pulledManifest = JSON.parse(
          fs.readFileSync(manifestPath, 'utf-8')
        ) as PortableManifest
        const currentProjects = [...this.settingsManager.getSettings().projects]
        let added = false
        for (const item of pulledManifest.projects ?? []) {
          if (!currentProjects.some((p) => p.id === item.id)) {
            const localPath = path.join(syncRoot, item.slug)
            fs.mkdirSync(localPath, { recursive: true })
            currentProjects.push({
              id: item.id,
              name: item.name,
              vaultPath: localPath,
              createdAt: item.createdAt
            })
            added = true
          }
        }
        if (added) {
          this.settingsManager.updateSettings({ projects: currentProjects })
          await this.onProjectsUpdated()
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

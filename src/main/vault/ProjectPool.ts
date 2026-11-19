import path from 'path'
import type { ProjectEntry, VaultChangeEvent } from '@shared/types'
import { VaultManager } from './VaultManager'
import { BackupsManager } from './BackupsManager'
import { LogsManager } from './LogsManager'

export interface ProjectRuntime {
  project: ProjectEntry
  vault: VaultManager
  backups: BackupsManager
  logs: LogsManager
}

export class ProjectPool {
  private runtimes = new Map<string, ProjectRuntime>()
  private activeProjectId = 'default'

  constructor(private readonly onVaultChange?: (event: VaultChangeEvent) => void) {}

  async syncProjects(projects: ProjectEntry[], activeProjectId: string): Promise<void> {
    this.activeProjectId = activeProjectId
    const incomingIds = new Set(projects.map((p) => p.id))

    for (const [id, runtime] of this.runtimes.entries()) {
      if (!incomingIds.has(id)) {
        await runtime.vault.close()
        this.runtimes.delete(id)
      }
    }

    for (const project of projects) {
      const existing = this.runtimes.get(project.id)
      if (existing) {
        const prevPath = path.resolve(existing.project.vaultPath)
        const nextPath = path.resolve(project.vaultPath)
        existing.project = { ...project }
        if (prevPath !== nextPath) {
          await existing.vault.setVaultPath(nextPath)
          existing.backups.setVaultPath(nextPath)
          existing.logs.setVaultPath(nextPath)
        }
        continue
      }

      const projectId = project.id
      const vault = new VaultManager(project.vaultPath, (kind) => {
        this.onVaultChange?.({ projectId, kind })
      })
      await vault.init()
      const backups = new BackupsManager(project.vaultPath)
      const logs = new LogsManager(project.vaultPath)

      this.runtimes.set(project.id, {
        project: { ...project },
        vault,
        backups,
        logs
      })
    }
  }

  resolve(projectRef?: string): ProjectRuntime {
    const trimmed = projectRef?.trim()
    if (trimmed) {
      const byId = this.runtimes.get(trimmed)
      if (byId) return byId

      const lower = trimmed.toLowerCase()
      for (const runtime of this.runtimes.values()) {
        if (
          runtime.project.name.toLowerCase() === lower ||
          path.resolve(runtime.project.vaultPath).toLowerCase() === path.resolve(trimmed).toLowerCase()
        ) {
          return runtime
        }
      }
      throw new Error(`Project not found: ${trimmed}`)
    }

    const active = this.runtimes.get(this.activeProjectId)
    if (active) return active

    const first = this.runtimes.values().next().value as ProjectRuntime | undefined
    if (first) return first

    throw new Error('No projects configured in CrowBrain')
  }

  listProjects(): Array<{ id: string; name: string; vaultPath: string; active: boolean }> {
    return Array.from(this.runtimes.values()).map((runtime) => ({
      id: runtime.project.id,
      name: runtime.project.name,
      vaultPath: runtime.project.vaultPath,
      active: runtime.project.id === this.activeProjectId
    }))
  }

  async closeAll(): Promise<void> {
    for (const runtime of this.runtimes.values()) {
      await runtime.vault.close()
    }
    this.runtimes.clear()
  }
}

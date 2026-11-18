import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import type { WorkLogEntry } from '@shared/types'

export interface GetLogsOptions {
  harness?: string
  category?: string
  query?: string
  limit?: number
}

export class LogsManager {
  private vaultPath: string

  constructor(vaultPath: string) {
    this.vaultPath = path.resolve(vaultPath)
  }

  setVaultPath(newPath: string): void {
    this.vaultPath = path.resolve(newPath)
  }

  async saveLog(input: Omit<WorkLogEntry, 'id' | 'timestamp'>): Promise<WorkLogEntry> {
    const timestamp = Date.now()
    const entry: WorkLogEntry = {
      id: crypto.randomUUID(),
      timestamp,
      harness: input.harness.trim() || 'assistant',
      category: input.category.trim() || 'note',
      ...(input.version?.trim() ? { version: input.version.trim() } : {}),
      title: input.title.trim(),
      details: input.details,
      filesChanged: Array.isArray(input.filesChanged) ? [...input.filesChanged] : []
    }

    const logsDir = this.getLogsDir()
    fs.mkdirSync(logsDir, { recursive: true })

    const dateStr = new Date(timestamp).toISOString().slice(0, 10)
    const filePath = path.join(logsDir, `${dateStr}.jsonl`)
    fs.appendFileSync(filePath, `${JSON.stringify(entry)}\n`, 'utf-8')

    return entry
  }

  async getLogs(options?: GetLogsOptions): Promise<WorkLogEntry[]> {
    const logsDir = this.getLogsDir()
    if (!fs.existsSync(logsDir)) {
      return []
    }

    const files = fs
      .readdirSync(logsDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.jsonl'))
      .map((entry) => entry.name)
      .sort()
      .reverse()

    const results: WorkLogEntry[] = []
    const harnessFilter = options?.harness?.trim().toLowerCase()
    const categoryFilter = options?.category?.trim().toLowerCase()
    const queryFilter = options?.query?.trim().toLowerCase()

    for (const fileName of files) {
      const fullPath = path.join(logsDir, fileName)
      const content = fs.readFileSync(fullPath, 'utf-8')
      const lines = content.split(/\r?\n/)

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed) {
          continue
        }
        try {
          const item = JSON.parse(trimmed) as WorkLogEntry
          if (harnessFilter && item.harness.toLowerCase() !== harnessFilter) {
            continue
          }
          if (categoryFilter && item.category.toLowerCase() !== categoryFilter) {
            continue
          }
          if (queryFilter) {
            const haystack = [
              item.title,
              item.details,
              item.category,
              item.version ?? '',
              item.harness,
              ...(item.filesChanged ?? [])
            ]
              .join(' ')
              .toLowerCase()
            if (!haystack.includes(queryFilter)) {
              continue
            }
          }
          results.push(item)
        } catch {
          // Skip malformed JSONL lines without failing the query.
        }
      }
    }

    results.sort((a, b) => b.timestamp - a.timestamp)

    if (options?.limit && options.limit > 0) {
      return results.slice(0, options.limit)
    }

    return results
  }

  private getLogsDir(): string {
    return path.join(this.vaultPath, 'logs')
  }
}

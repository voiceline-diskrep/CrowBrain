import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import type { MessageBackup } from '@shared/types'

export interface GetMessagesOptions {
  harness?: string
  sessionId?: string
  query?: string
  limit?: number
}

export class BackupsManager {
  private vaultPath: string

  constructor(vaultPath: string) {
    this.vaultPath = path.resolve(vaultPath)
  }

  setVaultPath(newPath: string): void {
    this.vaultPath = path.resolve(newPath)
  }

  async saveMessage(input: Omit<MessageBackup, 'id' | 'timestamp'>): Promise<MessageBackup> {
    const timestamp = Date.now()
    const entry: MessageBackup = {
      id: crypto.randomUUID(),
      timestamp,
      harness: input.harness,
      sessionId: input.sessionId,
      role: input.role,
      message: input.message,
      summaryForFutureSelf: input.summaryForFutureSelf,
      relatedFiles: Array.isArray(input.relatedFiles) ? [...input.relatedFiles] : [],
      tags: Array.isArray(input.tags) ? [...input.tags] : []
    }

    const backupsDir = this.getBackupsDir()
    fs.mkdirSync(backupsDir, { recursive: true })

    const dateStr = new Date(timestamp).toISOString().slice(0, 10)
    const filePath = path.join(backupsDir, `${dateStr}.jsonl`)
    fs.appendFileSync(filePath, `${JSON.stringify(entry)}\n`, 'utf-8')

    return entry
  }

  async getMessages(options?: GetMessagesOptions): Promise<MessageBackup[]> {
    const backupsDir = this.getBackupsDir()
    if (!fs.existsSync(backupsDir)) {
      return []
    }

    const files = fs
      .readdirSync(backupsDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.jsonl'))
      .map((entry) => entry.name)
      .sort()
      .reverse()

    const results: MessageBackup[] = []
    const harnessFilter = options?.harness?.trim().toLowerCase()
    const sessionFilter = options?.sessionId?.trim()
    const queryFilter = options?.query?.trim().toLowerCase()

    for (const fileName of files) {
      const fullPath = path.join(backupsDir, fileName)
      const content = fs.readFileSync(fullPath, 'utf-8')
      const lines = content.split(/\r?\n/)

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed) {
          continue
        }
        try {
          const item = JSON.parse(trimmed) as MessageBackup
          if (harnessFilter && item.harness.toLowerCase() !== harnessFilter) {
            continue
          }
          if (sessionFilter && item.sessionId !== sessionFilter) {
            continue
          }
          if (queryFilter) {
            const haystack = [
              item.message,
              item.summaryForFutureSelf,
              item.harness,
              item.sessionId,
              ...(item.tags ?? []),
              ...(item.relatedFiles ?? [])
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

  private getBackupsDir(): string {
    return path.join(this.vaultPath, 'backups')
  }
}

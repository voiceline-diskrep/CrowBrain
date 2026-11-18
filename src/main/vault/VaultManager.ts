import fs from 'fs'
import path from 'path'
import chokidar, { type FSWatcher } from 'chokidar'
import type {
  BranchGraph,
  BranchGraphEdge,
  BranchGraphNode,
  ContextNote,
  RulesData,
  VaultNote
} from '@shared/types'
import { parseMarkdown, serializeNote } from './markdown'

const DEFAULT_GLOBAL_RULES = `# Global Rules

Persistent instructions and constraints applied across all AI agent sessions.

- Follow repository conventions and existing architectural patterns.
- Keep changes focused and verify behavior with tests before reporting completion.
- Update system-map.md when project structure or key entry points change.
`

const DEFAULT_CHAT_RULES = `# Chat Rules

Session-level communication and workflow preferences for AI agents.

- Keep responses concise, accurate, and direct.
- Reference exact file paths and symbol names observed in the workspace.
- Back up important messages and summaries using backup_message.
`

const DEFAULT_SYSTEM_MAP = `# System Map

Structural reference maintained by AI agents for the CrowBrain vault and active project.

## Vault Structure

- branches/ - Knowledge notes and topic branches connected with [[wikilinks]].
- backups/ - Daily JSONL message backups (YYYY-MM-DD.jsonl) with summaries for future sessions.
- rules/global-rules.md - Persistent rules applied across all sessions.
- rules/chat-rules.md - Conversation and workflow rules.
- rules/context/ - Topic-specific and project-specific context notes.
- system-map.md - This self-note documenting where everything lives.

## Active Project Notes

Document key entry points, modules, and conventions for the active project below.
`

function normalizeRelPath(relPath: string): string {
  return relPath.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '')
}

function shouldIgnorePath(targetPath: string): boolean {
  const normalized = targetPath.replace(/\\/g, '/')
  return (
    normalized.includes('/.crowbrain/') ||
    normalized.endsWith('/.crowbrain') ||
    normalized.includes('/.git/') ||
    normalized.endsWith('/.git') ||
    normalized.includes('/node_modules/') ||
    normalized.endsWith('/node_modules')
  )
}

export class VaultManager {
  private vaultPath: string
  private notes: Map<string, VaultNote> = new Map()
  private watcher: FSWatcher | null = null

  constructor(vaultPath: string) {
    this.vaultPath = path.resolve(vaultPath)
  }

  getVaultPath(): string {
    return this.vaultPath
  }

  async init(): Promise<void> {
    this.ensureStructure()
    this.scanAllNotes()
    this.recomputeBacklinks()
    this.startWatcher()
  }

  async close(): Promise<void> {
    if (this.watcher) {
      await this.watcher.close()
      this.watcher = null
    }
  }

  async setVaultPath(newPath: string): Promise<void> {
    await this.close()
    this.vaultPath = path.resolve(newPath)
    this.notes.clear()
    await this.init()
  }

  getNotes(): VaultNote[] {
    return Array.from(this.notes.values()).sort((a, b) => b.updatedAt - a.updatedAt)
  }

  getNote(relPathOrTitle: string): VaultNote | null {
    const query = normalizeRelPath(relPathOrTitle).trim()
    if (!query) {
      return null
    }

    const direct = this.notes.get(query)
    if (direct) {
      return direct
    }

    if (!query.endsWith('.md')) {
      const withExt = this.notes.get(`${query}.md`)
      if (withExt) {
        return withExt
      }
    }

    const lowerQuery = query.toLowerCase()
    const lowerNoExt = lowerQuery.endsWith('.md') ? lowerQuery.slice(0, -3) : lowerQuery

    for (const note of this.notes.values()) {
      if (note.title.toLowerCase() === lowerQuery) {
        return note
      }
      const notePathNoExt = note.path.toLowerCase().replace(/\.md$/i, '')
      if (notePathNoExt === lowerNoExt) {
        return note
      }
      const basename = path.posix.basename(notePathNoExt)
      if (basename === lowerNoExt) {
        return note
      }
    }

    return null
  }

  async saveNote(
    relPath: string,
    content: string,
    frontmatter?: Record<string, unknown>
  ): Promise<VaultNote> {
    const normalized = this.ensureMarkdownExtension(normalizeRelPath(relPath))
    const fullPath = this.resolveInsideVault(normalized)
    fs.mkdirSync(path.dirname(fullPath), { recursive: true })

    const serialized = serializeNote(content, frontmatter)
    fs.writeFileSync(fullPath, serialized, 'utf-8')

    const indexed = this.indexFile(fullPath)
    this.recomputeBacklinks()
    if (!indexed) {
      throw new Error(`Failed to index saved note: ${normalized}`)
    }
    return this.notes.get(indexed.path) ?? indexed
  }

  async deleteNote(relPath: string): Promise<boolean> {
    const existing = this.getNote(relPath)
    const targetRel = existing ? existing.path : this.ensureMarkdownExtension(normalizeRelPath(relPath))
    const fullPath = this.resolveInsideVault(targetRel)

    if (!fs.existsSync(fullPath)) {
      return false
    }

    fs.unlinkSync(fullPath)
    this.notes.delete(targetRel)
    this.recomputeBacklinks()
    return true
  }

  searchNotes(query: string, folder?: string, tag?: string): VaultNote[] {
    const normalizedQuery = query.trim().toLowerCase()
    const normalizedFolder = folder ? normalizeRelPath(folder).replace(/\/+$/, '').toLowerCase() : ''
    const normalizedTag = tag ? tag.trim().replace(/^#/, '').toLowerCase() : ''

    return this.getNotes().filter((note) => {
      if (normalizedFolder) {
        const noteFolder = note.folder.toLowerCase()
        if (noteFolder !== normalizedFolder && !noteFolder.startsWith(`${normalizedFolder}/`)) {
          return false
        }
      }

      if (normalizedTag) {
        const hasTag = note.tags.some((t) => t.toLowerCase() === normalizedTag)
        if (!hasTag) {
          return false
        }
      }

      if (normalizedQuery) {
        const inTitle = note.title.toLowerCase().includes(normalizedQuery)
        const inPath = note.path.toLowerCase().includes(normalizedQuery)
        const inContent = note.content.toLowerCase().includes(normalizedQuery)
        const inTags = note.tags.some((t) => t.toLowerCase().includes(normalizedQuery))
        if (!inTitle && !inPath && !inContent && !inTags) {
          return false
        }
      }

      return true
    })
  }

  getBranchGraph(folderFilter?: string): BranchGraph {
    const normalizedFilter = folderFilter
      ? normalizeRelPath(folderFilter).replace(/\/+$/, '').toLowerCase()
      : ''

    const filteredNotes = this.getNotes().filter((note) => {
      if (!normalizedFilter) {
        return true
      }
      const noteFolder = note.folder.toLowerCase()
      return noteFolder === normalizedFilter || noteFolder.startsWith(`${normalizedFilter}/`)
    })

    const nodeMap = new Map<string, BranchGraphNode>()
    for (const note of filteredNotes) {
      nodeMap.set(note.path, {
        id: note.path,
        title: note.title,
        path: note.path,
        folder: note.folder,
        tags: [...note.tags],
        linkCount: 0
      })
    }

    const edgeSet = new Set<string>()
    const edges: BranchGraphEdge[] = []

    for (const note of filteredNotes) {
      for (const linkTarget of note.links) {
        const resolved = this.resolveLinkTarget(linkTarget)
        if (!resolved || resolved.path === note.path || !nodeMap.has(resolved.path)) {
          continue
        }
        const key = `${note.path}->${resolved.path}`
        if (!edgeSet.has(key)) {
          edgeSet.add(key)
          edges.push({ source: note.path, target: resolved.path })
          const sourceNode = nodeMap.get(note.path)
          const targetNode = nodeMap.get(resolved.path)
          if (sourceNode) sourceNode.linkCount += 1
          if (targetNode) targetNode.linkCount += 1
        }
      }
    }

    return {
      nodes: Array.from(nodeMap.values()),
      edges
    }
  }

  async linkNotes(sourcePathOrTitle: string, targetTitle: string): Promise<VaultNote | null> {
    const source = this.getNote(sourcePathOrTitle)
    if (!source) {
      return null
    }

    const cleanTarget = targetTitle.trim()
    if (!cleanTarget) {
      return source
    }

    const alreadyLinked = source.links.some(
      (link) => link.toLowerCase() === cleanTarget.toLowerCase()
    )
    if (alreadyLinked) {
      return source
    }

    const separator = source.content.length === 0
      ? ''
      : source.content.endsWith('\n')
        ? '\n'
        : '\n\n'
    const updatedContent = `${source.content}${separator}[[${cleanTarget}]]\n`

    return this.saveNote(source.path, updatedContent, source.frontmatter)
  }

  async getRules(): Promise<RulesData> {
    const globalPath = path.join(this.vaultPath, 'rules', 'global-rules.md')
    const chatPath = path.join(this.vaultPath, 'rules', 'chat-rules.md')
    const contextDir = path.join(this.vaultPath, 'rules', 'context')

    const globalRules = fs.existsSync(globalPath) ? fs.readFileSync(globalPath, 'utf-8') : ''
    const chatRules = fs.existsSync(chatPath) ? fs.readFileSync(chatPath, 'utf-8') : ''

    const contextNotes: ContextNote[] = []
    if (fs.existsSync(contextDir)) {
      const entries = fs.readdirSync(contextDir, { withFileTypes: true })
      for (const entry of entries) {
        if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
          const fullPath = path.join(contextDir, entry.name)
          const relPath = normalizeRelPath(path.relative(this.vaultPath, fullPath))
          contextNotes.push({
            name: entry.name.replace(/\.md$/i, ''),
            path: relPath,
            content: fs.readFileSync(fullPath, 'utf-8')
          })
        }
      }
      contextNotes.sort((a, b) => a.name.localeCompare(b.name))
    }

    return { globalRules, chatRules, contextNotes }
  }

  async saveRules(
    type: 'global' | 'chat' | 'context',
    content: string,
    contextName?: string
  ): Promise<RulesData> {
    if (type === 'global') {
      await this.saveNote('rules/global-rules.md', content)
    } else if (type === 'chat') {
      await this.saveNote('rules/chat-rules.md', content)
    } else {
      const safeName = (contextName ?? '').trim().replace(/[<>:"/\\|?*]/g, '-')
      if (!safeName) {
        throw new Error('contextName is required when saving context rules')
      }
      const fileName = safeName.toLowerCase().endsWith('.md') ? safeName : `${safeName}.md`
      await this.saveNote(`rules/context/${fileName}`, content)
    }

    return this.getRules()
  }

  async getSystemMap(): Promise<string> {
    const systemMapPath = path.join(this.vaultPath, 'system-map.md')
    if (!fs.existsSync(systemMapPath)) {
      return ''
    }
    return fs.readFileSync(systemMapPath, 'utf-8')
  }

  async updateSystemMap(content: string): Promise<string> {
    await this.saveNote('system-map.md', content)
    return content
  }

  private ensureStructure(): void {
    const dirs = [
      this.vaultPath,
      path.join(this.vaultPath, 'branches'),
      path.join(this.vaultPath, 'backups'),
      path.join(this.vaultPath, 'rules'),
      path.join(this.vaultPath, 'rules', 'context')
    ]

    for (const dir of dirs) {
      fs.mkdirSync(dir, { recursive: true })
    }

    const defaultFiles: Array<{ relPath: string; content: string }> = [
      { relPath: path.join('rules', 'global-rules.md'), content: DEFAULT_GLOBAL_RULES },
      { relPath: path.join('rules', 'chat-rules.md'), content: DEFAULT_CHAT_RULES },
      { relPath: 'system-map.md', content: DEFAULT_SYSTEM_MAP }
    ]

    for (const file of defaultFiles) {
      const fullPath = path.join(this.vaultPath, file.relPath)
      if (!fs.existsSync(fullPath)) {
        fs.writeFileSync(fullPath, file.content, 'utf-8')
      }
    }
  }

  private scanAllNotes(): void {
    this.notes.clear()
    this.walkDirectory(this.vaultPath)
  }

  private walkDirectory(dir: string): void {
    if (!fs.existsSync(dir)) {
      return
    }
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name)
      if (shouldIgnorePath(fullPath)) {
        continue
      }
      if (entry.isDirectory()) {
        this.walkDirectory(fullPath)
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
        this.indexFile(fullPath)
      }
    }
  }

  private indexFile(fullPath: string): VaultNote | null {
    if (!fullPath.toLowerCase().endsWith('.md') || shouldIgnorePath(fullPath)) {
      return null
    }
    if (!fs.existsSync(fullPath)) {
      return null
    }

    const raw = fs.readFileSync(fullPath, 'utf-8')
    const stat = fs.statSync(fullPath)
    const relPath = normalizeRelPath(path.relative(this.vaultPath, fullPath))
    const dirName = path.posix.dirname(relPath)
    const folder = dirName === '.' ? '' : dirName
    const fallbackTitle = path.posix.basename(relPath, path.posix.extname(relPath))
    const parsed = parseMarkdown(raw, fallbackTitle)

    const note: VaultNote = {
      path: relPath,
      title: parsed.title,
      folder,
      content: parsed.content,
      frontmatter: parsed.frontmatter,
      tags: parsed.tags,
      links: parsed.links,
      backlinks: [],
      updatedAt: stat.mtimeMs
    }

    this.notes.set(relPath, note)
    return note
  }

  private recomputeBacklinks(): void {
    const backlinkMap = new Map<string, Set<string>>()
    for (const note of this.notes.values()) {
      backlinkMap.set(note.path, new Set<string>())
    }

    for (const source of this.notes.values()) {
      for (const targetLink of source.links) {
        const targetNote = this.resolveLinkTarget(targetLink)
        if (targetNote && targetNote.path !== source.path) {
          backlinkMap.get(targetNote.path)?.add(source.path)
        }
      }
    }

    for (const note of this.notes.values()) {
      note.backlinks = Array.from(backlinkMap.get(note.path) ?? []).sort()
    }
  }

  private resolveLinkTarget(target: string): VaultNote | null {
    return this.getNote(target)
  }

  private startWatcher(): void {
    this.watcher = chokidar.watch(this.vaultPath, {
      ignored: (watchedPath) => shouldIgnorePath(watchedPath),
      ignoreInitial: true,
      persistent: false
    })

    this.watcher.on('add', (filePath) => {
      if (this.indexFile(filePath)) {
        this.recomputeBacklinks()
      }
    })

    this.watcher.on('change', (filePath) => {
      if (this.indexFile(filePath)) {
        this.recomputeBacklinks()
      }
    })

    this.watcher.on('unlink', (filePath) => {
      const relPath = normalizeRelPath(path.relative(this.vaultPath, filePath))
      if (this.notes.delete(relPath)) {
        this.recomputeBacklinks()
      }
    })
  }

  private ensureMarkdownExtension(relPath: string): string {
    return relPath.toLowerCase().endsWith('.md') ? relPath : `${relPath}.md`
  }

  private resolveInsideVault(relPath: string): string {
    const resolved = path.resolve(this.vaultPath, relPath)
    const vaultPrefix = this.vaultPath.endsWith(path.sep)
      ? this.vaultPath
      : `${this.vaultPath}${path.sep}`

    if (resolved !== this.vaultPath && !resolved.startsWith(vaultPrefix)) {
      throw new Error(`Path escapes vault directory: ${relPath}`)
    }
    return resolved
  }
}

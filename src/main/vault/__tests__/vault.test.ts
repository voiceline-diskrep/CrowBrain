import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SettingsManager } from '../../settings'
import { BackupsManager } from '../BackupsManager'
import { LogsManager } from '../LogsManager'
import { ProjectPool } from '../ProjectPool'
import { VaultManager } from '../VaultManager'
import { extractTags, extractWikilinks, parseMarkdown, serializeNote } from '../markdown'

describe('markdown parser and serializer', () => {
  it('extracts wikilinks with and without aliases while ignoring code blocks', () => {
    const md = [
      '# Architecture',
      '',
      'See [[VaultManager]] and [[BackupsManager|Backup Store]].',
      '',
      '```ts',
      'const ignored = "[[IgnoredLink]]"',
      '```',
      '',
      'Inline `[[AlsoIgnored]]` should not be extracted.'
    ].join('\n')

    expect(extractWikilinks(md)).toEqual(['VaultManager', 'BackupsManager'])
  })

  it('extracts hashtags and frontmatter tags while ignoring code blocks and URLs', () => {
    const raw = [
      '---',
      'title: Auth Flow',
      'tags:',
      '  - security',
      '  - "#backend"',
      '---',
      '',
      'Implements token refresh #auth #mcp-server.',
      'Reference: https://example.com/docs#section-two and [link](https://test.dev/a#b).',
      '',
      '```bash',
      '#ignored-code-tag',
      '```',
      '',
      'Inline `#ignored-inline` tag.'
    ].join('\n')

    const parsed = parseMarkdown(raw, 'fallback')
    expect(parsed.title).toBe('Auth Flow')
    expect(parsed.tags).toEqual(['security', 'backend', 'auth', 'mcp-server'])
    expect(extractTags(parsed.content, parsed.frontmatter)).toEqual([
      'security',
      'backend',
      'auth',
      'mcp-server'
    ])
  })

  it('serializes note content with and without frontmatter', () => {
    expect(serializeNote('Plain body')).toBe('Plain body')

    const serialized = serializeNote('Body text\n', { title: 'Test Note', tags: ['core'] })
    const reparsed = parseMarkdown(serialized)
    expect(reparsed.title).toBe('Test Note')
    expect(reparsed.tags).toEqual(['core'])
    expect(reparsed.content.trim()).toBe('Body text')
  })
})

describe('SettingsManager', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'crowbrain-settings-'))
  })

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  it('provides defaults and persists updates to settings.json', () => {
    const defaultVault = path.join(tempDir, 'DefaultVault')
    const manager = new SettingsManager(tempDir, defaultVault)

    const initial = manager.getSettings()
    expect(initial.vaultPath).toBe(defaultVault)
    expect(initial.theme).toBe('dark')
    expect(initial.animationSpeed).toBe('normal')
    expect(initial.mcpPort).toBe(3345)
    expect(initial.checkUpdatesOnStartup).toBe(true)
    expect(initial.customTheme.background).toBe('#0a0a0a')
    expect(initial.activeProjectId).toBe('default')
    expect(initial.projects).toHaveLength(1)

    const updated = manager.updateSettings({
      theme: 'custom',
      mcpPort: 4100,
      customTheme: { ...initial.customTheme, accent: '#22c55e' }
    })
    expect(updated.theme).toBe('custom')
    expect(updated.mcpPort).toBe(4100)
    expect(updated.customTheme.accent).toBe('#22c55e')

    const reloaded = new SettingsManager(tempDir, defaultVault).getSettings()
    expect(reloaded.theme).toBe('custom')
    expect(reloaded.mcpPort).toBe(4100)
    expect(reloaded.customTheme.accent).toBe('#22c55e')
  })
})

describe('VaultManager', () => {
  let tempDir: string
  let vault: VaultManager

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'crowbrain-vault-'))
    vault = new VaultManager(tempDir)
    await vault.init()
  })

  afterEach(async () => {
    await vault.close()
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  it('creates default directories and template files on init', async () => {
    expect(fs.existsSync(path.join(tempDir, 'branches'))).toBe(true)
    expect(fs.existsSync(path.join(tempDir, 'backups'))).toBe(true)
    expect(fs.existsSync(path.join(tempDir, 'rules', 'global-rules.md'))).toBe(true)
    expect(fs.existsSync(path.join(tempDir, 'rules', 'chat-rules.md'))).toBe(true)
    expect(fs.existsSync(path.join(tempDir, 'rules', 'context'))).toBe(true)
    expect(fs.existsSync(path.join(tempDir, 'system-map.md'))).toBe(true)

    const systemMap = await vault.getSystemMap()
    expect(systemMap).toContain('# System Map')
  })

  it('saves, retrieves, searches, links, and builds backlink graph', async () => {
    await vault.saveNote('branches/auth.md', '# Authentication\n\nHandles tokens #security', {
      title: 'Authentication',
      tags: ['core']
    })
    await vault.saveNote(
      'branches/session.md',
      '# Session Store\n\nDepends on [[Authentication]] #backend'
    )

    const authNote = vault.getNote('Authentication')
    expect(authNote).not.toBeNull()
    expect(authNote?.backlinks).toEqual(['branches/session.md'])

    const byTag = vault.searchNotes('', 'branches', 'backend')
    expect(byTag.map((n) => n.path)).toEqual(['branches/session.md'])

    const byQuery = vault.searchNotes('tokens', 'branches')
    expect(byQuery.map((n) => n.path)).toEqual(['branches/auth.md'])

    const graph = vault.getBranchGraph('branches')
    expect(graph.nodes).toHaveLength(2)
    expect(graph.edges).toEqual([
      { source: 'branches/session.md', target: 'branches/auth.md' }
    ])

    const linked = await vault.linkNotes('branches/auth.md', 'Session Store')
    expect(linked?.links).toContain('Session Store')

    // Linking again should not duplicate the wikilink
    const linkedAgain = await vault.linkNotes('branches/auth.md', 'Session Store')
    expect(linkedAgain?.links).toEqual(['Session Store'])

    const deleted = await vault.deleteNote('branches/session.md')
    expect(deleted).toBe(true)
    expect(vault.getNote('branches/session.md')).toBeNull()
  })

  it('reads and updates rules and system map', async () => {
    const initialRules = await vault.getRules()
    expect(initialRules.globalRules).toContain('# Global Rules')
    expect(initialRules.chatRules).toContain('# Chat Rules')
    expect(initialRules.contextNotes).toEqual([])

    const updatedRules = await vault.saveRules('context', '# API Rules\n\nUse JSON.', 'api-rules')
    expect(updatedRules.contextNotes).toHaveLength(1)
    expect(updatedRules.contextNotes[0].name).toBe('api-rules')
    expect(updatedRules.contextNotes[0].content).toContain('Use JSON.')

    const newMap = '# System Map\n\nUpdated map.'
    await vault.updateSystemMap(newMap)
    expect(await vault.getSystemMap()).toBe(newMap)
  })
})

describe('BackupsManager', () => {
  let tempDir: string
  let backups: BackupsManager

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'crowbrain-backups-'))
    backups = new BackupsManager(tempDir)
  })

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  it('saves messages to daily JSONL and queries by harness, sessionId, query, and limit', async () => {
    const first = await backups.saveMessage({
      harness: 'claude-code',
      sessionId: 'sess-1',
      role: 'user',
      message: 'Refactor the vault indexer',
      summaryForFutureSelf: 'Started refactoring VaultManager backlink computation.',
      relatedFiles: ['src/main/vault/VaultManager.ts'],
      tags: ['vault', 'refactor']
    })

    const second = await backups.saveMessage({
      harness: 'cursor',
      sessionId: 'sess-2',
      role: 'assistant',
      message: 'Added unit tests for markdown parsing',
      summaryForFutureSelf: 'Verified wikilink and tag extraction in vitest.',
      relatedFiles: ['src/main/vault/markdown.ts'],
      tags: ['tests']
    })

    expect(first.id).toBeTruthy()
    expect(second.id).toBeTruthy()

    const dateFile = `${new Date(first.timestamp).toISOString().slice(0, 10)}.jsonl`
    expect(fs.existsSync(path.join(tempDir, 'backups', dateFile))).toBe(true)

    const byHarness = await backups.getMessages({ harness: 'claude-code' })
    expect(byHarness).toHaveLength(1)
    expect(byHarness[0].sessionId).toBe('sess-1')

    const byQuery = await backups.getMessages({ query: 'wikilink' })
    expect(byQuery).toHaveLength(1)
    expect(byQuery[0].harness).toBe('cursor')

    const limited = await backups.getMessages({ limit: 1 })
    expect(limited).toHaveLength(1)
  })
})

describe('LogsManager', () => {
  let tempDir: string
  let logs: LogsManager

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'crowbrain-logs-'))
    logs = new LogsManager(tempDir)
  })

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  it('saves work logs to daily JSONL and queries by category, harness, and text', async () => {
    const entry1 = await logs.saveLog({
      harness: 'antigravity',
      category: 'feature',
      version: '0.3.0',
      title: 'Added Work Logs feature',
      details: 'Implemented LogsManager, MCP log_work tool, and LogsView UI.',
      filesChanged: ['src/main/vault/LogsManager.ts', 'src/renderer/src/components/LogsView.tsx']
    })

    const entry2 = await logs.saveLog({
      harness: 'claude-code',
      category: 'fix',
      version: '0.3.1',
      title: 'Fixed sidebar scroll overflow',
      details: 'Adjusted flex container sizing in Sidebar.',
      filesChanged: ['src/renderer/src/components/Sidebar.tsx']
    })

    expect(entry1.id).toBeTruthy()
    expect(entry2.id).toBeTruthy()

    const dateFile = `${new Date(entry1.timestamp).toISOString().slice(0, 10)}.jsonl`
    expect(fs.existsSync(path.join(tempDir, 'logs', dateFile))).toBe(true)

    const byCategory = await logs.getLogs({ category: 'feature' })
    expect(byCategory).toHaveLength(1)
    expect(byCategory[0].version).toBe('0.3.0')

    const byQuery = await logs.getLogs({ query: 'Sidebar' })
    expect(byQuery).toHaveLength(1)
    expect(byQuery[0].harness).toBe('claude-code')
  })
})

describe('ProjectPool', () => {
  let tempDir: string
  let pool: ProjectPool

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'crowbrain-pool-'))
    pool = new ProjectPool()
  })

  afterEach(async () => {
    await pool.closeAll()
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  it('keeps multiple projects active concurrently and routes writes independently', async () => {
    const dirA = path.join(tempDir, 'project-a')
    const dirB = path.join(tempDir, 'project-b')

    await pool.syncProjects(
      [
        { id: 'proj-a', name: 'Alpha', vaultPath: dirA, createdAt: 1 },
        { id: 'proj-b', name: 'Beta', vaultPath: dirB, createdAt: 2 }
      ],
      'proj-a'
    )

    expect(pool.listProjects()).toHaveLength(2)
    expect(pool.resolve().project.id).toBe('proj-a')
    expect(pool.resolve('Beta').project.id).toBe('proj-b')

    await pool.resolve('proj-a').logs.saveLog({
      harness: 'antigravity',
      category: 'feature',
      title: 'Alpha change',
      details: 'Logged to Alpha only',
      filesChanged: []
    })

    await pool.resolve('Beta').logs.saveLog({
      harness: 'claude-code',
      category: 'fix',
      title: 'Beta fix',
      details: 'Logged to Beta only',
      filesChanged: []
    })

    const alphaLogs = await pool.resolve('proj-a').logs.getLogs()
    const betaLogs = await pool.resolve('proj-b').logs.getLogs()
    expect(alphaLogs).toHaveLength(1)
    expect(alphaLogs[0].title).toBe('Alpha change')
    expect(betaLogs).toHaveLength(1)
    expect(betaLogs[0].title).toBe('Beta fix')
  })
})

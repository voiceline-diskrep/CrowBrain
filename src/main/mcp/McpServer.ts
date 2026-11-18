import http, { type IncomingMessage, type ServerResponse } from 'node:http'
import { randomUUID } from 'node:crypto'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js'
import { z } from 'zod'
import type { AgentActivityEvent } from '@shared/types'
import type { ProjectRuntime } from '../vault/ProjectPool'

export interface ProjectSummary {
  id: string
  name: string
  vaultPath: string
  active: boolean
}

export interface CrowBrainMcpServerOptions {
  resolveProject: (projectRef?: string) => ProjectRuntime
  listProjects: () => ProjectSummary[]
  onActivity?: (event: AgentActivityEvent) => void
  version?: string
}

interface SseSession {
  server: McpServer
  transport: SSEServerTransport
}

export class CrowBrainMcpServer {
  private readonly resolveProject: (projectRef?: string) => ProjectRuntime
  private readonly listProjects: () => ProjectSummary[]
  private readonly onActivity?: (event: AgentActivityEvent) => void
  private readonly version: string
  private httpServer: http.Server | null = null
  private sessions = new Map<string, SseSession>()
  private port = 0
  private running = false

  constructor(options: CrowBrainMcpServerOptions) {
    this.resolveProject = options.resolveProject
    this.listProjects = options.listProjects
    this.onActivity = options.onActivity
    this.version = options.version ?? '0.4.0'
  }

  isRunning(): boolean {
    return this.running
  }

  getPort(): number {
    return this.port
  }

  private emitActivity(
    harness: string,
    action: string,
    detail: string,
    project?: string
  ): void {
    if (!this.onActivity) return
    this.onActivity({
      id: randomUUID(),
      timestamp: Date.now(),
      harness,
      action,
      detail,
      ...(project ? { project } : {})
    })
  }

  private createMcpInstance(sessionProject?: string): McpServer {
    const server = new McpServer({
      name: 'crowbrain',
      version: this.version
    })

    const getRuntime = (argProject?: string): ProjectRuntime =>
      this.resolveProject(argProject?.trim() || sessionProject)

    server.registerTool(
      'list_projects',
      {
        description: 'List all projects configured in CrowBrain so you can target a specific project.'
      },
      async () => {
        const projects = this.listProjects()
        this.emitActivity('mcp-client', 'list_projects', `${projects.length} projects`)
        return {
          content: [{ type: 'text', text: JSON.stringify(projects, null, 2) }]
        }
      }
    )

    server.registerTool(
      'backup_message',
      {
        description:
          'Save a conversation message backup with a summary for future AI sessions, related files, and tags.',
        inputSchema: {
          project: z
            .string()
            .optional()
            .describe('Target project ID or name (defaults to SSE session project or active project)'),
          harness: z.string().describe('AI harness name (e.g. antigravity, claude-code, codex)'),
          sessionId: z.string().describe('Session identifier'),
          role: z.string().describe('Message role (user, assistant, or system)'),
          message: z.string().describe('Full message content to back up'),
          summaryForFutureSelf: z
            .string()
            .describe('Thorough summary of context and decisions for future sessions'),
          relatedFiles: z.array(z.string()).optional().default([]).describe('Related file paths'),
          tags: z.array(z.string()).optional().default([]).describe('Tags for categorization')
        }
      },
      async (args) => {
        const runtime = getRuntime(args.project)
        const saved = await runtime.backups.saveMessage({
          harness: args.harness,
          sessionId: args.sessionId,
          role: args.role,
          message: args.message,
          summaryForFutureSelf: args.summaryForFutureSelf,
          relatedFiles: args.relatedFiles ?? [],
          tags: args.tags ?? []
        })
        this.emitActivity(
          args.harness,
          'backup_message',
          `Saved backup ${saved.id}`,
          runtime.project.name
        )
        return {
          content: [{ type: 'text', text: JSON.stringify(saved, null, 2) }]
        }
      }
    )

    server.registerTool(
      'get_rules',
      {
        description: 'Return global rules, chat rules, and context notes from the project vault.',
        inputSchema: {
          project: z
            .string()
            .optional()
            .describe('Target project ID or name (defaults to SSE session project or active project)')
        }
      },
      async (args) => {
        const runtime = getRuntime(args.project)
        const rules = await runtime.vault.getRules()
        this.emitActivity('mcp-client', 'get_rules', 'Fetched vault rules', runtime.project.name)
        return {
          content: [{ type: 'text', text: JSON.stringify(rules, null, 2) }]
        }
      }
    )

    server.registerTool(
      'read_system_map',
      {
        description: 'Read system-map.md documenting where features and files live in the codebase.',
        inputSchema: {
          project: z
            .string()
            .optional()
            .describe('Target project ID or name (defaults to SSE session project or active project)')
        }
      },
      async (args) => {
        const runtime = getRuntime(args.project)
        const content = await runtime.vault.getSystemMap()
        this.emitActivity(
          'mcp-client',
          'read_system_map',
          'Read system-map.md',
          runtime.project.name
        )
        return {
          content: [{ type: 'text', text: content }]
        }
      }
    )

    server.registerTool(
      'update_system_map',
      {
        description: 'Update system-map.md with current architecture and feature locations.',
        inputSchema: {
          project: z
            .string()
            .optional()
            .describe('Target project ID or name (defaults to SSE session project or active project)'),
          content: z.string().describe('Full markdown content for system-map.md')
        }
      },
      async (args) => {
        const runtime = getRuntime(args.project)
        const updated = await runtime.vault.updateSystemMap(args.content)
        this.emitActivity(
          'mcp-client',
          'update_system_map',
          'Updated system-map.md',
          runtime.project.name
        )
        return {
          content: [{ type: 'text', text: updated }]
        }
      }
    )

    server.registerTool(
      'search_vault',
      {
        description: 'Search notes in the vault by query, optional folder, and optional tag.',
        inputSchema: {
          project: z
            .string()
            .optional()
            .describe('Target project ID or name (defaults to SSE session project or active project)'),
          query: z.string().describe('Search query string'),
          folder: z.string().optional().describe('Optional folder filter'),
          tag: z.string().optional().describe('Optional tag filter')
        }
      },
      async (args) => {
        const runtime = getRuntime(args.project)
        const notes = runtime.vault.searchNotes(args.query, args.folder, args.tag)
        this.emitActivity(
          'mcp-client',
          'search_vault',
          `Query "${args.query}" (${notes.length} results)`,
          runtime.project.name
        )
        return {
          content: [{ type: 'text', text: JSON.stringify(notes, null, 2) }]
        }
      }
    )

    server.registerTool(
      'read_note',
      {
        description: 'Read a single vault note by relative path or title.',
        inputSchema: {
          project: z
            .string()
            .optional()
            .describe('Target project ID or name (defaults to SSE session project or active project)'),
          pathOrTitle: z.string().describe('Relative path or note title')
        }
      },
      async (args) => {
        const runtime = getRuntime(args.project)
        const note = runtime.vault.getNote(args.pathOrTitle)
        this.emitActivity('mcp-client', 'read_note', args.pathOrTitle, runtime.project.name)
        if (!note) {
          return {
            isError: true,
            content: [{ type: 'text', text: `Note not found: ${args.pathOrTitle}` }]
          }
        }
        return {
          content: [{ type: 'text', text: JSON.stringify(note, null, 2) }]
        }
      }
    )

    server.registerTool(
      'write_note',
      {
        description: 'Create or update a markdown note in the vault (for example in branches/).',
        inputSchema: {
          project: z
            .string()
            .optional()
            .describe('Target project ID or name (defaults to SSE session project or active project)'),
          relPath: z.string().describe('Relative path inside the vault (e.g. branches/auth.md)'),
          content: z.string().describe('Markdown body content'),
          frontmatter: z
            .record(z.string(), z.unknown())
            .optional()
            .describe('Optional YAML frontmatter fields')
        }
      },
      async (args) => {
        const runtime = getRuntime(args.project)
        const note = await runtime.vault.saveNote(args.relPath, args.content, args.frontmatter)
        this.emitActivity('mcp-client', 'write_note', note.path, runtime.project.name)
        return {
          content: [{ type: 'text', text: JSON.stringify(note, null, 2) }]
        }
      }
    )

    server.registerTool(
      'link_notes',
      {
        description: 'Add a wikilink from a source note to a target note.',
        inputSchema: {
          project: z
            .string()
            .optional()
            .describe('Target project ID or name (defaults to SSE session project or active project)'),
          source: z.string().describe('Source note relative path or title'),
          target: z.string().describe('Target note relative path or title')
        }
      },
      async (args) => {
        const runtime = getRuntime(args.project)
        const updated = await runtime.vault.linkNotes(args.source, args.target)
        this.emitActivity(
          'mcp-client',
          'link_notes',
          `${args.source} -> ${args.target}`,
          runtime.project.name
        )
        return {
          content: [{ type: 'text', text: JSON.stringify(updated, null, 2) }]
        }
      }
    )

    server.registerTool(
      'query_branches',
      {
        description: 'Return knowledge graph nodes and edges for vault notes.',
        inputSchema: {
          project: z
            .string()
            .optional()
            .describe('Target project ID or name (defaults to SSE session project or active project)'),
          folderFilter: z.string().optional().describe('Optional folder prefix to filter notes')
        }
      },
      async (args) => {
        const runtime = getRuntime(args.project)
        const graph = runtime.vault.getBranchGraph(args.folderFilter)
        this.emitActivity(
          'mcp-client',
          'query_branches',
          `${graph.nodes.length} nodes, ${graph.edges.length} edges`,
          runtime.project.name
        )
        return {
          content: [{ type: 'text', text: JSON.stringify(graph, null, 2) }]
        }
      }
    )

    server.registerTool(
      'log_work',
      {
        description:
          'Document a feature, bug fix, refactor, release, or architectural update in the project work logs.',
        inputSchema: {
          project: z
            .string()
            .optional()
            .describe('Target project ID or name (defaults to SSE session project or active project)'),
          harness: z.string().describe('AI harness name (e.g. antigravity, claude-code, codex)'),
          category: z.string().describe('Log category: feature, fix, refactor, release, or note'),
          version: z.string().optional().describe('Optional version string (e.g. 0.4.0)'),
          title: z.string().describe('Short summary of the change or update'),
          details: z.string().describe('Detailed explanation of what was implemented and why'),
          filesChanged: z
            .array(z.string())
            .optional()
            .default([])
            .describe('List of files created or modified')
        }
      },
      async (args) => {
        const runtime = getRuntime(args.project)
        const saved = await runtime.logs.saveLog({
          harness: args.harness,
          category: args.category,
          version: args.version,
          title: args.title,
          details: args.details,
          filesChanged: args.filesChanged ?? []
        })
        this.emitActivity(
          args.harness,
          'log_work',
          `${saved.category}: ${saved.title}`,
          runtime.project.name
        )
        return {
          content: [{ type: 'text', text: JSON.stringify(saved, null, 2) }]
        }
      }
    )

    server.registerTool(
      'get_logs',
      {
        description: 'Read recent documented work logs from the project vault.',
        inputSchema: {
          project: z
            .string()
            .optional()
            .describe('Target project ID or name (defaults to SSE session project or active project)'),
          harness: z.string().optional().describe('Filter by harness'),
          category: z.string().optional().describe('Filter by category'),
          query: z.string().optional().describe('Search text across title, details, and files'),
          limit: z.number().optional().describe('Maximum number of log entries to return')
        }
      },
      async (args) => {
        const runtime = getRuntime(args.project)
        const logs = await runtime.logs.getLogs({
          harness: args.harness,
          category: args.category,
          query: args.query,
          limit: args.limit ?? 50
        })
        this.emitActivity(
          'mcp-client',
          'get_logs',
          `Fetched ${logs.length} log entries`,
          runtime.project.name
        )
        return {
          content: [{ type: 'text', text: JSON.stringify(logs, null, 2) }]
        }
      }
    )

    server.registerResource(
      'global-rules',
      'crowbrain://rules/global',
      {
        description: 'Global rules applied across all AI sessions',
        mimeType: 'text/markdown'
      },
      async (uri) => {
        const runtime = getRuntime()
        const rules = await runtime.vault.getRules()
        this.emitActivity('mcp-client', 'read_resource', uri.href, runtime.project.name)
        return {
          contents: [{ uri: uri.href, mimeType: 'text/markdown', text: rules.globalRules }]
        }
      }
    )

    server.registerResource(
      'chat-rules',
      'crowbrain://rules/chat',
      {
        description: 'Chat rules for conversational behavior',
        mimeType: 'text/markdown'
      },
      async (uri) => {
        const runtime = getRuntime()
        const rules = await runtime.vault.getRules()
        this.emitActivity('mcp-client', 'read_resource', uri.href, runtime.project.name)
        return {
          contents: [{ uri: uri.href, mimeType: 'text/markdown', text: rules.chatRules }]
        }
      }
    )

    server.registerResource(
      'system-map',
      'crowbrain://system-map',
      {
        description: 'System map documenting codebase architecture and file locations',
        mimeType: 'text/markdown'
      },
      async (uri) => {
        const runtime = getRuntime()
        const content = await runtime.vault.getSystemMap()
        this.emitActivity('mcp-client', 'read_resource', uri.href, runtime.project.name)
        return {
          contents: [{ uri: uri.href, mimeType: 'text/markdown', text: content }]
        }
      }
    )

    return server
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

    if (req.method === 'OPTIONS') {
      res.writeHead(204)
      res.end()
      return
    }

    const url = new URL(req.url ?? '/', `http://127.0.0.1:${this.port}`)

    if (req.method === 'GET' && url.pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(
        JSON.stringify({
          status: 'ok',
          port: this.port,
          projects: this.listProjects().length
        })
      )
      return
    }

    if (req.method === 'GET' && url.pathname === '/sse') {
      const sessionProject = url.searchParams.get('project')?.trim() || undefined
      const transport = new SSEServerTransport('/messages', res)
      const mcpServer = this.createMcpInstance(sessionProject)
      const sessionId = transport.sessionId

      this.sessions.set(sessionId, { server: mcpServer, transport })

      transport.onclose = () => {
        this.sessions.delete(sessionId)
      }

      await mcpServer.connect(transport)
      this.emitActivity(
        'mcp-client',
        'connect',
        `SSE session ${sessionId} connected`,
        sessionProject
      )
      return
    }

    if (req.method === 'POST' && url.pathname === '/messages') {
      const sessionId = url.searchParams.get('sessionId') ?? ''
      const session = this.sessions.get(sessionId)
      if (!session) {
        res.writeHead(404, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Unknown or expired SSE session' }))
        return
      }
      await session.transport.handlePostMessage(req, res)
      return
    }

    res.writeHead(404, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'Not found' }))
  }

  async start(port: number): Promise<void> {
    if (this.running) {
      if (this.port === port) return
      await this.stop()
    }

    this.port = port
    const server = http.createServer((req, res) => {
      void this.handleRequest(req, res).catch((err) => {
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'application/json' })
          res.end(
            JSON.stringify({
              error: err instanceof Error ? err.message : 'Internal server error'
            })
          )
        }
      })
    })

    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(port, '127.0.0.1', () => {
        server.removeListener('error', reject)
        this.httpServer = server
        this.running = true
        resolve()
      })
    })
  }

  async stop(): Promise<void> {
    for (const [sessionId, session] of this.sessions.entries()) {
      try {
        await session.server.close()
      } catch {
        // Ignore close errors during shutdown
      }
      this.sessions.delete(sessionId)
    }

    if (this.httpServer) {
      const server = this.httpServer
      this.httpServer = null
      await new Promise<void>((resolve) => {
        server.close(() => resolve())
      })
    }

    this.running = false
  }
}

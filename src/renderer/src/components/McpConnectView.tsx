import { useEffect, useMemo, useState } from 'react'
import type { ReactElement } from 'react'
import { Activity, Check, Copy, RefreshCw } from 'lucide-react'
import type { AgentActivityEvent, ProjectEntry } from '@shared/types'
import { formatTimestamp } from './types'

interface McpConnectViewProps {
  mcpRunning: boolean
  mcpPort: number
  projects: ProjectEntry[]
  onRefreshStatus: () => Promise<void>
}

type ClientId = 'antigravity' | 'claude-code' | 'codex'

export function McpConnectView({
  mcpRunning,
  mcpPort,
  projects,
  onRefreshStatus
}: McpConnectViewProps): ReactElement {
  const [activeClient, setActiveClient] = useState<ClientId>('antigravity')
  const [targetProjectId, setTargetProjectId] = useState<string>('active')
  const [copiedKey, setCopiedKey] = useState<string | null>(null)
  const [activities, setActivities] = useState<AgentActivityEvent[]>([])

  useEffect(() => {
    if (targetProjectId !== 'active' && !projects.some((p) => p.id === targetProjectId)) {
      setTargetProjectId('active')
    }
  }, [projects, targetProjectId])

  const endpointUrl =
    targetProjectId === 'active'
      ? `http://127.0.0.1:${mcpPort}/sse`
      : `http://127.0.0.1:${mcpPort}/sse?project=${encodeURIComponent(targetProjectId)}`

  const snippets = useMemo<Record<ClientId, { label: string; description: string; code: string }>>(
    () => ({
      antigravity: {
        label: 'Antigravity',
        description: 'Add to your Antigravity MCP configuration (mcp_config.json):',
        code: JSON.stringify(
          {
            mcpServers: {
              crowbrain: {
                serverUrl: endpointUrl
              }
            }
          },
          null,
          2
        )
      },
      'claude-code': {
        label: 'Claude Code',
        description: 'Add to .mcp.json or ~/.claude.json under mcpServers:',
        code: JSON.stringify(
          {
            mcpServers: {
              crowbrain: {
                type: 'sse',
                url: endpointUrl
              }
            }
          },
          null,
          2
        )
      },
      codex: {
        label: 'Codex',
        description: 'Configure CrowBrain as an SSE MCP server in Codex settings:',
        code: JSON.stringify(
          {
            mcpServers: {
              crowbrain: {
                url: endpointUrl,
                transport: 'sse'
              }
            }
          },
          null,
          2
        )
      }
    }),
    [endpointUrl]
  )

  useEffect(() => {
    let mounted = true
    async function load(): Promise<void> {
      try {
        const recent = await window.crowbrain.getRecentActivity()
        if (mounted) setActivities(recent)
      } catch (err) {
        console.error('Failed to load activity:', err)
      }
    }
    void load()

    const unsubscribe = window.crowbrain.onActivity((event) => {
      setActivities((prev) => [event, ...prev].slice(0, 100))
    })

    return () => {
      mounted = false
      unsubscribe()
    }
  }, [])

  const copyText = async (key: string, text: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(text)
      setCopiedKey(key)
      setTimeout(() => {
        setCopiedKey((current) => (current === key ? null : current))
      }, 1800)
    } catch (err) {
      console.error('Clipboard copy failed:', err)
    }
  }

  const currentSnippet = snippets[activeClient]

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div
        className="px-5 py-3 flex items-center justify-between gap-3 shrink-0"
        style={{
          backgroundColor: 'var(--cb-surface)',
          borderBottom: '1px solid var(--cb-border)'
        }}
      >
        <div>
          <h1 className="text-sm font-semibold">MCP Connect</h1>
          <p className="text-xs" style={{ color: 'var(--cb-text-muted)' }}>
            Connect local AI harnesses to CrowBrain over Server-Sent Events (SSE).
          </p>
        </div>

        <button
          type="button"
          onClick={() => void onRefreshStatus()}
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs cb-transition cursor-pointer"
          style={{
            backgroundColor: 'var(--cb-surface-alt)',
            border: '1px solid var(--cb-border)',
            color: 'var(--cb-text)'
          }}
        >
          <RefreshCw size={13} />
          <span>Refresh Status</span>
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6 max-w-4xl">
        {/* Endpoint Card */}
        <section
          className="p-4 rounded-lg space-y-3"
          style={{
            backgroundColor: 'var(--cb-surface)',
            border: '1px solid var(--cb-border)'
          }}
        >
          <div className="flex items-center justify-between">
            <div className="text-xs font-semibold">Local MCP Endpoint</div>
            <div className="flex items-center gap-1.5 text-xs">
              <span
                className="w-2 h-2 rounded-full inline-block"
                style={{ backgroundColor: mcpRunning ? '#22c55e' : '#ef4444' }}
              />
              <span style={{ color: 'var(--cb-text-muted)' }}>
                {mcpRunning ? `Listening on port ${mcpPort}` : 'Server offline'}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <code
              className="flex-1 px-3 py-2 rounded text-xs font-mono select-all"
              style={{
                backgroundColor: 'var(--cb-surface-alt)',
                border: '1px solid var(--cb-border)',
                color: 'var(--cb-text)'
              }}
            >
              {endpointUrl}
            </code>
            <button
              type="button"
              onClick={() => void copyText('endpoint', endpointUrl)}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded text-xs font-medium cb-transition cursor-pointer"
              style={{
                backgroundColor: 'var(--cb-accent)',
                color: 'var(--cb-accent-text)'
              }}
            >
              {copiedKey === 'endpoint' ? <Check size={13} /> : <Copy size={13} />}
              <span>{copiedKey === 'endpoint' ? 'Copied' : 'Copy URL'}</span>
            </button>
          </div>
        </section>

        {/* Client Configuration Snippets */}
        <section
          className="p-4 rounded-lg space-y-3"
          style={{
            backgroundColor: 'var(--cb-surface)',
            border: '1px solid var(--cb-border)'
          }}
        >
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="text-xs font-semibold">Client Configuration</div>
            <div className="flex items-center gap-2 flex-wrap">
              <select
                value={targetProjectId}
                onChange={(e) => setTargetProjectId(e.target.value)}
                title="Target project for this MCP connection"
                className="px-2.5 py-1 rounded text-xs outline-none cursor-pointer"
                style={{
                  backgroundColor: 'var(--cb-bg)',
                  color: 'var(--cb-text)',
                  border: '1px solid var(--cb-border)'
                }}
              >
                <option value="active">Active Project (Dynamic)</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    Project: {p.name}
                  </option>
                ))}
              </select>
              <div
                className="flex items-center rounded p-0.5 text-xs"
                style={{
                  backgroundColor: 'var(--cb-surface-alt)',
                  border: '1px solid var(--cb-border)'
                }}
              >
                {(['antigravity', 'claude-code', 'codex'] as ClientId[]).map((client) => (
                  <button
                    key={client}
                    type="button"
                    onClick={() => setActiveClient(client)}
                    className="px-2.5 py-1 rounded cb-transition cursor-pointer"
                    style={{
                      backgroundColor:
                        activeClient === client ? 'var(--cb-surface)' : 'transparent',
                      color:
                        activeClient === client ? 'var(--cb-text)' : 'var(--cb-text-muted)'
                    }}
                  >
                    {snippets[client].label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <p className="text-xs" style={{ color: 'var(--cb-text-muted)' }}>
            {currentSnippet.description}
          </p>

          <div className="relative">
            <pre
              className="p-3.5 rounded text-xs font-mono overflow-x-auto"
              style={{
                backgroundColor: 'var(--cb-bg)',
                border: '1px solid var(--cb-border)',
                color: 'var(--cb-text)'
              }}
            >
              <code>{currentSnippet.code}</code>
            </pre>
            <button
              type="button"
              onClick={() => void copyText(activeClient, currentSnippet.code)}
              className="absolute top-2.5 right-2.5 inline-flex items-center gap-1 px-2.5 py-1 rounded text-[11px] font-medium cb-transition cursor-pointer"
              style={{
                backgroundColor: 'var(--cb-surface)',
                border: '1px solid var(--cb-border)',
                color: 'var(--cb-text)'
              }}
            >
              {copiedKey === activeClient ? <Check size={12} /> : <Copy size={12} />}
              <span>{copiedKey === activeClient ? 'Copied' : 'Copy JSON'}</span>
            </button>
          </div>
        </section>

        {/* Live Agent Activity */}
        <section
          className="p-4 rounded-lg space-y-3"
          style={{
            backgroundColor: 'var(--cb-surface)',
            border: '1px solid var(--cb-border)'
          }}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs font-semibold">
              <Activity size={14} style={{ color: 'var(--cb-accent)' }} />
              <span>Live Agent Activity</span>
            </div>
            <span className="text-[11px]" style={{ color: 'var(--cb-text-muted)' }}>
              {activities.length} events
            </span>
          </div>

          {activities.length === 0 ? (
            <div
              className="p-4 rounded text-xs text-center"
              style={{
                backgroundColor: 'var(--cb-surface-alt)',
                color: 'var(--cb-text-muted)'
              }}
            >
              No agent activity recorded yet.
            </div>
          ) : (
            <div className="space-y-1.5 max-h-72 overflow-y-auto">
              {activities.map((ev) => (
                <div
                  key={ev.id}
                  className="px-3 py-2 rounded text-xs flex items-start justify-between gap-3"
                  style={{
                    backgroundColor: 'var(--cb-surface-alt)',
                    border: '1px solid var(--cb-border)'
                  }}
                >
                  <div className="min-w-0 space-y-0.5">
                    <div className="flex items-center gap-2">
                      <span className="font-medium" style={{ color: 'var(--cb-accent)' }}>
                        {ev.harness}
                      </span>
                      <span className="font-mono text-[11px]">{ev.action}</span>
                      {ev.project && (
                        <span
                          className="px-1.5 py-0.5 rounded text-[10px]"
                          style={{
                            backgroundColor: 'var(--cb-surface)',
                            color: 'var(--cb-text-muted)',
                            border: '1px solid var(--cb-border)'
                          }}
                        >
                          {ev.project}
                        </span>
                      )}
                    </div>
                    {ev.detail && (
                      <div className="text-[11px] truncate" style={{ color: 'var(--cb-text-muted)' }}>
                        {ev.detail}
                      </div>
                    )}
                  </div>
                  <span
                    className="text-[11px] shrink-0"
                    style={{ color: 'var(--cb-text-muted)' }}
                  >
                    {formatTimestamp(ev.timestamp)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

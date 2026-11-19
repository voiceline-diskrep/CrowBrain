import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FormEvent, ReactElement } from 'react'
import { ChevronDown, ChevronUp, FileCode, Plus, RefreshCw, Search, Tag, X } from 'lucide-react'
import type { MessageBackup } from '@shared/types'
import { formatTimestamp } from './types'

interface BackupsViewProps {
  refreshSignal?: number
}

export function BackupsView({ refreshSignal = 0 }: BackupsViewProps): ReactElement {
  const [messages, setMessages] = useState<MessageBackup[]>([])
  const [knownHarnesses, setKnownHarnesses] = useState<string[]>([
    'antigravity',
    'claude-code',
    'codex'
  ])
  const [harnessFilter, setHarnessFilter] = useState<string>('')
  const [searchQuery, setSearchQuery] = useState<string>('')
  const [loading, setLoading] = useState<boolean>(true)
  const [expandedIds, setExpandedIds] = useState<Record<string, boolean>>({})

  // Quick Log Test Backup drawer/form
  const [showTestForm, setShowTestForm] = useState<boolean>(false)
  const [testHarness, setTestHarness] = useState<string>('antigravity')
  const [testSessionId, setTestSessionId] = useState<string>('manual-session-1')
  const [testRole, setTestRole] = useState<string>('assistant')
  const [testSummary, setTestSummary] = useState<string>('')
  const [testMessage, setTestMessage] = useState<string>('')
  const [testFiles, setTestFiles] = useState<string>('')
  const [testTags, setTestTags] = useState<string>('')
  const [submitting, setSubmitting] = useState<boolean>(false)

  const loadMessages = useCallback(async () => {
    setLoading(true)
    try {
      const data = await window.crowbrain.getMessages({
        harness: harnessFilter || undefined,
        query: searchQuery.trim() || undefined,
        limit: 200
      })
      setMessages(data)
      setKnownHarnesses((prev) => {
        const next = new Set(prev)
        for (const msg of data) {
          if (msg.harness) next.add(msg.harness)
        }
        return Array.from(next).sort()
      })
    } catch (err) {
      console.error('Failed to load backed-up messages:', err)
    } finally {
      setLoading(false)
    }
  }, [harnessFilter, searchQuery])

  useEffect(() => {
    void loadMessages()
  }, [loadMessages, refreshSignal])

  const harnesses = useMemo(() => knownHarnesses, [knownHarnesses])

  const toggleExpand = (id: string): void => {
    setExpandedIds((prev) => ({ ...prev, [id]: !prev[id] }))
  }

  const handleLogTestBackup = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    if (!testSummary.trim() && !testMessage.trim()) return
    setSubmitting(true)
    try {
      await window.crowbrain.saveMessage({
        harness: testHarness.trim() || 'manual',
        sessionId: testSessionId.trim() || 'manual-session',
        role: testRole,
        message: testMessage.trim() || testSummary.trim(),
        summaryForFutureSelf: testSummary.trim() || testMessage.trim(),
        relatedFiles: testFiles
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
        tags: testTags
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      })
      setTestSummary('')
      setTestMessage('')
      setTestFiles('')
      setTestTags('')
      setShowTestForm(false)
      await loadMessages()
    } catch (err) {
      console.error('Failed to save test backup:', err)
    } finally {
      setSubmitting(false)
    }
  }

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
          <h1 className="text-sm font-semibold">Message Backups</h1>
          <p className="text-xs" style={{ color: 'var(--cb-text-muted)' }}>
            Chronological log of agent messages and future-self summaries.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void loadMessages()}
            className="p-1.5 rounded cb-transition cursor-pointer"
            title="Refresh"
            style={{
              backgroundColor: 'var(--cb-surface-alt)',
              border: '1px solid var(--cb-border)',
              color: 'var(--cb-text)'
            }}
          >
            <RefreshCw size={14} />
          </button>

          <button
            type="button"
            onClick={() => setShowTestForm((prev) => !prev)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium cb-transition cursor-pointer"
            style={{
              backgroundColor: 'var(--cb-accent)',
              color: 'var(--cb-accent-text)'
            }}
          >
            {showTestForm ? <X size={14} /> : <Plus size={14} />}
            <span>Log Test Backup</span>
          </button>
        </div>
      </div>

      {/* Filters */}
      <div
        className="px-5 py-2.5 flex flex-wrap items-center gap-3 shrink-0"
        style={{
          backgroundColor: 'var(--cb-surface)',
          borderBottom: '1px solid var(--cb-border)'
        }}
      >
        <div className="relative flex-1 min-w-[220px]">
          <Search
            size={14}
            className="absolute left-2.5 top-1/2 -translate-y-1/2"
            style={{ color: 'var(--cb-text-muted)' }}
          />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search summaries, messages, files, or tags..."
            className="w-full pl-8 pr-3 py-1.5 rounded text-xs outline-none"
            style={{
              backgroundColor: 'var(--cb-surface-alt)',
              border: '1px solid var(--cb-border)',
              color: 'var(--cb-text)'
            }}
          />
        </div>

        <select
          value={harnessFilter}
          onChange={(e) => setHarnessFilter(e.target.value)}
          className="px-2.5 py-1.5 rounded text-xs outline-none"
          style={{
            backgroundColor: 'var(--cb-surface-alt)',
            border: '1px solid var(--cb-border)',
            color: 'var(--cb-text)'
          }}
        >
          <option value="">All harnesses</option>
          {harnesses.map((h) => (
            <option key={h} value={h}>
              {h}
            </option>
          ))}
        </select>
      </div>

      {/* Quick Log Test Backup Drawer */}
      {showTestForm && (
        <form
          onSubmit={(e) => void handleLogTestBackup(e)}
          className="px-5 py-4 space-y-3 shrink-0 cb-view-enter"
          style={{
            backgroundColor: 'var(--cb-surface-alt)',
            borderBottom: '1px solid var(--cb-border)'
          }}
        >
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-[11px] mb-1" style={{ color: 'var(--cb-text-muted)' }}>
                Harness
              </label>
              <input
                type="text"
                value={testHarness}
                onChange={(e) => setTestHarness(e.target.value)}
                className="w-full px-2.5 py-1.5 rounded text-xs outline-none"
                style={{
                  backgroundColor: 'var(--cb-surface)',
                  border: '1px solid var(--cb-border)',
                  color: 'var(--cb-text)'
                }}
              />
            </div>
            <div>
              <label className="block text-[11px] mb-1" style={{ color: 'var(--cb-text-muted)' }}>
                Session ID
              </label>
              <input
                type="text"
                value={testSessionId}
                onChange={(e) => setTestSessionId(e.target.value)}
                className="w-full px-2.5 py-1.5 rounded text-xs outline-none"
                style={{
                  backgroundColor: 'var(--cb-surface)',
                  border: '1px solid var(--cb-border)',
                  color: 'var(--cb-text)'
                }}
              />
            </div>
            <div>
              <label className="block text-[11px] mb-1" style={{ color: 'var(--cb-text-muted)' }}>
                Role
              </label>
              <select
                value={testRole}
                onChange={(e) => setTestRole(e.target.value)}
                className="w-full px-2.5 py-1.5 rounded text-xs outline-none"
                style={{
                  backgroundColor: 'var(--cb-surface)',
                  border: '1px solid var(--cb-border)',
                  color: 'var(--cb-text)'
                }}
              >
                <option value="assistant">assistant</option>
                <option value="user">user</option>
                <option value="system">system</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-[11px] mb-1" style={{ color: 'var(--cb-text-muted)' }}>
              Summary for Future Self
            </label>
            <textarea
              rows={2}
              value={testSummary}
              onChange={(e) => setTestSummary(e.target.value)}
              placeholder="Concise summary of decisions, constraints, and next steps..."
              className="w-full px-2.5 py-1.5 rounded text-xs outline-none resize-y"
              style={{
                backgroundColor: 'var(--cb-surface)',
                border: '1px solid var(--cb-border)',
                color: 'var(--cb-text)'
              }}
            />
          </div>

          <div>
            <label className="block text-[11px] mb-1" style={{ color: 'var(--cb-text-muted)' }}>
              Full Message
            </label>
            <textarea
              rows={2}
              value={testMessage}
              onChange={(e) => setTestMessage(e.target.value)}
              placeholder="Raw message payload..."
              className="w-full px-2.5 py-1.5 rounded text-xs outline-none resize-y"
              style={{
                backgroundColor: 'var(--cb-surface)',
                border: '1px solid var(--cb-border)',
                color: 'var(--cb-text)'
              }}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] mb-1" style={{ color: 'var(--cb-text-muted)' }}>
                Related Files (comma-separated)
              </label>
              <input
                type="text"
                value={testFiles}
                onChange={(e) => setTestFiles(e.target.value)}
                placeholder="src/main/index.ts, src/shared/types.ts"
                className="w-full px-2.5 py-1.5 rounded text-xs outline-none"
                style={{
                  backgroundColor: 'var(--cb-surface)',
                  border: '1px solid var(--cb-border)',
                  color: 'var(--cb-text)'
                }}
              />
            </div>
            <div>
              <label className="block text-[11px] mb-1" style={{ color: 'var(--cb-text-muted)' }}>
                Tags (comma-separated)
              </label>
              <input
                type="text"
                value={testTags}
                onChange={(e) => setTestTags(e.target.value)}
                placeholder="ipc, vault, test"
                className="w-full px-2.5 py-1.5 rounded text-xs outline-none"
                style={{
                  backgroundColor: 'var(--cb-surface)',
                  border: '1px solid var(--cb-border)',
                  color: 'var(--cb-text)'
                }}
              />
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowTestForm(false)}
              className="px-3 py-1.5 rounded text-xs cursor-pointer"
              style={{
                backgroundColor: 'var(--cb-surface)',
                border: '1px solid var(--cb-border)',
                color: 'var(--cb-text)'
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || (!testSummary.trim() && !testMessage.trim())}
              className="px-3 py-1.5 rounded text-xs font-medium cursor-pointer disabled:opacity-50"
              style={{
                backgroundColor: 'var(--cb-accent)',
                color: 'var(--cb-accent-text)'
              }}
            >
              {submitting ? 'Saving...' : 'Save Backup'}
            </button>
          </div>
        </form>
      )}

      {/* Messages List */}
      <div className="flex-1 overflow-y-auto p-5 space-y-3">
        {loading ? (
          <div className="text-xs" style={{ color: 'var(--cb-text-muted)' }}>
            Loading backups...
          </div>
        ) : messages.length === 0 ? (
          <div
            className="p-8 rounded-lg text-center text-xs"
            style={{
              backgroundColor: 'var(--cb-surface)',
              border: '1px solid var(--cb-border)',
              color: 'var(--cb-text-muted)'
            }}
          >
            No backed-up messages match the current filters.
          </div>
        ) : (
          messages.map((msg) => {
            const isExpanded = Boolean(expandedIds[msg.id])
            return (
              <div
                key={msg.id}
                className="rounded-lg p-4 space-y-2.5 cb-transition"
                style={{
                  backgroundColor: 'var(--cb-surface)',
                  border: '1px solid var(--cb-border)'
                }}
              >
                {/* Meta row */}
                <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
                  <div className="flex items-center gap-2">
                    <span
                      className="px-2 py-0.5 rounded font-medium"
                      style={{
                        backgroundColor: 'var(--cb-surface-alt)',
                        color: 'var(--cb-accent)',
                        border: '1px solid var(--cb-border)'
                      }}
                    >
                      {msg.harness}
                    </span>
                    <span
                      className="px-2 py-0.5 rounded"
                      style={{
                        backgroundColor: 'var(--cb-surface-alt)',
                        color: 'var(--cb-text)'
                      }}
                    >
                      {msg.role}
                    </span>
                    <span style={{ color: 'var(--cb-text-muted)' }}>
                      Session: {msg.sessionId}
                    </span>
                  </div>
                  <span style={{ color: 'var(--cb-text-muted)' }}>
                    {formatTimestamp(msg.timestamp)}
                  </span>
                </div>

                {/* Prominent Summary for Future Self */}
                <div
                  className="p-3 rounded-md text-xs leading-relaxed"
                  style={{
                    backgroundColor: 'var(--cb-surface-alt)',
                    borderLeft: '3px solid var(--cb-accent)'
                  }}
                >
                  <div
                    className="text-[10px] font-semibold uppercase tracking-wider mb-1"
                    style={{ color: 'var(--cb-text-muted)' }}
                  >
                    Summary for Future Self
                  </div>
                  <div className="whitespace-pre-wrap">{msg.summaryForFutureSelf}</div>
                </div>

                {/* Related Files & Tags */}
                {(msg.relatedFiles.length > 0 || msg.tags.length > 0) && (
                  <div className="flex flex-wrap items-center gap-2 text-[11px]">
                    {msg.relatedFiles.map((file) => (
                      <span
                        key={file}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded font-mono"
                        style={{
                          backgroundColor: 'var(--cb-bg)',
                          border: '1px solid var(--cb-border)',
                          color: 'var(--cb-text-muted)'
                        }}
                      >
                        <FileCode size={11} />
                        <span>{file}</span>
                      </span>
                    ))}
                    {msg.tags.map((tag) => (
                      <span
                        key={tag}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded"
                        style={{
                          backgroundColor: 'var(--cb-bg)',
                          border: '1px solid var(--cb-border)',
                          color: 'var(--cb-text-muted)'
                        }}
                      >
                        <Tag size={11} />
                        <span>{tag}</span>
                      </span>
                    ))}
                  </div>
                )}

                {/* Expandable raw message */}
                <div>
                  <button
                    type="button"
                    onClick={() => toggleExpand(msg.id)}
                    className="inline-flex items-center gap-1 text-[11px] font-medium cursor-pointer"
                    style={{ color: 'var(--cb-text-muted)' }}
                  >
                    {isExpanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                    <span>{isExpanded ? 'Hide raw message' : 'Show raw message'}</span>
                  </button>

                  {isExpanded && (
                    <pre
                      className="mt-2 p-3 rounded text-xs font-mono whitespace-pre-wrap overflow-x-auto"
                      style={{
                        backgroundColor: 'var(--cb-bg)',
                        border: '1px solid var(--cb-border)',
                        color: 'var(--cb-text)'
                      }}
                    >
                      {msg.message}
                    </pre>
                  )}
                </div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}

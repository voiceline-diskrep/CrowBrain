import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactElement } from 'react'
import { ClipboardList, FileCode2, Plus, RefreshCw, Search, X } from 'lucide-react'
import type { WorkLogEntry } from '@shared/types'
import { formatTimestamp } from './types'

const CATEGORIES = ['all', 'feature', 'fix', 'refactor', 'release', 'note'] as const

interface LogsViewProps {
  refreshSignal?: number
}

export function LogsView({ refreshSignal = 0 }: LogsViewProps): ReactElement {
  const [logs, setLogs] = useState<WorkLogEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [query, setQuery] = useState('')
  const [categoryFilter, setCategoryFilter] = useState<string>('all')
  const [harnessFilter, setHarnessFilter] = useState<string>('all')
  const [showCreateForm, setShowCreateForm] = useState(false)

  const [newHarness, setNewHarness] = useState('manual')
  const [newCategory, setNewCategory] = useState('feature')
  const [newVersion, setNewVersion] = useState('')
  const [newTitle, setNewTitle] = useState('')
  const [newDetails, setNewDetails] = useState('')
  const [newFiles, setNewFiles] = useState('')

  const loadLogs = useCallback(async () => {
    setLoading(true)
    try {
      const entries = await window.crowbrain.getLogs({ limit: 200 })
      setLogs(entries)
    } catch (err) {
      console.error('Failed to load work logs:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadLogs()
  }, [loadLogs, refreshSignal])

  const harnesses = useMemo(() => {
    const set = new Set<string>()
    for (const item of logs) {
      if (item.harness) set.add(item.harness)
    }
    return ['all', ...Array.from(set).sort()]
  }, [logs])

  const filteredLogs = useMemo(() => {
    const q = query.trim().toLowerCase()
    return logs.filter((item) => {
      if (categoryFilter !== 'all' && item.category.toLowerCase() !== categoryFilter) {
        return false
      }
      if (harnessFilter !== 'all' && item.harness !== harnessFilter) {
        return false
      }
      if (!q) return true
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
      return haystack.includes(q)
    })
  }, [logs, query, categoryFilter, harnessFilter])

  const handleCreate = async (): Promise<void> => {
    if (!newTitle.trim() || !newDetails.trim()) return
    try {
      await window.crowbrain.createLog({
        harness: newHarness.trim() || 'manual',
        category: newCategory.trim() || 'note',
        ...(newVersion.trim() ? { version: newVersion.trim() } : {}),
        title: newTitle.trim(),
        details: newDetails.trim(),
        filesChanged: newFiles
          .split(',')
          .map((f) => f.trim())
          .filter(Boolean)
      })
      setNewTitle('')
      setNewDetails('')
      setNewVersion('')
      setNewFiles('')
      setShowCreateForm(false)
      await loadLogs()
    } catch (err) {
      console.error('Failed to save work log:', err)
    }
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div
        className="px-6 py-4 flex items-center justify-between gap-4 shrink-0"
        style={{
          backgroundColor: 'var(--cb-surface)',
          borderBottom: '1px solid var(--cb-border)'
        }}
      >
        <div className="min-w-0">
          <h1 className="text-base font-semibold tracking-tight flex items-center gap-2">
            <ClipboardList size={17} />
            <span>Work Logs</span>
          </h1>
          <p className="text-xs mt-0.5" style={{ color: 'var(--cb-text-muted)' }}>
            Chronological record of AI updates, changes, and releases for this project.
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => void loadLogs()}
            className="px-3 py-1.5 rounded-md text-xs font-medium flex items-center gap-1.5 cb-transition cursor-pointer"
            style={{
              backgroundColor: 'var(--cb-surface-alt)',
              color: 'var(--cb-text)',
              border: '1px solid var(--cb-border)'
            }}
          >
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
            <span>Refresh</span>
          </button>

          <button
            type="button"
            onClick={() => setShowCreateForm((prev) => !prev)}
            className="px-3 py-1.5 rounded-md text-xs font-medium flex items-center gap-1.5 cb-transition cursor-pointer"
            style={{
              backgroundColor: 'var(--cb-accent)',
              color: 'var(--cb-accent-text)'
            }}
          >
            {showCreateForm ? <X size={13} /> : <Plus size={13} />}
            <span>{showCreateForm ? 'Close' : 'Add Log'}</span>
          </button>
        </div>
      </div>

      {/* Filters */}
      <div
        className="px-6 py-3 flex flex-wrap items-center gap-3 shrink-0"
        style={{
          backgroundColor: 'var(--cb-surface)',
          borderBottom: '1px solid var(--cb-border)'
        }}
      >
        <div className="relative flex-1 min-w-[200px]">
          <Search
            size={14}
            className="absolute left-2.5 top-1/2 -translate-y-1/2"
            style={{ color: 'var(--cb-text-muted)' }}
          />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search logs, versions, or file paths..."
            className="w-full pl-8 pr-3 py-1.5 rounded-md text-xs outline-none"
            style={{
              backgroundColor: 'var(--cb-bg)',
              color: 'var(--cb-text)',
              border: '1px solid var(--cb-border)'
            }}
          />
        </div>

        <div className="flex items-center gap-1">
          {CATEGORIES.map((cat) => {
            const active = categoryFilter === cat
            return (
              <button
                key={cat}
                type="button"
                onClick={() => setCategoryFilter(cat)}
                className="px-2.5 py-1 rounded text-xs capitalize cb-transition cursor-pointer"
                style={{
                  backgroundColor: active ? 'var(--cb-accent)' : 'var(--cb-surface-alt)',
                  color: active ? 'var(--cb-accent-text)' : 'var(--cb-text-muted)',
                  border: '1px solid var(--cb-border)'
                }}
              >
                {cat}
              </button>
            )
          })}
        </div>

        <select
          value={harnessFilter}
          onChange={(e) => setHarnessFilter(e.target.value)}
          className="px-2.5 py-1.5 rounded-md text-xs outline-none cursor-pointer"
          style={{
            backgroundColor: 'var(--cb-bg)',
            color: 'var(--cb-text)',
            border: '1px solid var(--cb-border)'
          }}
        >
          {harnesses.map((h) => (
            <option key={h} value={h}>
              {h === 'all' ? 'All harnesses' : h}
            </option>
          ))}
        </select>
      </div>

      {/* Create Form */}
      {showCreateForm && (
        <div
          className="px-6 py-4 cb-modal-enter shrink-0"
          style={{
            backgroundColor: 'var(--cb-surface-alt)',
            borderBottom: '1px solid var(--cb-border)'
          }}
        >
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
            <input
              type="text"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder="Title (e.g. Added Logs section)"
              className="md:col-span-2 px-3 py-1.5 rounded-md text-xs outline-none"
              style={{
                backgroundColor: 'var(--cb-bg)',
                color: 'var(--cb-text)',
                border: '1px solid var(--cb-border)'
              }}
            />
            <div className="flex gap-2">
              <select
                value={newCategory}
                onChange={(e) => setNewCategory(e.target.value)}
                className="flex-1 px-2.5 py-1.5 rounded-md text-xs outline-none"
                style={{
                  backgroundColor: 'var(--cb-bg)',
                  color: 'var(--cb-text)',
                  border: '1px solid var(--cb-border)'
                }}
              >
                <option value="feature">feature</option>
                <option value="fix">fix</option>
                <option value="refactor">refactor</option>
                <option value="release">release</option>
                <option value="note">note</option>
              </select>
              <input
                type="text"
                value={newVersion}
                onChange={(e) => setNewVersion(e.target.value)}
                placeholder="Version (opt)"
                className="w-24 px-2.5 py-1.5 rounded-md text-xs outline-none"
                style={{
                  backgroundColor: 'var(--cb-bg)',
                  color: 'var(--cb-text)',
                  border: '1px solid var(--cb-border)'
                }}
              />
            </div>
          </div>

          <textarea
            value={newDetails}
            onChange={(e) => setNewDetails(e.target.value)}
            placeholder="Detailed description of changes..."
            rows={3}
            className="w-full px-3 py-2 rounded-md text-xs outline-none mb-3 resize-y"
            style={{
              backgroundColor: 'var(--cb-bg)',
              color: 'var(--cb-text)',
              border: '1px solid var(--cb-border)'
            }}
          />

          <div className="flex flex-wrap items-center gap-3">
            <input
              type="text"
              value={newHarness}
              onChange={(e) => setNewHarness(e.target.value)}
              placeholder="Harness"
              className="w-36 px-3 py-1.5 rounded-md text-xs outline-none"
              style={{
                backgroundColor: 'var(--cb-bg)',
                color: 'var(--cb-text)',
                border: '1px solid var(--cb-border)'
              }}
            />
            <input
              type="text"
              value={newFiles}
              onChange={(e) => setNewFiles(e.target.value)}
              placeholder="Files changed (comma-separated)"
              className="flex-1 min-w-[200px] px-3 py-1.5 rounded-md text-xs outline-none"
              style={{
                backgroundColor: 'var(--cb-bg)',
                color: 'var(--cb-text)',
                border: '1px solid var(--cb-border)'
              }}
            />
            <button
              type="button"
              onClick={() => void handleCreate()}
              className="px-4 py-1.5 rounded-md text-xs font-medium cursor-pointer cb-transition"
              style={{
                backgroundColor: 'var(--cb-accent)',
                color: 'var(--cb-accent-text)'
              }}
            >
              Save Log
            </button>
          </div>
        </div>
      )}

      {/* List */}
      <div className="flex-1 overflow-y-auto p-6 space-y-3">
        {filteredLogs.length === 0 ? (
          <div
            className="rounded-lg p-8 text-center text-xs"
            style={{
              backgroundColor: 'var(--cb-surface)',
              border: '1px solid var(--cb-border)',
              color: 'var(--cb-text-muted)'
            }}
          >
            No work logs recorded yet. Connected AI agents can document updates via the{' '}
            <code className="px-1 py-0.5 rounded" style={{ backgroundColor: 'var(--cb-surface-alt)' }}>
              log_work
            </code>{' '}
            MCP tool.
          </div>
        ) : (
          filteredLogs.map((entry) => (
            <div
              key={entry.id}
              className="rounded-lg p-4 cb-transition"
              style={{
                backgroundColor: 'var(--cb-surface)',
                border: '1px solid var(--cb-border)'
              }}
            >
              <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    className="px-2 py-0.5 rounded text-[11px] font-medium uppercase tracking-wide"
                    style={{
                      backgroundColor: 'var(--cb-surface-alt)',
                      color: 'var(--cb-text)',
                      border: '1px solid var(--cb-border)'
                    }}
                  >
                    {entry.category}
                  </span>
                  {entry.version && (
                    <span
                      className="px-2 py-0.5 rounded text-[11px] font-mono"
                      style={{
                        backgroundColor: 'var(--cb-bg)',
                        color: 'var(--cb-text-muted)',
                        border: '1px solid var(--cb-border)'
                      }}
                    >
                      v{entry.version}
                    </span>
                  )}
                  <h2 className="text-sm font-semibold truncate">{entry.title}</h2>
                </div>

                <div
                  className="text-[11px] flex items-center gap-2 shrink-0"
                  style={{ color: 'var(--cb-text-muted)' }}
                >
                  <span>{entry.harness}</span>
                  <span>|</span>
                  <span>{formatTimestamp(entry.timestamp)}</span>
                </div>
              </div>

              <p
                className="text-xs leading-relaxed whitespace-pre-wrap"
                style={{ color: 'var(--cb-text)' }}
              >
                {entry.details}
              </p>

              {entry.filesChanged && entry.filesChanged.length > 0 && (
                <div className="mt-3 flex flex-wrap items-center gap-1.5">
                  <FileCode2 size={12} style={{ color: 'var(--cb-text-muted)' }} />
                  {entry.filesChanged.map((filePath) => (
                    <span
                      key={filePath}
                      className="px-2 py-0.5 rounded text-[11px] font-mono"
                      style={{
                        backgroundColor: 'var(--cb-surface-alt)',
                        color: 'var(--cb-text-muted)'
                      }}
                    >
                      {filePath}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  )
}

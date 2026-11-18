import { useCallback, useEffect, useState } from 'react'
import type { ReactElement } from 'react'
import { Eye, Pencil, RefreshCw, Save } from 'lucide-react'
import { MarkdownPreview } from './MarkdownPreview'

interface SystemMapViewProps {
  onRefreshNotes: () => Promise<void>
}

export function SystemMapView({ onRefreshNotes }: SystemMapViewProps): ReactElement {
  const [content, setContent] = useState('')
  const [savedContent, setSavedContent] = useState('')
  const [mode, setMode] = useState<'edit' | 'preview'>('preview')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState<string | null>(null)

  const loadSystemMap = useCallback(async () => {
    setLoading(true)
    setStatus(null)
    try {
      const data = await window.crowbrain.getSystemMap()
      setContent(data)
      setSavedContent(data)
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Failed to load system-map.md')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadSystemMap()
  }, [loadSystemMap])

  const handleSave = async (): Promise<void> => {
    setSaving(true)
    setStatus(null)
    try {
      const updated = await window.crowbrain.updateSystemMap(content)
      setContent(updated)
      setSavedContent(updated)
      setStatus('Saved')
      await onRefreshNotes()
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Failed to save system-map.md')
    } finally {
      setSaving(false)
    }
  }

  const isDirty = content !== savedContent

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
          <h1 className="text-sm font-semibold">System Map</h1>
          <p className="text-xs" style={{ color: 'var(--cb-text-muted)' }}>
            Shared reference file (system-map.md) documenting where features and files live.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {status && (
            <span className="text-xs" style={{ color: 'var(--cb-text-muted)' }}>
              {status}
            </span>
          )}

          <div
            className="flex items-center rounded p-0.5 text-xs"
            style={{
              backgroundColor: 'var(--cb-surface-alt)',
              border: '1px solid var(--cb-border)'
            }}
          >
            <button
              type="button"
              onClick={() => setMode('edit')}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded cb-transition cursor-pointer"
              style={{
                backgroundColor: mode === 'edit' ? 'var(--cb-surface)' : 'transparent',
                color: mode === 'edit' ? 'var(--cb-text)' : 'var(--cb-text-muted)'
              }}
            >
              <Pencil size={12} />
              <span>Edit</span>
            </button>
            <button
              type="button"
              onClick={() => setMode('preview')}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded cb-transition cursor-pointer"
              style={{
                backgroundColor: mode === 'preview' ? 'var(--cb-surface)' : 'transparent',
                color: mode === 'preview' ? 'var(--cb-text)' : 'var(--cb-text-muted)'
              }}
            >
              <Eye size={12} />
              <span>Preview</span>
            </button>
          </div>

          <button
            type="button"
            onClick={() => void loadSystemMap()}
            title="Reload"
            className="p-1.5 rounded cb-transition cursor-pointer"
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
            disabled={saving || !isDirty}
            onClick={() => void handleSave()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium cb-transition cursor-pointer disabled:opacity-50"
            style={{
              backgroundColor: 'var(--cb-accent)',
              color: 'var(--cb-accent-text)'
            }}
          >
            <Save size={13} />
            <span>{saving ? 'Saving...' : 'Save'}</span>
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 min-h-0 overflow-y-auto p-6">
        {loading ? (
          <div className="text-xs" style={{ color: 'var(--cb-text-muted)' }}>
            Loading system-map.md...
          </div>
        ) : mode === 'edit' ? (
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="# System Map&#10;&#10;Document repository modules, entry points, and architecture here."
            className="w-full h-full min-h-[420px] p-4 rounded-lg resize-none outline-none text-sm font-mono leading-relaxed"
            style={{
              backgroundColor: 'var(--cb-surface)',
              border: '1px solid var(--cb-border)',
              color: 'var(--cb-text)'
            }}
          />
        ) : (
          <div
            className="max-w-3xl p-6 rounded-lg"
            style={{
              backgroundColor: 'var(--cb-surface)',
              border: '1px solid var(--cb-border)'
            }}
          >
            <MarkdownPreview content={content} />
          </div>
        )}
      </div>
    </div>
  )
}

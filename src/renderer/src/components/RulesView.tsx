import { useCallback, useEffect, useState } from 'react'
import type { ReactElement } from 'react'
import { FilePlus, Save } from 'lucide-react'
import type { RulesData } from '@shared/types'

interface RulesViewProps {
  onRefreshNotes: () => Promise<void>
}

type RulesSubTab = 'global' | 'chat' | 'context'

export function RulesView({ onRefreshNotes }: RulesViewProps): ReactElement {
  const [subTab, setSubTab] = useState<RulesSubTab>('global')
  const [rules, setRules] = useState<RulesData>({
    globalRules: '',
    chatRules: '',
    contextNotes: []
  })
  const [globalDraft, setGlobalDraft] = useState('')
  const [chatDraft, setChatDraft] = useState('')
  const [selectedContextName, setSelectedContextName] = useState<string | null>(null)
  const [contextDraft, setContextDraft] = useState('')
  const [newContextName, setNewContextName] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState<string | null>(null)

  const loadRules = useCallback(async () => {
    setLoading(true)
    try {
      const data = await window.crowbrain.getRules()
      setRules(data)
      setGlobalDraft(data.globalRules)
      setChatDraft(data.chatRules)
      if (data.contextNotes.length > 0) {
        setSelectedContextName((prev) => {
          const current = data.contextNotes.find((c) => c.name === prev) ?? data.contextNotes[0]
          setContextDraft(current.content)
          return current.name
        })
      } else {
        setSelectedContextName(null)
        setContextDraft('')
      }
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Failed to load rules')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadRules()
  }, [loadRules])

  const handleSelectContext = (name: string): void => {
    const found = rules.contextNotes.find((c) => c.name === name)
    setSelectedContextName(name)
    setContextDraft(found?.content ?? '')
    setStatus(null)
  }

  const handleSave = async (): Promise<void> => {
    setSaving(true)
    setStatus(null)
    try {
      let updated: RulesData
      if (subTab === 'global') {
        updated = await window.crowbrain.saveRules('global', globalDraft)
      } else if (subTab === 'chat') {
        updated = await window.crowbrain.saveRules('chat', chatDraft)
      } else {
        if (!selectedContextName) {
          setSaving(false)
          return
        }
        updated = await window.crowbrain.saveRules('context', contextDraft, selectedContextName)
      }
      setRules(updated)
      setStatus('Saved')
      await onRefreshNotes()
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Failed to save rules')
    } finally {
      setSaving(false)
    }
  }

  const handleCreateContext = async (): Promise<void> => {
    const cleanName = newContextName
      .trim()
      .replace(/\.md$/i, '')
      .replace(/[^a-zA-Z0-9_-]+/g, '-')
    if (!cleanName) return
    setSaving(true)
    setStatus(null)
    try {
      const initialContent = `# ${cleanName}\n\n`
      const updated = await window.crowbrain.saveRules('context', initialContent, cleanName)
      setRules(updated)
      setSelectedContextName(cleanName)
      setContextDraft(initialContent)
      setNewContextName('')
      setStatus('Created')
      await onRefreshNotes()
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Failed to create context note')
    } finally {
      setSaving(false)
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
          <h1 className="text-sm font-semibold">Rules</h1>
          <p className="text-xs" style={{ color: 'var(--cb-text-muted)' }}>
            Manage instructions and context notes shared with connected AI harnesses.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {status && (
            <span className="text-xs" style={{ color: 'var(--cb-text-muted)' }}>
              {status}
            </span>
          )}
          <button
            type="button"
            disabled={saving || (subTab === 'context' && !selectedContextName)}
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

      {/* Sub-tabs */}
      <div
        className="px-5 py-2 flex items-center gap-2 shrink-0"
        style={{
          backgroundColor: 'var(--cb-surface)',
          borderBottom: '1px solid var(--cb-border)'
        }}
      >
        {(
          [
            { id: 'global', label: 'Global Rules' },
            { id: 'chat', label: 'Chat Rules' },
            { id: 'context', label: 'Context Notes' }
          ] as Array<{ id: RulesSubTab; label: string }>
        ).map((tab) => {
          const active = subTab === tab.id
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => {
                setSubTab(tab.id)
                setStatus(null)
              }}
              className="px-3 py-1.5 rounded text-xs font-medium cb-transition cursor-pointer"
              style={{
                backgroundColor: active ? 'var(--cb-surface-alt)' : 'transparent',
                color: active ? 'var(--cb-text)' : 'var(--cb-text-muted)',
                border: active ? '1px solid var(--cb-border)' : '1px solid transparent'
              }}
            >
              {tab.label}
            </button>
          )
        })}
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 flex">
        {loading ? (
          <div className="p-6 text-xs" style={{ color: 'var(--cb-text-muted)' }}>
            Loading rules...
          </div>
        ) : subTab === 'global' ? (
          <div className="flex-1 p-5 flex flex-col">
            <div className="text-xs mb-2" style={{ color: 'var(--cb-text-muted)' }}>
              File: rules/global-rules.md
            </div>
            <textarea
              value={globalDraft}
              onChange={(e) => setGlobalDraft(e.target.value)}
              placeholder="Write global instructions applied across all workspaces and sessions..."
              className="flex-1 w-full p-4 rounded-lg resize-none outline-none text-sm font-mono leading-relaxed"
              style={{
                backgroundColor: 'var(--cb-surface)',
                border: '1px solid var(--cb-border)',
                color: 'var(--cb-text)'
              }}
            />
          </div>
        ) : subTab === 'chat' ? (
          <div className="flex-1 p-5 flex flex-col">
            <div className="text-xs mb-2" style={{ color: 'var(--cb-text-muted)' }}>
              File: rules/chat-rules.md
            </div>
            <textarea
              value={chatDraft}
              onChange={(e) => setChatDraft(e.target.value)}
              placeholder="Write conversational rules and response formatting preferences..."
              className="flex-1 w-full p-4 rounded-lg resize-none outline-none text-sm font-mono leading-relaxed"
              style={{
                backgroundColor: 'var(--cb-surface)',
                border: '1px solid var(--cb-border)',
                color: 'var(--cb-text)'
              }}
            />
          </div>
        ) : (
          <div className="flex-1 min-h-0 flex">
            {/* Context Notes List */}
            <div
              className="w-64 shrink-0 p-3 flex flex-col gap-3"
              style={{
                backgroundColor: 'var(--cb-surface)',
                borderRight: '1px solid var(--cb-border)'
              }}
            >
              <div className="flex items-center gap-1.5">
                <input
                  type="text"
                  value={newContextName}
                  onChange={(e) => setNewContextName(e.target.value)}
                  placeholder="new-context-name"
                  className="flex-1 min-w-0 px-2.5 py-1.5 rounded text-xs outline-none"
                  style={{
                    backgroundColor: 'var(--cb-surface-alt)',
                    border: '1px solid var(--cb-border)',
                    color: 'var(--cb-text)'
                  }}
                />
                <button
                  type="button"
                  disabled={!newContextName.trim() || saving}
                  onClick={() => void handleCreateContext()}
                  title="Create context note"
                  className="p-1.5 rounded cb-transition cursor-pointer disabled:opacity-50"
                  style={{
                    backgroundColor: 'var(--cb-accent)',
                    color: 'var(--cb-accent-text)'
                  }}
                >
                  <FilePlus size={14} />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto space-y-1">
                {rules.contextNotes.length === 0 ? (
                  <div className="text-xs px-1" style={{ color: 'var(--cb-text-muted)' }}>
                    No context notes yet.
                  </div>
                ) : (
                  rules.contextNotes.map((note) => {
                    const active = note.name === selectedContextName
                    return (
                      <button
                        key={note.name}
                        type="button"
                        onClick={() => handleSelectContext(note.name)}
                        className="w-full text-left px-2.5 py-1.5 rounded text-xs cb-transition cursor-pointer truncate"
                        style={{
                          backgroundColor: active ? 'var(--cb-surface-alt)' : 'transparent',
                          color: active ? 'var(--cb-text)' : 'var(--cb-text-muted)'
                        }}
                      >
                        {note.name}
                      </button>
                    )
                  })
                )}
              </div>
            </div>

            {/* Context Note Editor */}
            <div className="flex-1 p-5 flex flex-col">
              {selectedContextName ? (
                <>
                  <div className="text-xs mb-2" style={{ color: 'var(--cb-text-muted)' }}>
                    File: rules/context/{selectedContextName}.md
                  </div>
                  <textarea
                    value={contextDraft}
                    onChange={(e) => setContextDraft(e.target.value)}
                    placeholder="Write context-specific instructions..."
                    className="flex-1 w-full p-4 rounded-lg resize-none outline-none text-sm font-mono leading-relaxed"
                    style={{
                      backgroundColor: 'var(--cb-surface)',
                      border: '1px solid var(--cb-border)',
                      color: 'var(--cb-text)'
                    }}
                  />
                </>
              ) : (
                <div
                  className="flex-1 flex items-center justify-center text-xs"
                  style={{ color: 'var(--cb-text-muted)' }}
                >
                  Select or create a context note to edit.
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

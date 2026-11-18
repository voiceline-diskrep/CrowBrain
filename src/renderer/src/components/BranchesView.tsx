import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MouseEvent, ReactElement, WheelEvent } from 'react'
import {
  Eye,
  FilePlus,
  Link2,
  Maximize2,
  Pencil,
  RefreshCw,
  Save,
  Trash2,
  X,
  ZoomIn,
  ZoomOut
} from 'lucide-react'
import type { BranchGraph, VaultNote } from '@shared/types'
import { MarkdownPreview } from './MarkdownPreview'
import { formatTimestamp } from './types'

interface BranchesViewProps {
  notes: VaultNote[]
  selectedNotePath: string | null
  onSelectNotePath: (path: string | null) => void
  onRefreshNotes: () => Promise<void>
}

interface PositionedNode {
  id: string
  title: string
  path: string
  folder: string
  linkCount: number
  x: number
  y: number
}

type LayoutMode = 'split' | 'graph' | 'editor'
type EditorMode = 'edit' | 'preview'

function computeForceLayout(graph: BranchGraph): Record<string, { x: number; y: number }> {
  const nodes = graph.nodes
  const count = nodes.length
  const positions: Record<string, { x: number; y: number }> = {}
  if (count === 0) return positions

  const radius = Math.max(120, count * 22)
  nodes.forEach((node, idx) => {
    const angle = (idx / count) * Math.PI * 2
    positions[node.id] = {
      x: Math.cos(angle) * radius,
      y: Math.sin(angle) * radius
    }
  })

  // Run lightweight spring-repulsion relaxation
  const iterations = Math.min(80, 20 + count * 3)
  const repulsion = 4200
  const springLength = 135
  const springK = 0.045
  const centerPull = 0.012

  for (let iter = 0; iter < iterations; iter++) {
    const forces: Record<string, { fx: number; fy: number }> = {}
    for (const n of nodes) {
      forces[n.id] = { fx: 0, fy: 0 }
    }

    // Repulsion between all pairs
    for (let i = 0; i < count; i++) {
      for (let j = i + 1; j < count; j++) {
        const a = nodes[i]
        const b = nodes[j]
        const pa = positions[a.id]
        const pb = positions[b.id]
        const dx = pb.x - pa.x
        const dy = pb.y - pa.y
        const distSq = Math.max(dx * dx + dy * dy, 64)
        const dist = Math.sqrt(distSq)
        const f = repulsion / distSq
        const fx = (dx / dist) * f
        const fy = (dy / dist) * f
        forces[a.id].fx -= fx
        forces[a.id].fy -= fy
        forces[b.id].fx += fx
        forces[b.id].fy += fy
      }
    }

    // Spring attraction along edges
    for (const edge of graph.edges) {
      const pa = positions[edge.source]
      const pb = positions[edge.target]
      if (!pa || !pb) continue
      const dx = pb.x - pa.x
      const dy = pb.y - pa.y
      const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 1)
      const delta = dist - springLength
      const fx = (dx / dist) * delta * springK
      const fy = (dy / dist) * delta * springK
      forces[edge.source].fx += fx
      forces[edge.source].fy += fy
      forces[edge.target].fx -= fx
      forces[edge.target].fy -= fy
    }

    // Gentle centering pull and apply
    for (const n of nodes) {
      const p = positions[n.id]
      const f = forces[n.id]
      f.fx -= p.x * centerPull
      f.fy -= p.y * centerPull
      p.x += Math.max(-18, Math.min(18, f.fx))
      p.y += Math.max(-18, Math.min(18, f.fy))
    }
  }

  return positions
}

function slugifyFilename(title: string): string {
  const base = title
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return base || `note-${Date.now()}`
}

export function BranchesView({
  notes,
  selectedNotePath,
  onSelectNotePath,
  onRefreshNotes
}: BranchesViewProps): ReactElement {
  const [layoutMode, setLayoutMode] = useState<LayoutMode>('split')
  const [editorMode, setEditorMode] = useState<EditorMode>('edit')
  const [folderFilter, setFolderFilter] = useState<string>('')
  const [graph, setGraph] = useState<BranchGraph>({ nodes: [], edges: [] })
  const [nodePositions, setNodePositions] = useState<Record<string, { x: number; y: number }>>({})
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null)

  // Pan & zoom state
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(1)
  const dragRef = useRef<{
    type: 'pan' | 'node'
    nodeId?: string
    startX: number
    startY: number
    origX: number
    origY: number
  } | null>(null)

  // Active note editor state
  const [activeNote, setActiveNote] = useState<VaultNote | null>(null)
  const [draftTitle, setDraftTitle] = useState('')
  const [draftTags, setDraftTags] = useState('')
  const [draftContent, setDraftContent] = useState('')
  const [isDirty, setIsDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [statusMessage, setStatusMessage] = useState<string | null>(null)

  // New note modal state
  const [showNewModal, setShowNewModal] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [newTags, setNewTags] = useState('')
  const [newContent, setNewContent] = useState('')

  const folders = useMemo(() => {
    const set = new Set<string>()
    for (const n of notes) {
      if (n.folder) set.add(n.folder)
    }
    return Array.from(set).sort()
  }, [notes])

  const loadGraph = useCallback(async () => {
    try {
      const data = await window.crowbrain.getGraph(folderFilter || undefined)
      setGraph(data)
      setNodePositions(computeForceLayout(data))
    } catch (err) {
      console.error('Failed to load graph:', err)
    }
  }, [folderFilter])

  useEffect(() => {
    void loadGraph()
  }, [loadGraph, notes])

  // Load selected note details
  useEffect(() => {
    let cancelled = false
    async function loadSelected(): Promise<void> {
      if (!selectedNotePath) {
        setActiveNote(null)
        setDraftTitle('')
        setDraftTags('')
        setDraftContent('')
        setIsDirty(false)
        return
      }
      const loaded = await window.crowbrain.getNote(selectedNotePath)
      if (cancelled) return
      if (loaded) {
        setActiveNote(loaded)
        setDraftTitle(loaded.title)
        setDraftTags(loaded.tags.join(', '))
        setDraftContent(loaded.content)
        setIsDirty(false)
      }
    }
    void loadSelected()
    return () => {
      cancelled = true
    }
  }, [selectedNotePath])

  const positionedNodes = useMemo<PositionedNode[]>(() => {
    return graph.nodes.map((node) => {
      const pos = nodePositions[node.id] ?? { x: 0, y: 0 }
      return {
        ...node,
        x: pos.x,
        y: pos.y
      }
    })
  }, [graph.nodes, nodePositions])

  const positionMap = useMemo(() => {
    const map = new Map<string, PositionedNode>()
    for (const n of positionedNodes) {
      map.set(n.id, n)
    }
    return map
  }, [positionedNodes])

  const focusNodeId = hoveredNodeId ?? activeNote?.path ?? null

  const connectedNodeIds = useMemo(() => {
    const set = new Set<string>()
    if (!focusNodeId) return set
    set.add(focusNodeId)
    for (const edge of graph.edges) {
      if (edge.source === focusNodeId) set.add(edge.target)
      if (edge.target === focusNodeId) set.add(edge.source)
    }
    return set
  }, [focusNodeId, graph.edges])

  const handleSvgMouseDown = (e: MouseEvent<SVGSVGElement>): void => {
    if (e.button !== 0) return
    dragRef.current = {
      type: 'pan',
      startX: e.clientX,
      startY: e.clientY,
      origX: pan.x,
      origY: pan.y
    }
  }

  const handleNodeMouseDown = (e: MouseEvent<SVGGElement>, node: PositionedNode): void => {
    e.stopPropagation()
    dragRef.current = {
      type: 'node',
      nodeId: node.id,
      startX: e.clientX,
      startY: e.clientY,
      origX: node.x,
      origY: node.y
    }
  }

  const handleSvgMouseMove = (e: MouseEvent<SVGSVGElement>): void => {
    const drag = dragRef.current
    if (!drag) return
    const dx = e.clientX - drag.startX
    const dy = e.clientY - drag.startY
    if (drag.type === 'pan') {
      setPan({ x: drag.origX + dx, y: drag.origY + dy })
    } else if (drag.type === 'node' && drag.nodeId) {
      const id = drag.nodeId
      setNodePositions((prev) => ({
        ...prev,
        [id]: {
          x: drag.origX + dx / zoom,
          y: drag.origY + dy / zoom
        }
      }))
    }
  }

  const handleSvgMouseUp = (): void => {
    dragRef.current = null
  }

  const handleWheel = (e: WheelEvent<SVGSVGElement>): void => {
    e.preventDefault()
    const factor = e.deltaY < 0 ? 1.1 : 0.9
    setZoom((prev) => Math.max(0.25, Math.min(3, Number((prev * factor).toFixed(2)))))
  }

  const resetView = (): void => {
    setPan({ x: 0, y: 0 })
    setZoom(1)
  }

  const handleSaveNote = async (): Promise<void> => {
    if (!activeNote) return
    setSaving(true)
    setStatusMessage(null)
    try {
      const parsedTags = draftTags
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean)
      const nextFrontmatter: Record<string, unknown> = {
        ...activeNote.frontmatter,
        title: draftTitle.trim() || activeNote.title,
        tags: parsedTags
      }
      const saved = await window.crowbrain.saveNote(activeNote.path, draftContent, nextFrontmatter)
      setActiveNote(saved)
      setIsDirty(false)
      setStatusMessage('Saved')
      await onRefreshNotes()
      await loadGraph()
    } catch (err) {
      setStatusMessage(err instanceof Error ? err.message : 'Failed to save note')
    } finally {
      setSaving(false)
    }
  }

  const handleDeleteNote = async (): Promise<void> => {
    if (!activeNote) return
    try {
      const ok = await window.crowbrain.deleteNote(activeNote.path)
      if (ok) {
        onSelectNotePath(null)
        await onRefreshNotes()
        await loadGraph()
      }
    } catch (err) {
      setStatusMessage(err instanceof Error ? err.message : 'Failed to delete note')
    }
  }

  const handleCreateBranchNote = async (): Promise<void> => {
    const cleanTitle = newTitle.trim()
    if (!cleanTitle) return
    const relPath = `branches/${slugifyFilename(cleanTitle)}.md`
    const parsedTags = newTags
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean)
    const body =
      newContent.trim() || `# ${cleanTitle}\n\nDocument branch context and [[wikilinks]] here.\n`

    try {
      const created = await window.crowbrain.saveNote(relPath, body, {
        title: cleanTitle,
        tags: parsedTags
      })
      setShowNewModal(false)
      setNewTitle('')
      setNewTags('')
      setNewContent('')
      await onRefreshNotes()
      await loadGraph()
      onSelectNotePath(created.path)
    } catch (err) {
      setStatusMessage(err instanceof Error ? err.message : 'Failed to create note')
    }
  }

  const handleWikilinkClick = async (target: string): Promise<void> => {
    const found = await window.crowbrain.getNote(target)
    if (found) {
      onSelectNotePath(found.path)
    } else {
      setStatusMessage(`Linked note not found: ${target}`)
    }
  }

  return (
    <div className="h-full flex flex-col">
      {/* Top Toolbar */}
      <div
        className="px-4 py-2.5 flex items-center justify-between gap-3 shrink-0"
        style={{
          backgroundColor: 'var(--cb-surface)',
          borderBottom: '1px solid var(--cb-border)'
        }}
      >
        <div className="flex items-center gap-3">
          <h1 className="text-sm font-semibold">Branches</h1>
          <select
            value={folderFilter}
            onChange={(e) => setFolderFilter(e.target.value)}
            className="text-xs px-2 py-1 rounded outline-none cb-transition"
            style={{
              backgroundColor: 'var(--cb-surface-alt)',
              border: '1px solid var(--cb-border)',
              color: 'var(--cb-text)'
            }}
          >
            <option value="">All folders</option>
            {folders.map((folder) => (
              <option key={folder} value={folder}>
                {folder}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-2">
          {/* Layout Mode Switcher */}
          <div
            className="flex items-center rounded p-0.5 text-xs"
            style={{
              backgroundColor: 'var(--cb-surface-alt)',
              border: '1px solid var(--cb-border)'
            }}
          >
            {(['split', 'graph', 'editor'] as LayoutMode[]).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setLayoutMode(mode)}
                className="px-2.5 py-1 rounded capitalize cb-transition cursor-pointer"
                style={{
                  backgroundColor: layoutMode === mode ? 'var(--cb-surface)' : 'transparent',
                  color: layoutMode === mode ? 'var(--cb-text)' : 'var(--cb-text-muted)'
                }}
              >
                {mode}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => setShowNewModal(true)}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs font-medium cb-transition cursor-pointer"
            style={{
              backgroundColor: 'var(--cb-accent)',
              color: 'var(--cb-accent-text)'
            }}
          >
            <FilePlus size={14} />
            <span>New Branch Note</span>
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 min-h-0 flex">
        {/* Graph Pane */}
        {layoutMode !== 'editor' && (
          <div
            className={`relative min-h-0 overflow-hidden ${
              layoutMode === 'split' ? 'w-1/2' : 'w-full'
            }`}
            style={{
              backgroundColor: 'var(--cb-bg)',
              borderRight: layoutMode === 'split' ? '1px solid var(--cb-border)' : 'none'
            }}
          >
            {/* Graph Controls */}
            <div className="absolute top-3 right-3 z-10 flex items-center gap-1">
              <button
                type="button"
                onClick={() => setZoom((z) => Math.min(3, Number((z + 0.2).toFixed(2))))}
                title="Zoom in"
                className="p-1.5 rounded cb-transition cursor-pointer"
                style={{
                  backgroundColor: 'var(--cb-surface)',
                  border: '1px solid var(--cb-border)',
                  color: 'var(--cb-text)'
                }}
              >
                <ZoomIn size={14} />
              </button>
              <button
                type="button"
                onClick={() => setZoom((z) => Math.max(0.25, Number((z - 0.2).toFixed(2))))}
                title="Zoom out"
                className="p-1.5 rounded cb-transition cursor-pointer"
                style={{
                  backgroundColor: 'var(--cb-surface)',
                  border: '1px solid var(--cb-border)',
                  color: 'var(--cb-text)'
                }}
              >
                <ZoomOut size={14} />
              </button>
              <button
                type="button"
                onClick={resetView}
                title="Reset view"
                className="p-1.5 rounded cb-transition cursor-pointer"
                style={{
                  backgroundColor: 'var(--cb-surface)',
                  border: '1px solid var(--cb-border)',
                  color: 'var(--cb-text)'
                }}
              >
                <Maximize2 size={14} />
              </button>
              <button
                type="button"
                onClick={() => void loadGraph()}
                title="Refresh graph"
                className="p-1.5 rounded cb-transition cursor-pointer"
                style={{
                  backgroundColor: 'var(--cb-surface)',
                  border: '1px solid var(--cb-border)',
                  color: 'var(--cb-text)'
                }}
              >
                <RefreshCw size={14} />
              </button>
            </div>

            {/* Graph Stats */}
            <div
              className="absolute bottom-3 left-3 z-10 px-2.5 py-1 rounded text-[11px]"
              style={{
                backgroundColor: 'var(--cb-surface)',
                border: '1px solid var(--cb-border)',
                color: 'var(--cb-text-muted)'
              }}
            >
              {graph.nodes.length} nodes, {graph.edges.length} links
            </div>

            {graph.nodes.length === 0 ? (
              <div
                className="h-full flex items-center justify-center text-xs"
                style={{ color: 'var(--cb-text-muted)' }}
              >
                No notes available for graph view.
              </div>
            ) : (
              <svg
                className="w-full h-full cursor-grab active:cursor-grabbing"
                onMouseDown={handleSvgMouseDown}
                onMouseMove={handleSvgMouseMove}
                onMouseUp={handleSvgMouseUp}
                onMouseLeave={handleSvgMouseUp}
                onWheel={handleWheel}
              >
                <g transform={`translate(${pan.x + 280}, ${pan.y + 260}) scale(${zoom})`}>
                  {/* Edges */}
                  {graph.edges.map((edge, index) => {
                    const src = positionMap.get(edge.source)
                    const tgt = positionMap.get(edge.target)
                    if (!src || !tgt) return null
                    const highlighted =
                      focusNodeId !== null &&
                      (edge.source === focusNodeId || edge.target === focusNodeId)
                    return (
                      <line
                        key={`${edge.source}-${edge.target}-${index}`}
                        x1={src.x}
                        y1={src.y}
                        x2={tgt.x}
                        y2={tgt.y}
                        stroke={highlighted ? 'var(--cb-accent)' : 'var(--cb-border)'}
                        strokeWidth={highlighted ? 2 : 1}
                        strokeOpacity={focusNodeId && !highlighted ? 0.25 : 0.85}
                      />
                    )
                  })}

                  {/* Nodes */}
                  {positionedNodes.map((node) => {
                    const isSelected = activeNote?.path === node.path
                    const isHighlighted =
                      focusNodeId === null || connectedNodeIds.has(node.id)
                    const radius = Math.min(14, 6 + node.linkCount * 1.5)
                    return (
                      <g
                        key={node.id}
                        transform={`translate(${node.x}, ${node.y})`}
                        onMouseDown={(e) => handleNodeMouseDown(e, node)}
                        onMouseEnter={() => setHoveredNodeId(node.id)}
                        onMouseLeave={() => setHoveredNodeId(null)}
                        onClick={(e) => {
                          e.stopPropagation()
                          onSelectNotePath(node.path)
                        }}
                        className="cursor-pointer"
                        style={{ opacity: isHighlighted ? 1 : 0.3 }}
                      >
                        <circle
                          r={radius}
                          fill={isSelected ? 'var(--cb-accent)' : 'var(--cb-surface)'}
                          stroke={
                            isSelected || hoveredNodeId === node.id
                              ? 'var(--cb-accent)'
                              : 'var(--cb-text-muted)'
                          }
                          strokeWidth={isSelected ? 2.5 : 1.5}
                        />
                        <text
                          y={radius + 13}
                          textAnchor="middle"
                          fontSize="11"
                          fill="var(--cb-text)"
                          style={{ pointerEvents: 'none', userSelect: 'none' }}
                        >
                          {node.title}
                        </text>
                      </g>
                    )
                  })}
                </g>
              </svg>
            )}
          </div>
        )}

        {/* Editor / Viewer Pane */}
        {layoutMode !== 'graph' && (
          <div
            className={`min-h-0 flex flex-col ${
              layoutMode === 'split' ? 'w-1/2' : 'w-full'
            }`}
            style={{ backgroundColor: 'var(--cb-bg)' }}
          >
            {!activeNote ? (
              <div
                className="flex-1 flex flex-col items-center justify-center p-6 text-center gap-2"
                style={{ color: 'var(--cb-text-muted)' }}
              >
                <p className="text-sm">Select a note from the sidebar or graph to view or edit.</p>
                <button
                  type="button"
                  onClick={() => setShowNewModal(true)}
                  className="mt-1 px-3 py-1.5 rounded text-xs font-medium cb-transition cursor-pointer"
                  style={{
                    backgroundColor: 'var(--cb-surface)',
                    border: '1px solid var(--cb-border)',
                    color: 'var(--cb-text)'
                  }}
                >
                  Create Branch Note
                </button>
              </div>
            ) : (
              <>
                {/* Note Header */}
                <div
                  className="px-4 py-2.5 flex items-center justify-between gap-2 shrink-0"
                  style={{
                    backgroundColor: 'var(--cb-surface)',
                    borderBottom: '1px solid var(--cb-border)'
                  }}
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-[11px] truncate" style={{ color: 'var(--cb-text-muted)' }}>
                      {activeNote.path}
                      {activeNote.updatedAt
                        ? ` - Updated ${formatTimestamp(activeNote.updatedAt)}`
                        : ''}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {statusMessage && (
                      <span className="text-xs" style={{ color: 'var(--cb-text-muted)' }}>
                        {statusMessage}
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
                        onClick={() => setEditorMode('edit')}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded cb-transition cursor-pointer"
                        style={{
                          backgroundColor:
                            editorMode === 'edit' ? 'var(--cb-surface)' : 'transparent',
                          color:
                            editorMode === 'edit' ? 'var(--cb-text)' : 'var(--cb-text-muted)'
                        }}
                      >
                        <Pencil size={12} />
                        <span>Edit</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditorMode('preview')}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded cb-transition cursor-pointer"
                        style={{
                          backgroundColor:
                            editorMode === 'preview' ? 'var(--cb-surface)' : 'transparent',
                          color:
                            editorMode === 'preview' ? 'var(--cb-text)' : 'var(--cb-text-muted)'
                        }}
                      >
                        <Eye size={12} />
                        <span>Preview</span>
                      </button>
                    </div>

                    <button
                      type="button"
                      disabled={saving || !isDirty}
                      onClick={() => void handleSaveNote()}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded text-xs font-medium cb-transition cursor-pointer disabled:opacity-50"
                      style={{
                        backgroundColor: 'var(--cb-accent)',
                        color: 'var(--cb-accent-text)'
                      }}
                    >
                      <Save size={13} />
                      <span>{saving ? 'Saving...' : 'Save'}</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => void handleDeleteNote()}
                      title="Delete note"
                      className="p-1.5 rounded cb-transition cursor-pointer"
                      style={{
                        backgroundColor: 'var(--cb-surface-alt)',
                        border: '1px solid var(--cb-border)',
                        color: '#ef4444'
                      }}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>

                {/* Note Metadata Fields */}
                <div
                  className="px-4 py-2.5 grid grid-cols-2 gap-3 shrink-0"
                  style={{
                    backgroundColor: 'var(--cb-surface)',
                    borderBottom: '1px solid var(--cb-border)'
                  }}
                >
                  <div>
                    <label
                      className="block text-[11px] mb-1"
                      style={{ color: 'var(--cb-text-muted)' }}
                    >
                      Title
                    </label>
                    <input
                      type="text"
                      value={draftTitle}
                      onChange={(e) => {
                        setDraftTitle(e.target.value)
                        setIsDirty(true)
                      }}
                      className="w-full px-2.5 py-1 rounded text-xs outline-none"
                      style={{
                        backgroundColor: 'var(--cb-surface-alt)',
                        border: '1px solid var(--cb-border)',
                        color: 'var(--cb-text)'
                      }}
                    />
                  </div>
                  <div>
                    <label
                      className="block text-[11px] mb-1"
                      style={{ color: 'var(--cb-text-muted)' }}
                    >
                      Tags (comma-separated)
                    </label>
                    <input
                      type="text"
                      value={draftTags}
                      onChange={(e) => {
                        setDraftTags(e.target.value)
                        setIsDirty(true)
                      }}
                      placeholder="architecture, auth, api"
                      className="w-full px-2.5 py-1 rounded text-xs outline-none"
                      style={{
                        backgroundColor: 'var(--cb-surface-alt)',
                        border: '1px solid var(--cb-border)',
                        color: 'var(--cb-text)'
                      }}
                    />
                  </div>
                </div>

                {/* Editor or Preview */}
                <div className="flex-1 min-h-0 overflow-y-auto p-4">
                  {editorMode === 'edit' ? (
                    <textarea
                      value={draftContent}
                      onChange={(e) => {
                        setDraftContent(e.target.value)
                        setIsDirty(true)
                      }}
                      placeholder="Write Markdown here. Link other notes with [[Note Title]]."
                      className="w-full h-full min-h-[280px] resize-none bg-transparent outline-none text-sm font-mono leading-relaxed"
                      style={{ color: 'var(--cb-text)' }}
                    />
                  ) : (
                    <MarkdownPreview
                      content={draftContent}
                      onWikilinkClick={(target) => void handleWikilinkClick(target)}
                    />
                  )}
                </div>

                {/* Backlinks Footer */}
                {(activeNote.backlinks.length > 0 || activeNote.links.length > 0) && (
                  <div
                    className="px-4 py-2 text-xs flex flex-wrap items-center gap-3 shrink-0"
                    style={{
                      backgroundColor: 'var(--cb-surface)',
                      borderTop: '1px solid var(--cb-border)',
                      color: 'var(--cb-text-muted)'
                    }}
                  >
                    {activeNote.links.length > 0 && (
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <Link2 size={12} />
                        <span>Links:</span>
                        {activeNote.links.map((link) => (
                          <button
                            key={link}
                            type="button"
                            onClick={() => void handleWikilinkClick(link)}
                            className="px-1.5 py-0.5 rounded text-[11px] cursor-pointer"
                            style={{
                              backgroundColor: 'var(--cb-surface-alt)',
                              color: 'var(--cb-accent)'
                            }}
                          >
                            {link}
                          </button>
                        ))}
                      </div>
                    )}
                    {activeNote.backlinks.length > 0 && (
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span>Backlinks:</span>
                        {activeNote.backlinks.map((back) => (
                          <button
                            key={back}
                            type="button"
                            onClick={() => void handleWikilinkClick(back)}
                            className="px-1.5 py-0.5 rounded text-[11px] cursor-pointer"
                            style={{
                              backgroundColor: 'var(--cb-surface-alt)',
                              color: 'var(--cb-text)'
                            }}
                          >
                            {back}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {/* New Branch Note Modal */}
      {showNewModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 cb-modal-enter"
          style={{ backgroundColor: 'rgba(0, 0, 0, 0.55)' }}
        >
          <div
            className="w-full max-w-lg rounded-lg p-5 space-y-4 shadow-xl"
            style={{
              backgroundColor: 'var(--cb-surface)',
              border: '1px solid var(--cb-border)'
            }}
          >
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold">New Branch Note</h2>
              <button
                type="button"
                onClick={() => setShowNewModal(false)}
                className="p-1 rounded cursor-pointer"
                style={{ color: 'var(--cb-text-muted)' }}
              >
                <X size={16} />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label
                  className="block text-xs mb-1"
                  style={{ color: 'var(--cb-text-muted)' }}
                >
                  Title
                </label>
                <input
                  type="text"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder="Authentication Architecture"
                  className="w-full px-3 py-1.5 rounded text-xs outline-none"
                  style={{
                    backgroundColor: 'var(--cb-surface-alt)',
                    border: '1px solid var(--cb-border)',
                    color: 'var(--cb-text)'
                  }}
                />
              </div>
              <div>
                <label
                  className="block text-xs mb-1"
                  style={{ color: 'var(--cb-text-muted)' }}
                >
                  Tags (comma-separated)
                </label>
                <input
                  type="text"
                  value={newTags}
                  onChange={(e) => setNewTags(e.target.value)}
                  placeholder="auth, backend"
                  className="w-full px-3 py-1.5 rounded text-xs outline-none"
                  style={{
                    backgroundColor: 'var(--cb-surface-alt)',
                    border: '1px solid var(--cb-border)',
                    color: 'var(--cb-text)'
                  }}
                />
              </div>
              <div>
                <label
                  className="block text-xs mb-1"
                  style={{ color: 'var(--cb-text-muted)' }}
                >
                  Initial Content
                </label>
                <textarea
                  rows={5}
                  value={newContent}
                  onChange={(e) => setNewContent(e.target.value)}
                  placeholder="Write context and [[wikilinks]]..."
                  className="w-full px-3 py-2 rounded text-xs font-mono outline-none resize-y"
                  style={{
                    backgroundColor: 'var(--cb-surface-alt)',
                    border: '1px solid var(--cb-border)',
                    color: 'var(--cb-text)'
                  }}
                />
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowNewModal(false)}
                className="px-3 py-1.5 rounded text-xs cb-transition cursor-pointer"
                style={{
                  backgroundColor: 'var(--cb-surface-alt)',
                  border: '1px solid var(--cb-border)',
                  color: 'var(--cb-text)'
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!newTitle.trim()}
                onClick={() => void handleCreateBranchNote()}
                className="px-3 py-1.5 rounded text-xs font-medium cb-transition cursor-pointer disabled:opacity-50"
                style={{
                  backgroundColor: 'var(--cb-accent)',
                  color: 'var(--cb-accent-text)'
                }}
              >
                Create Note
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

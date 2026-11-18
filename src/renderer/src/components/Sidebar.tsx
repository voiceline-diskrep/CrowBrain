import { useEffect, useMemo, useState } from 'react'
import type { ReactElement } from 'react'
import {
  ChevronDown,
  ChevronRight,
  ClipboardList,
  Database,
  FileText,
  Folder,
  FolderKanban,
  GitBranch,
  Map as MapIcon,
  MoreVertical,
  Pencil,
  Pin,
  Plug,
  Plus,
  ScrollText,
  Settings,
  Trash2,
  X
} from 'lucide-react'
import type { ProjectEntry, VaultNote } from '@shared/types'
import logoUrl from '../../../../assets/logo.jpg'
import type { NavTab } from './types'

interface SidebarProps {
  activeTab: NavTab
  onSelectTab: (tab: NavTab) => void
  projects: ProjectEntry[]
  activeProjectId: string
  onSelectProject: (projectId: string) => void
  onCreateProject: (name: string) => void
  onRenameProject: (projectId: string, newName: string) => void
  onDeleteProject: (projectId: string) => void
  onTogglePinProject: (projectId: string) => void
  notes: VaultNote[]
  selectedNotePath: string | null
  onSelectNote: (note: VaultNote) => void
  mcpRunning: boolean
  mcpPort: number
}

const NAV_ITEMS: Array<{ id: NavTab; label: string; icon: typeof GitBranch }> = [
  { id: 'branches', label: 'Branches', icon: GitBranch },
  { id: 'backups', label: 'Backups', icon: Database },
  { id: 'logs', label: 'Logs', icon: ClipboardList },
  { id: 'system-map', label: 'System Map', icon: MapIcon },
  { id: 'rules', label: 'Rules', icon: ScrollText },
  { id: 'mcp', label: 'MCP Connect', icon: Plug },
  { id: 'settings', label: 'Settings', icon: Settings }
]

export function Sidebar({
  activeTab,
  onSelectTab,
  projects,
  activeProjectId,
  onSelectProject,
  onCreateProject,
  onRenameProject,
  onDeleteProject,
  onTogglePinProject,
  notes,
  selectedNotePath,
  onSelectNote,
  mcpRunning,
  mcpPort
}: SidebarProps): ReactElement {
  const [logoFailed, setLogoFailed] = useState(false)
  const [collapsedFolders, setCollapsedFolders] = useState<Record<string, boolean>>({})
  const [creatingProject, setCreatingProject] = useState(false)
  const [newProjectName, setNewProjectName] = useState('')
  const [openMenuProjectId, setOpenMenuProjectId] = useState<string | null>(null)
  const [renamingProjectId, setRenamingProjectId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')

  useEffect(() => {
    if (!openMenuProjectId) return
    const handleOutside = (): void => setOpenMenuProjectId(null)
    window.addEventListener('click', handleOutside)
    return () => window.removeEventListener('click', handleOutside)
  }, [openMenuProjectId])

  const sortedProjects = useMemo(() => {
    return [...projects].sort((a, b) => {
      if (Boolean(a.pinned) !== Boolean(b.pinned)) {
        return a.pinned ? -1 : 1
      }
      return 0
    })
  }, [projects])

  const groupedNotes = useMemo(() => {
    const groups = new Map<string, VaultNote[]>()
    for (const note of notes) {
      const folder = note.folder?.trim() || 'root'
      const list = groups.get(folder) ?? []
      list.push(note)
      groups.set(folder, list)
    }

    const sortedFolders = Array.from(groups.keys()).sort((a, b) => {
      if (a === 'branches') return -1
      if (b === 'branches') return 1
      if (a === 'root') return -1
      if (b === 'root') return 1
      return a.localeCompare(b)
    })

    return sortedFolders.map((folder) => ({
      folder,
      items: (groups.get(folder) ?? []).slice().sort((a, b) => a.title.localeCompare(b.title))
    }))
  }, [notes])

  const toggleFolder = (folder: string): void => {
    setCollapsedFolders((prev) => ({ ...prev, [folder]: !prev[folder] }))
  }

  const handleSubmitProject = (): void => {
    const trimmed = newProjectName.trim()
    if (!trimmed) return
    onCreateProject(trimmed)
    setNewProjectName('')
    setCreatingProject(false)
  }

  return (
    <aside
      className="w-64 shrink-0 h-full flex flex-col select-none"
      style={{
        backgroundColor: 'var(--cb-surface)',
        borderRight: '1px solid var(--cb-border)'
      }}
    >
      {/* Header */}
      <div
        className="px-4 py-3.5 flex items-center justify-between gap-2"
        style={{ borderBottom: '1px solid var(--cb-border)' }}
      >
        <div className="flex items-center gap-2.5 min-w-0">
          {!logoFailed ? (
            <img
              src={logoUrl}
              alt="CrowBrain"
              onError={() => setLogoFailed(true)}
              className="w-7 h-7 rounded-md object-cover shrink-0"
              style={{ border: '1px solid var(--cb-border)' }}
            />
          ) : (
            <div
              className="w-7 h-7 rounded-md flex items-center justify-center text-xs font-semibold shrink-0"
              style={{
                backgroundColor: 'var(--cb-accent)',
                color: 'var(--cb-accent-text)'
              }}
            >
              CB
            </div>
          )}
          <div className="min-w-0">
            <div className="text-sm font-semibold tracking-tight truncate">CrowBrain</div>
            <div
              className="text-[11px] flex items-center gap-1.5"
              style={{ color: 'var(--cb-text-muted)' }}
            >
              <span
                className="w-2 h-2 rounded-full inline-block shrink-0"
                style={{
                  backgroundColor: mcpRunning ? 'var(--cb-text)' : 'var(--cb-text-muted)',
                  opacity: mcpRunning ? 1 : 0.4
                }}
              />
              <span className="truncate">
                {mcpRunning ? `MCP :${mcpPort}` : 'MCP Offline'}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* 1. Projects (Top) */}
      <div className="px-2 py-2.5" style={{ borderBottom: '1px solid var(--cb-border)' }}>
        <div
          className="px-2 pb-1.5 text-[10px] font-semibold uppercase tracking-wider flex items-center justify-between"
          style={{ color: 'var(--cb-text-muted)' }}
        >
          <span>Projects</span>
          <button
            type="button"
            onClick={() => setCreatingProject((prev) => !prev)}
            title="New Project"
            className="p-0.5 rounded cb-transition cursor-pointer hover:opacity-80"
            style={{ color: 'var(--cb-text-muted)' }}
          >
            {creatingProject ? <X size={12} /> : <Plus size={12} />}
          </button>
        </div>

        {creatingProject && (
          <form
            onSubmit={(e) => {
              e.preventDefault()
              handleSubmitProject()
            }}
            className="px-1 pb-2 flex items-center gap-1"
          >
            <input
              type="text"
              value={newProjectName}
              onChange={(e) => setNewProjectName(e.target.value)}
              placeholder="Project name"
              autoFocus
              className="flex-1 min-w-0 px-2 py-1 rounded text-xs outline-none"
              style={{
                backgroundColor: 'var(--cb-bg)',
                color: 'var(--cb-text)',
                border: '1px solid var(--cb-border)'
              }}
            />
            <button
              type="submit"
              className="px-2 py-1 rounded text-xs font-medium cursor-pointer cb-transition"
              style={{
                backgroundColor: 'var(--cb-accent)',
                color: 'var(--cb-accent-text)'
              }}
            >
              Add
            </button>
          </form>
        )}

        <div className={`space-y-0.5 max-h-40 ${openMenuProjectId ? 'overflow-visible' : 'overflow-y-auto'}`}>
          {sortedProjects.length === 0 ? (
            <div className="px-2 py-1 text-xs" style={{ color: 'var(--cb-text-muted)' }}>
              Default
            </div>
          ) : (
            sortedProjects.map((project) => {
              const isActive = project.id === activeProjectId
              const isRenaming = renamingProjectId === project.id
              const isMenuOpen = openMenuProjectId === project.id

              if (isRenaming) {
                return (
                  <form
                    key={project.id}
                    onSubmit={(e) => {
                      e.preventDefault()
                      if (renameValue.trim()) {
                        onRenameProject(project.id, renameValue.trim())
                      }
                      setRenamingProjectId(null)
                    }}
                    className="flex items-center gap-1 px-1 py-0.5"
                  >
                    <input
                      type="text"
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Escape') {
                          setRenamingProjectId(null)
                        }
                      }}
                      autoFocus
                      className="flex-1 min-w-0 px-2 py-1 rounded text-xs outline-none"
                      style={{
                        backgroundColor: 'var(--cb-bg)',
                        color: 'var(--cb-text)',
                        border: '1px solid var(--cb-border)'
                      }}
                    />
                    <button
                      type="submit"
                      className="px-2 py-1 rounded text-[11px] font-medium cursor-pointer"
                      style={{
                        backgroundColor: 'var(--cb-accent)',
                        color: 'var(--cb-accent-text)'
                      }}
                    >
                      Save
                    </button>
                  </form>
                )
              }

              return (
                <div key={project.id} className="relative group flex items-center">
                  <button
                    type="button"
                    onClick={() => onSelectProject(project.id)}
                    title={project.vaultPath}
                    className="flex-1 min-w-0 flex items-center gap-2 pl-2 pr-7 py-1.5 rounded-md text-xs font-medium cb-transition cursor-pointer text-left"
                    style={{
                      backgroundColor: isActive ? 'var(--cb-surface-alt)' : 'transparent',
                      color: isActive ? 'var(--cb-text)' : 'var(--cb-text-muted)',
                      borderLeft: isActive ? '2px solid var(--cb-accent)' : '2px solid transparent'
                    }}
                  >
                    <FolderKanban size={13} className="shrink-0" />
                    <span className="truncate flex-1">{project.name}</span>
                    {project.pinned && (
                      <Pin size={11} className="shrink-0 opacity-75" />
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      setOpenMenuProjectId((prev) => (prev === project.id ? null : project.id))
                    }}
                    title="Project options"
                    className="absolute right-1 p-1 rounded opacity-60 group-hover:opacity-100 cb-transition cursor-pointer"
                    style={{ color: 'var(--cb-text-muted)' }}
                  >
                    <MoreVertical size={13} />
                  </button>

                  {isMenuOpen && (
                    <div
                      onClick={(e) => e.stopPropagation()}
                      className="absolute right-1 top-full mt-1 w-36 rounded-md py-1 shadow-lg z-30 cb-modal-enter"
                      style={{
                        backgroundColor: 'var(--cb-surface)',
                        border: '1px solid var(--cb-border)'
                      }}
                    >
                      <button
                        type="button"
                        onClick={() => {
                          onTogglePinProject(project.id)
                          setOpenMenuProjectId(null)
                        }}
                        className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left cursor-pointer hover:opacity-80"
                        style={{ color: 'var(--cb-text)' }}
                      >
                        <Pin size={12} />
                        <span>{project.pinned ? 'Unpin' : 'Pin'}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setRenameValue(project.name)
                          setRenamingProjectId(project.id)
                          setOpenMenuProjectId(null)
                        }}
                        className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left cursor-pointer hover:opacity-80"
                        style={{ color: 'var(--cb-text)' }}
                      >
                        <Pencil size={12} />
                        <span>Rename</span>
                      </button>
                      <button
                        type="button"
                        disabled={projects.length <= 1}
                        onClick={() => {
                          onDeleteProject(project.id)
                          setOpenMenuProjectId(null)
                        }}
                        className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left cursor-pointer hover:opacity-80 disabled:opacity-40 disabled:cursor-not-allowed"
                        style={{ color: '#ef4444' }}
                      >
                        <Trash2 size={12} />
                        <span>Delete</span>
                      </button>
                    </div>
                  )}
                </div>
              )
            })
          )}
        </div>
      </div>

      {/* 2. Vault Notes Explorer (Middle) */}
      <div
        className="flex-1 overflow-y-auto px-2 py-2.5"
        style={{ borderBottom: '1px solid var(--cb-border)' }}
      >
        <div
          className="px-2 pb-1.5 text-[10px] font-semibold uppercase tracking-wider flex items-center justify-between"
          style={{ color: 'var(--cb-text-muted)' }}
        >
          <span>Vault Notes</span>
          <span>{notes.length}</span>
        </div>

        {groupedNotes.length === 0 ? (
          <div className="px-2 py-3 text-xs" style={{ color: 'var(--cb-text-muted)' }}>
            No notes in vault.
          </div>
        ) : (
          <div className="space-y-1">
            {groupedNotes.map(({ folder, items }) => {
              const isCollapsed = Boolean(collapsedFolders[folder])
              return (
                <div key={folder}>
                  <button
                    type="button"
                    onClick={() => toggleFolder(folder)}
                    className="w-full flex items-center gap-1.5 px-1.5 py-1 rounded text-xs font-medium cb-transition cursor-pointer text-left"
                    style={{ color: 'var(--cb-text-muted)' }}
                  >
                    {isCollapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
                    <Folder size={13} />
                    <span className="truncate flex-1">{folder}</span>
                    <span className="text-[10px] opacity-75">{items.length}</span>
                  </button>

                  {!isCollapsed && (
                    <div className="mt-0.5 pl-4 space-y-0.5">
                      {items.map((note) => {
                        const isSelected = selectedNotePath === note.path
                        return (
                          <button
                            key={note.path}
                            type="button"
                            onClick={() => onSelectNote(note)}
                            title={note.path}
                            className="w-full flex items-center gap-1.5 px-2 py-1 rounded text-xs cb-transition cursor-pointer text-left"
                            style={{
                              backgroundColor: isSelected
                                ? 'var(--cb-surface-alt)'
                                : 'transparent',
                              color: isSelected ? 'var(--cb-text)' : 'var(--cb-text-muted)'
                            }}
                          >
                            <FileText size={12} className="shrink-0" />
                            <span className="truncate">{note.title}</span>
                          </button>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* 3. Navigation (Bottom) */}
      <nav className="px-2 py-2 space-y-0.5">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon
          const isActive = activeTab === item.id
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelectTab(item.id)}
              className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-md text-xs font-medium cb-transition cursor-pointer text-left"
              style={{
                backgroundColor: isActive ? 'var(--cb-surface-alt)' : 'transparent',
                color: isActive ? 'var(--cb-text)' : 'var(--cb-text-muted)',
                borderLeft: isActive ? '2px solid var(--cb-accent)' : '2px solid transparent'
              }}
            >
              <Icon
                size={15}
                style={{ color: isActive ? 'var(--cb-accent)' : 'var(--cb-text-muted)' }}
              />
              <span>{item.label}</span>
            </button>
          )
        })}
      </nav>
    </aside>
  )
}

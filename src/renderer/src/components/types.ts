export type NavTab =
  | 'branches'
  | 'backups'
  | 'logs'
  | 'system-map'
  | 'rules'
  | 'mcp'
  | 'settings'

export function formatTimestamp(ts: number): string {
  if (!ts) return ''
  const date = new Date(ts)
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

import type { ReactElement, ReactNode } from 'react'

interface MarkdownPreviewProps {
  content: string
  onWikilinkClick?: (target: string) => void
  className?: string
}

function renderInline(
  text: string,
  onWikilinkClick?: (target: string) => void
): ReactNode[] {
  const tokenRegex = /(\[\[[^\]]+\]\]|`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*)/g
  const parts: ReactNode[] = []
  let lastIndex = 0
  let match: RegExpExecArray | null = tokenRegex.exec(text)
  let key = 0

  while (match !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index))
    }

    const token = match[0]
    if (token.startsWith('[[') && token.endsWith(']]')) {
      const inner = token.slice(2, -2)
      const [target, alias] = inner.split('|')
      const label = (alias ?? target).trim()
      const cleanTarget = target.trim()
      parts.push(
        <button
          key={key++}
          type="button"
          onClick={() => onWikilinkClick?.(cleanTarget)}
          className="inline-flex items-center px-1.5 py-0.5 rounded text-[0.9em] font-medium cb-transition hover:opacity-85 cursor-pointer"
          style={{
            backgroundColor: 'var(--cb-surface-alt)',
            color: 'var(--cb-accent)',
            border: '1px solid var(--cb-border)'
          }}
        >
          {label}
        </button>
      )
    } else if (token.startsWith('`') && token.endsWith('`')) {
      parts.push(
        <code
          key={key++}
          className="px-1.5 py-0.5 rounded text-[0.88em] font-mono"
          style={{
            backgroundColor: 'var(--cb-surface-alt)',
            border: '1px solid var(--cb-border)'
          }}
        >
          {token.slice(1, -1)}
        </code>
      )
    } else if (token.startsWith('**') && token.endsWith('**')) {
      parts.push(
        <strong key={key++} className="font-semibold">
          {token.slice(2, -2)}
        </strong>
      )
    } else if (token.startsWith('*') && token.endsWith('*')) {
      parts.push(
        <em key={key++} className="italic">
          {token.slice(1, -1)}
        </em>
      )
    }

    lastIndex = match.index + token.length
    match = tokenRegex.exec(text)
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex))
  }

  return parts
}

export function MarkdownPreview({
  content,
  onWikilinkClick,
  className = ''
}: MarkdownPreviewProps): ReactElement {
  const lines = content.split(/\r?\n/)
  const elements: ReactElement[] = []
  let i = 0
  let key = 0

  while (i < lines.length) {
    const line = lines[i]

    // Fenced code block
    if (line.trim().startsWith('```')) {
      const codeLines: string[] = []
      i++
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        codeLines.push(lines[i])
        i++
      }
      i++
      elements.push(
        <pre
          key={key++}
          className="my-3 p-3 rounded-md text-xs font-mono overflow-x-auto"
          style={{
            backgroundColor: 'var(--cb-surface-alt)',
            border: '1px solid var(--cb-border)',
            color: 'var(--cb-text)'
          }}
        >
          <code>{codeLines.join('\n')}</code>
        </pre>
      )
      continue
    }

    // Headings
    const headingMatch = /^(#{1,4})\s+(.*)$/.exec(line)
    if (headingMatch) {
      const level = headingMatch[1].length
      const text = headingMatch[2]
      const sizeClass =
        level === 1
          ? 'text-xl font-semibold mt-4 mb-2'
          : level === 2
            ? 'text-lg font-semibold mt-4 mb-2'
            : level === 3
              ? 'text-base font-semibold mt-3 mb-1.5'
              : 'text-sm font-semibold mt-2 mb-1'
      elements.push(
        <div
          key={key++}
          className={sizeClass}
          style={{ color: 'var(--cb-text)' }}
        >
          {renderInline(text, onWikilinkClick)}
        </div>
      )
      i++
      continue
    }

    // Blockquote
    if (line.trim().startsWith('> ')) {
      elements.push(
        <blockquote
          key={key++}
          className="my-2 pl-3 py-1 text-sm italic"
          style={{
            borderLeft: '3px solid var(--cb-accent)',
            color: 'var(--cb-text-muted)'
          }}
        >
          {renderInline(line.trim().slice(2), onWikilinkClick)}
        </blockquote>
      )
      i++
      continue
    }

    // Unordered list block
    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = []
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*]\s+/, ''))
        i++
      }
      elements.push(
        <ul key={key++} className="my-2 pl-5 list-disc space-y-1 text-sm leading-relaxed">
          {items.map((item, idx) => (
            <li key={idx}>{renderInline(item, onWikilinkClick)}</li>
          ))}
        </ul>
      )
      continue
    }

    // Horizontal rule
    if (/^---+$/.test(line.trim())) {
      elements.push(
        <hr
          key={key++}
          className="my-4"
          style={{ borderColor: 'var(--cb-border)' }}
        />
      )
      i++
      continue
    }

    // Empty line
    if (line.trim() === '') {
      i++
      continue
    }

    // Paragraph
    elements.push(
      <p key={key++} className="my-2 text-sm leading-relaxed">
        {renderInline(line, onWikilinkClick)}
      </p>
    )
    i++
  }

  if (elements.length === 0) {
    return (
      <div className={`text-sm ${className}`} style={{ color: 'var(--cb-text-muted)' }}>
        Empty note.
      </div>
    )
  }

  return <div className={className}>{elements}</div>
}

import matter from 'gray-matter'

export interface ParsedMarkdown {
  title: string
  content: string
  frontmatter: Record<string, unknown>
  tags: string[]
  links: string[]
}

function stripCodeBlocks(markdown: string): string {
  // Remove fenced code blocks (``` or ~~~) and inline code spans.
  return markdown
    .replace(/```[\s\S]*?```/g, '')
    .replace(/~~~[\s\S]*?~~~/g, '')
    .replace(/`[^`\n]+`/g, '')
}

function stripUrls(markdown: string): string {
  // Remove markdown link destinations and bare URLs so #anchors are not treated as tags.
  return markdown
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/[^\s)>\]]+/gi, '')
}

export function extractWikilinks(markdown: string): string[] {
  const cleaned = stripCodeBlocks(markdown)
  const links = new Set<string>()
  const regex = /\[\[([^\[\]]+)\]\]/g
  let match: RegExpExecArray | null

  while ((match = regex.exec(cleaned)) !== null) {
    const inner = match[1]
    const target = inner.split('|')[0].split('#')[0].trim()
    if (target.length > 0) {
      links.add(target)
    }
  }

  return Array.from(links)
}

export function extractTags(markdown: string, frontmatter?: Record<string, unknown>): string[] {
  const tags = new Set<string>()

  if (frontmatter && frontmatter.tags !== undefined) {
    const rawTags = frontmatter.tags
    if (Array.isArray(rawTags)) {
      for (const item of rawTags) {
        if (typeof item === 'string') {
          const normalized = item.trim().replace(/^#/, '')
          if (normalized.length > 0) {
            tags.add(normalized)
          }
        }
      }
    } else if (typeof rawTags === 'string') {
      for (const part of rawTags.split(/[,\s]+/)) {
        const normalized = part.trim().replace(/^#/, '')
        if (normalized.length > 0) {
          tags.add(normalized)
        }
      }
    }
  }

  const cleaned = stripUrls(stripCodeBlocks(markdown))
  const tagRegex = /(?:^|\s)#([a-zA-Z][a-zA-Z0-9_/-]*)/g
  let match: RegExpExecArray | null

  while ((match = tagRegex.exec(cleaned)) !== null) {
    const tag = match[1].trim()
    if (tag.length > 0) {
      tags.add(tag)
    }
  }

  return Array.from(tags)
}

export function parseMarkdown(raw: string, fallbackTitle = 'Untitled'): ParsedMarkdown {
  const parsed = matter(raw)
  const frontmatter = (parsed.data ?? {}) as Record<string, unknown>
  const content = parsed.content

  let title = fallbackTitle
  if (typeof frontmatter.title === 'string' && frontmatter.title.trim().length > 0) {
    title = frontmatter.title.trim()
  } else {
    const headingMatch = content.match(/^#\s+(.+)$/m)
    if (headingMatch && headingMatch[1].trim().length > 0) {
      title = headingMatch[1].trim()
    }
  }

  return {
    title,
    content,
    frontmatter,
    tags: extractTags(content, frontmatter),
    links: extractWikilinks(content)
  }
}

export function serializeNote(content: string, frontmatter?: Record<string, unknown>): string {
  if (!frontmatter) {
    return content
  }

  const cleaned: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(frontmatter)) {
    if (value !== undefined) {
      cleaned[key] = value
    }
  }

  if (Object.keys(cleaned).length === 0) {
    return content
  }

  return matter.stringify(content, cleaned)
}

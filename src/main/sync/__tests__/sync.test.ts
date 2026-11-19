import { describe, expect, it } from 'vitest'
import { mergeJsonlContent, mergeManifestProjects, slugifyProjectName } from '../SyncManager'
import { normalizeGitRepoUrl } from '../GitSyncManager'

describe('SyncManager helpers', () => {
  it('merges JSONL files by id and sorts chronologically without duplicates', () => {
    const local = [
      JSON.stringify({ id: 'a1', timestamp: 1000, title: 'PC log 1' }),
      JSON.stringify({ id: 'shared', timestamp: 1500, title: 'Shared log' })
    ].join('\n')

    const remote = [
      JSON.stringify({ id: 'shared', timestamp: 1500, title: 'Shared log' }),
      JSON.stringify({ id: 'b2', timestamp: 2000, title: 'Laptop log 2' })
    ].join('\n')

    const res = mergeJsonlContent(local, remote)
    expect(res.changedLocal).toBe(true)
    expect(res.changedRemote).toBe(true)

    const lines = res.mergedText
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l) as { id: string; timestamp: number })
    expect(lines.map((x) => x.id)).toEqual(['a1', 'shared', 'b2'])
  })

  it('reports no changes when local and remote JSONL match', () => {
    const content = `${JSON.stringify({ id: 'x1', timestamp: 100 })}\n`
    const res = mergeJsonlContent(content, content)
    expect(res.changedLocal).toBe(false)
    expect(res.changedRemote).toBe(false)
  })

  it('merges portable project manifests across devices', () => {
    const merged = mergeManifestProjects(
      [
        {
          id: 'proj-pc',
          name: 'PC Project',
          vaultPath: 'C:\\Users\\ASUS\\Documents\\CrowBrainProjects\\pc-project',
          createdAt: 200
        }
      ],
      {
        version: 1,
        updatedAt: 300,
        projects: [
          {
            id: 'proj-laptop',
            name: 'Laptop Project',
            slug: 'laptop-project',
            createdAt: 100
          }
        ]
      }
    )

    expect(merged.map((p) => p.id)).toEqual(['proj-laptop', 'proj-pc'])
    expect(merged[1].slug).toBe('pc-project')
  })

  it('slugifies project names with fallback', () => {
    expect(slugifyProjectName('CrowBrain App', 'id-1')).toBe('crowbrain-app')
    expect(slugifyProjectName('   ', 'id-2')).toBe('id-2')
  })

  it('normalizes shorthand owner/repo strings to GitHub HTTPS URLs', () => {
    expect(normalizeGitRepoUrl('voiceline-diskrep/CrowBrain-Vault')).toBe(
      'https://github.com/voiceline-diskrep/CrowBrain-Vault.git'
    )
    expect(normalizeGitRepoUrl('https://github.com/user/repo.git')).toBe(
      'https://github.com/user/repo.git'
    )
    expect(normalizeGitRepoUrl('')).toBe('')
  })

  it('respects project deletion tombstones and propagates renames by updatedAt', () => {
    const merged = mergeManifestProjects(
      [
        {
          id: 'proj-1',
          name: 'Renamed App',
          slug: 'original-app',
          vaultPath: 'C:\\vaults\\original-app',
          createdAt: 100,
          updatedAt: 500,
          pinned: true
        }
      ],
      {
        version: 1,
        updatedAt: 400,
        projects: [
          {
            id: 'proj-1',
            name: 'Original App',
            slug: 'original-app',
            createdAt: 100,
            updatedAt: 200,
            pinned: false
          },
          {
            id: 'proj-deleted',
            name: 'Old Project',
            slug: 'old-project',
            createdAt: 50,
            updatedAt: 100
          }
        ]
      },
      ['proj-deleted']
    )

    const p1 = merged.find((p) => p.id === 'proj-1')
    const pDel = merged.find((p) => p.id === 'proj-deleted')
    expect(p1?.name).toBe('Renamed App')
    expect(p1?.slug).toBe('original-app')
    expect(p1?.pinned).toBe(true)
    expect(p1?.deleted).toBeFalsy()
    expect(pDel?.deleted).toBe(true)
  })
})

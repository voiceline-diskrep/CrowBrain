import type { UpdateCheckResult } from '@shared/types'

interface ParsedVersion {
  major: number
  minor: number
  patch: number
  prerelease: string
}

function parseSemver(version: string): ParsedVersion | null {
  const cleaned = version.trim().replace(/^v/i, '').split('+')[0]
  if (!cleaned) return null

  const dashIndex = cleaned.indexOf('-')
  const core = dashIndex === -1 ? cleaned : cleaned.slice(0, dashIndex)
  const prerelease = dashIndex === -1 ? '' : cleaned.slice(dashIndex + 1)

  const parts = core.split('.')
  if (parts.length === 0 || parts.length > 3) return null

  const nums = parts.map((p) => {
    if (!/^\d+$/.test(p)) return Number.NaN
    return Number.parseInt(p, 10)
  })

  if (nums.some((n) => Number.isNaN(n))) return null

  return {
    major: nums[0] ?? 0,
    minor: nums[1] ?? 0,
    patch: nums[2] ?? 0,
    prerelease
  }
}

export function isNewerVersion(current: string, latest: string): boolean {
  const cur = parseSemver(current)
  const lat = parseSemver(latest)
  if (!cur || !lat) return false

  if (lat.major !== cur.major) return lat.major > cur.major
  if (lat.minor !== cur.minor) return lat.minor > cur.minor
  if (lat.patch !== cur.patch) return lat.patch > cur.patch

  if (cur.prerelease && !lat.prerelease) return true
  if (!cur.prerelease && lat.prerelease) return false
  if (cur.prerelease && lat.prerelease) return lat.prerelease > cur.prerelease

  return false
}

interface GitHubReleaseResponse {
  tag_name?: string
  html_url?: string
  body?: string
  published_at?: string
}

export async function checkForUpdates(
  currentVersion: string,
  repo = 'voiceline-diskrep/CrowBrain'
): Promise<UpdateCheckResult> {
  const fallbackUrl = `https://github.com/${repo}/releases`
  const baseResult: UpdateCheckResult = {
    currentVersion,
    latestVersion: currentVersion,
    hasUpdate: false,
    releaseUrl: fallbackUrl,
    releaseNotes: '',
    publishedAt: ''
  }

  try {
    const response = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
      headers: {
        'User-Agent': 'CrowBrain',
        Accept: 'application/vnd.github+json'
      }
    })

    if (response.status === 404) {
      return baseResult
    }

    if (!response.ok) {
      return {
        ...baseResult,
        error: `GitHub API returned status ${response.status}`
      }
    }

    const data = (await response.json()) as GitHubReleaseResponse
    const rawTag = data.tag_name ?? currentVersion
    const latestVersion = rawTag.replace(/^v/i, '')
    const hasUpdate = isNewerVersion(currentVersion, rawTag)

    return {
      currentVersion,
      latestVersion,
      hasUpdate,
      releaseUrl: data.html_url ?? fallbackUrl,
      releaseNotes: data.body ?? '',
      publishedAt: data.published_at ?? ''
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error checking for updates'
    return {
      ...baseResult,
      error: message
    }
  }
}

import crypto from 'node:crypto'
import http from 'node:http'
import { shell } from 'electron'

const FOLDER_MIME = 'application/vnd.google-apps.folder'

export interface GoogleTokens {
  refreshToken?: string
  accessToken: string
  tokenExpiresAt: number
  accountEmail?: string
}

export interface DriveFileItem {
  id: string
  name: string
  mimeType: string
  modifiedTime?: string
}

function base64UrlEncode(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export async function authenticateWithGoogle(
  clientId: string,
  clientSecret?: string
): Promise<GoogleTokens> {
  const trimmedId = clientId.trim()
  if (!trimmedId) {
    throw new Error('Google OAuth Client ID is required.')
  }

  const codeVerifier = base64UrlEncode(crypto.randomBytes(32))
  const codeChallenge = base64UrlEncode(
    crypto.createHash('sha256').update(codeVerifier).digest()
  )
  const state = base64UrlEncode(crypto.randomBytes(16))

  let server: http.Server | null = null

  const authCode = await new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(() => {
      server?.close()
      reject(new Error('Google sign-in timed out after 3 minutes.'))
    }, 180_000)

    server = http.createServer((req, res) => {
      const reqUrl = new URL(req.url ?? '/', 'http://127.0.0.1')
      if (reqUrl.pathname !== '/oauth2callback') {
        res.writeHead(404)
        res.end('Not found')
        return
      }

      const returnedState = reqUrl.searchParams.get('state')
      const error = reqUrl.searchParams.get('error')
      const code = reqUrl.searchParams.get('code')

      if (error) {
        clearTimeout(timeout)
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end('<h3>CrowBrain sign-in failed. You can close this tab.</h3>')
        server?.close()
        reject(new Error(`Google OAuth error: ${error}`))
        return
      }

      if (!code || returnedState !== state) {
        clearTimeout(timeout)
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end('<h3>Invalid OAuth response. You can close this tab.</h3>')
        server?.close()
        reject(new Error('Invalid OAuth state or missing authorization code.'))
        return
      }

      clearTimeout(timeout)
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end('<h3>CrowBrain connected to Google Drive. You can close this tab.</h3>')
      server?.close()
      resolve(code)
    })

    server.listen(0, '127.0.0.1', () => {
      const address = server?.address()
      if (!address || typeof address === 'string') {
        clearTimeout(timeout)
        reject(new Error('Failed to start local OAuth callback server.'))
        return
      }
      const redirectUri = `http://127.0.0.1:${address.port}/oauth2callback`
      const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth')
      authUrl.searchParams.set('client_id', trimmedId)
      authUrl.searchParams.set('redirect_uri', redirectUri)
      authUrl.searchParams.set('response_type', 'code')
      authUrl.searchParams.set(
        'scope',
        'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/userinfo.email'
      )
      authUrl.searchParams.set('access_type', 'offline')
      authUrl.searchParams.set('prompt', 'consent')
      authUrl.searchParams.set('code_challenge', codeChallenge)
      authUrl.searchParams.set('code_challenge_method', 'S256')
      authUrl.searchParams.set('state', state)

      void shell.openExternal(authUrl.toString())
    })
  }).then(async (code) => {
    const address = server?.address()
    const port = address && typeof address !== 'string' ? address.port : 0
    return { code, redirectUri: `http://127.0.0.1:${port}/oauth2callback` }
  })

  const body = new URLSearchParams({
    code: authCode.code,
    client_id: trimmedId,
    redirect_uri: authCode.redirectUri,
    grant_type: 'authorization_code',
    code_verifier: codeVerifier
  })
  if (clientSecret?.trim()) {
    body.set('client_secret', clientSecret.trim())
  }

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString()
  })

  if (!tokenRes.ok) {
    const errText = await tokenRes.text()
    throw new Error(`Token exchange failed (${tokenRes.status}): ${errText}`)
  }

  const tokenJson = (await tokenRes.json()) as {
    access_token: string
    refresh_token?: string
    expires_in?: number
  }

  const expiresInMs = (tokenJson.expires_in ?? 3600) * 1000
  let accountEmail: string | undefined

  try {
    const userRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokenJson.access_token}` }
    })
    if (userRes.ok) {
      const userJson = (await userRes.json()) as { email?: string }
      accountEmail = userJson.email
    }
  } catch {
    // Email lookup is optional
  }

  return {
    accessToken: tokenJson.access_token,
    refreshToken: tokenJson.refresh_token,
    tokenExpiresAt: Date.now() + expiresInMs - 60_000,
    accountEmail
  }
}

export async function refreshGoogleToken(
  clientId: string,
  refreshToken: string,
  clientSecret?: string
): Promise<{ accessToken: string; tokenExpiresAt: number }> {
  const body = new URLSearchParams({
    client_id: clientId.trim(),
    refresh_token: refreshToken,
    grant_type: 'refresh_token'
  })
  if (clientSecret?.trim()) {
    body.set('client_secret', clientSecret.trim())
  }

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString()
  })

  if (!res.ok) {
    const errText = await res.text()
    throw new Error(`Token refresh failed (${res.status}): ${errText}`)
  }

  const json = (await res.json()) as { access_token: string; expires_in?: number }
  return {
    accessToken: json.access_token,
    tokenExpiresAt: Date.now() + (json.expires_in ?? 3600) * 1000 - 60_000
  }
}

export class GoogleDriveClient {
  constructor(private readonly getAccessToken: () => Promise<string>) {}

  private async request(url: string, init: RequestInit = {}): Promise<Response> {
    const token = await this.getAccessToken()
    const headers = new Headers(init.headers)
    headers.set('Authorization', `Bearer ${token}`)
    const res = await fetch(url, { ...init, headers })
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`Google Drive API error (${res.status}): ${text}`)
    }
    return res
  }

  async listFiles(folderId?: string): Promise<DriveFileItem[]> {
    const queryParts = ['trashed = false']
    if (folderId) {
      queryParts.push(`'${folderId}' in parents`)
    } else {
      queryParts.push(`'root' in parents`)
    }

    const all: DriveFileItem[] = []
    let pageToken: string | undefined

    do {
      const url = new URL('https://www.googleapis.com/drive/v3/files')
      url.searchParams.set('q', queryParts.join(' and '))
      url.searchParams.set('fields', 'nextPageToken, files(id, name, mimeType, modifiedTime)')
      url.searchParams.set('pageSize', '200')
      if (pageToken) {
        url.searchParams.set('pageToken', pageToken)
      }

      const res = await this.request(url.toString())
      const json = (await res.json()) as {
        nextPageToken?: string
        files?: DriveFileItem[]
      }
      if (json.files) {
        all.push(...json.files)
      }
      pageToken = json.nextPageToken
    } while (pageToken)

    return all
  }

  async ensureFolder(name: string, parentId?: string): Promise<string> {
    const existing = await this.listFiles(parentId)
    const match = existing.find((f) => f.mimeType === FOLDER_MIME && f.name === name)
    if (match) {
      return match.id
    }

    const metadata: Record<string, unknown> = {
      name,
      mimeType: FOLDER_MIME
    }
    if (parentId) {
      metadata.parents = [parentId]
    }

    const res = await this.request('https://www.googleapis.com/drive/v3/files', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(metadata)
    })
    const created = (await res.json()) as { id: string }
    return created.id
  }

  async downloadText(fileId: string): Promise<string> {
    const res = await this.request(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`
    )
    return res.text()
  }

  async uploadText(
    name: string,
    parentId: string,
    content: string,
    existingFileId?: string,
    mimeType = 'text/plain'
  ): Promise<string> {
    const boundary = `crowbrain_${crypto.randomBytes(12).toString('hex')}`
    const metadata = existingFileId
      ? { name, mimeType }
      : { name, mimeType, parents: [parentId] }

    const body = [
      `--${boundary}`,
      'Content-Type: application/json; charset=UTF-8',
      '',
      JSON.stringify(metadata),
      `--${boundary}`,
      `Content-Type: ${mimeType}; charset=UTF-8`,
      '',
      content,
      `--${boundary}--`
    ].join('\r\n')

    const endpoint = existingFileId
      ? `https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(existingFileId)}?uploadType=multipart`
      : 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart'

    const res = await this.request(endpoint, {
      method: existingFileId ? 'PATCH' : 'POST',
      headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
      body
    })

    const json = (await res.json()) as { id: string }
    return json.id
  }
}

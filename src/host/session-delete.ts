/**
 * R9#2 — hard-delete one conversation (host half).
 *
 * Sessions are persisted under `<DSH_HOME|~>/.dsh/sessions/<projectKey>/<id>`
 * (one directory per session: event log + artifacts). Deleting a session is
 * removing that directory, recursively — the durable truth; nothing else
 * references it outside the project tree. The id segment is encoded by the
 * harness's encodeSegment (uuid ids pass through unchanged), and deletion is
 * scoped by scanning every project directory for a child whose NAME equals the
 * exact id — strictly a leaf session dir, never a project root, never an
 * arbitrary path.
 */

import { existsSync, readdirSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'

/** Strict leaf-name guard: alphanumerics, dots, underscores, hyphens only. */
const SEGMENT_RE = /^[A-Za-z0-9._-]{6,200}$/

/** The sessions directory under the install data root. */
function sessionRoot(): string {
  return join(process.env.DSH_HOME ?? homedir(), '.dsh', 'sessions')
}

/**
 * Delete every session directory whose id matches exactly.
 * @param sessionId - the session id to remove.
 * @returns a structured outcome (ok + removed count, or an error reason).
 */
export function deleteSession(sessionId: string): { ok: true; removed: number } | { ok: false; error: string } {
  const id = String(sessionId ?? '').trim()
  if (!SEGMENT_RE.test(id)) return { ok: false, error: 'invalid session id' }
  if (id.includes('..')) return { ok: false, error: 'invalid session id' }

  const root = sessionRoot()
  if (!existsSync(root)) return { ok: false, error: 'session store unavailable' }

  let removed = 0
  for (const project of readdirSync(root, { withFileTypes: true })) {
    if (!project.isDirectory()) continue
    const projectDir = resolve(root, project.name)
    let entries: import('node:fs').Dirent[]
    try { entries = readdirSync(projectDir, { withFileTypes: true }) } catch { continue }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name !== id) continue
      const target = resolve(projectDir, entry.name)
      // Toxx-proof: stay strictly inside the project dir.
      if (target === projectDir || !target.startsWith(projectDir + sep)) continue
      rmSync(target, { recursive: true, force: true })
      removed += 1
    }
  }
  if (removed === 0) return { ok: false, error: 'session not found' }
  return { ok: true, removed }
}

/** HTTP handler for POST /api/model-manager/delete-session. */
export function handleDeleteSessionRequest(req: IncomingMessage, res: ServerResponse): void {
  if (req.method !== 'POST') {
    res.writeHead(405, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: false, error: 'POST only' }))
    return
  }
  let body = ''
  req.on('data', (chunk: Buffer) => {
    body += chunk.toString('utf8')
    if (body.length > 1_000_000) req.destroy()
  })
  req.on('end', () => {
    let sessionId = ''
    try {
      const parsed = JSON.parse(body || '{}') as { sessionId?: unknown }
      if (typeof parsed.sessionId === 'string') sessionId = parsed.sessionId
    } catch {
      // fall through with empty id → rejected downstream
    }
    const result = deleteSession(sessionId)
    if (result.ok) console.log(`[dsh-model-manager] deleted session dirs: ${result.removed}`)
    const status = result.ok ? 200 : 404
    res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(result))
  })
}

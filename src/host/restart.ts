/**
 * R7 — Service restart helper for the dsh web host.
 *
 * Restart is deliberately platform-neutral: it is simply "stop, then start the
 * SAME command again". We derive the exact argv of the running process and
 * `spawn` a detached child (POSIX and Windows both honour `detached`, so the
 * child survives this process exiting), then exit the old process. No launchd,
 * no schtasks are involved in the restart itself.
 *
 * Login autostart is the only OS-shaped piece (R7 D1: enabled) — idempotent by
 * design:
 *   - macOS: ensure `~/Library/LaunchAgents/com.deepseek.harness.dsh.plist`
 *     has `RunAtLoad = true` (preserving every other key). Launchd reads the
 *     file at next login, so no `launchctl` reload is required.
 *   - Windows: create/replace a per-user logon scheduled task
 *     `schtasks /Create /TN "DeepSeek Harness dsh web" /SC ONLOGON`.
 * Every other platform falls back to restart-without-autostart with a note.
 */

import { spawn, spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'

/** The launchd label / plist basename used by the official dsh web LaunchAgent. */
const MAC_PLIST_NAME = 'com.deepseek.harness.dsh.plist'
/** Logon-task name used for Windows autostart. */
const WIN_TASK_NAME = 'DeepSeek Harness dsh web'

/** Extract `--port <n>` from the process argv (defaults to 3080). */
export function currentPort(argv: readonly string[] = process.argv): string {
  const at = argv.indexOf('--port')
  const value = at >= 0 ? argv[at + 1] : undefined
  return typeof value === 'string' && value.length > 0 ? value : '3080'
}

/** The argv that launches this exact process again (execPath + everything after node). */
function relaunchArgv(): string[] {
  // process.argv = [node, dsh-bin, 'web', '--port', '3080'] -> drop argv[0] only:
  // process.execPath == argv[0].
  return process.argv.slice(1)
}

/**
 * Start the same command again, fully detached from this process (works on
 * POSIX and Windows). @returns the new pid, or 0 when spawn failed synchronously.
 */
export function relaunch(): number {
  const child = spawn(process.execPath, relaunchArgv(), {
    detached: true,
    stdio: 'ignore',
    shell: false,
    windowsHide: true,
    env: process.env,
  })
  if (typeof child.pid === 'number') child.unref()
  return child.pid ?? 0
}

/** Idempotent macOS login autostart: set RunAtLoad=true on the LaunchAgent plist. */
function ensureMacAutostart(): { ok: boolean; note?: string } {
  const dir = join(homedir(), 'Library', 'LaunchAgents')
  const file = join(dir, MAC_PLIST_NAME)
  try {
    if (existsSync(file)) {
      const plist = readFileSync(file, 'utf8')
      if (/\n\s*<key>RunAtLoad<\/key>\s*<true\s*\/>/.test(plist)) return { ok: true }
      const next = plist.replace(
        /(\n\s*)<key>RunAtLoad<\/key>\s*<(?:true|false)\s*\/>/,
        '$1<key>RunAtLoad</key>$1<true/>',
      )
      if (next === plist) {
        // Key missing entirely — insert right after the Label block.
        const patched = plist.replace(
          /(<key>Label<\/key>\s*<string>[^<]*<\/string>\s*)/,
          `$1        <key>RunAtLoad</key>\n        <true/>\n`,
        )
        writeFileSync(file, patched, 'utf8')
      } else {
        writeFileSync(file, next, 'utf8')
      }
      return { ok: true }
    }
    // No plist yet — author one for the current invocation (RunAtLoad = true).
    mkdirSync(dir, { recursive: true })
    const port = currentPort()
    const program = process.argv.slice(1).map((p) => `        <string>${escapeXml(p)}</string>`).join('\n')
    const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.deepseek.harness.dsh</string>
    <key>ProgramArguments</key>
    <array>
${program}
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>StandardOutPath</key>
    <string>${escapeXml(join(homedir(), 'dsh-web.log'))}</string>
    <key>StandardErrorPath</key>
    <string>${escapeXml(join(homedir(), 'dsh-web.log'))}</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
    </dict>
</dict>
</plist>
`
    writeFileSync(file, plist, 'utf8')
    return { ok: true, note: 'created (port ' + port + ')' }
  } catch (error) {
    return { ok: false, note: String(error) }
  }
}

/** Idempotent Windows login autostart via a per-user logon scheduled task. */
function ensureWinAutostart(): { ok: boolean; note?: string } {
  const command = [process.execPath, ...process.argv.slice(1)].map((p) => p.includes(' ') ? `"${p}"` : p).join(' ')
  const result = spawnSync('schtasks', [
    '/Create', '/TN', WIN_TASK_NAME, '/TR', command,
    '/SC', 'ONLOGON', '/F',
  ], { stdio: 'pipe', encoding: 'utf8', windowsHide: true, shell: false })
  return { ok: result.status === 0, note: (result.stderr?.trim() || result.stdout?.trim() || 'schtasks failed') }
}

/** Platform dispatch: register login autostart where supported, else pure restart note. */
export function ensureLoginAutostart(): { ok: boolean; note?: string } {
  if (process.platform === 'darwin') return ensureMacAutostart()
  if (process.platform === 'win32') return ensureWinAutostart()
  return { ok: false, note: `login autostart unsupported on ${process.platform}` }
}

function escapeXml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/**
 * The HTTP handler for /api/model-manager/restart.
 * POST answers the browser first (204), then: ensure login autostart, spawn
 * the detached same-command child, and finally exit the old process. The
 * client polls the origin and returns to the remembered URL once the new
 * instance is serving again. Non-POST gets 405 with the liveness body.
 */
export function handleRestartRequest(req: IncomingMessage, res: ServerResponse): void {
  if (req.method !== 'POST') {
    res.writeHead(405, { 'content-type': 'application/json' })
      .end(JSON.stringify({ ok: false, error: 'POST only', pid: process.pid }))
    return
  }
  res.writeHead(204).end()
  setTimeout(() => {
    let note: string | undefined
    try {
      const result = ensureLoginAutostart()
      note = result.ok ? result.note : `${result.note ?? ''} (restart proceeds without autostart)`
    } catch (error) {
      note = `autostart failed: ${String(error)}`
    }
    const pid = relaunch()
    if (note) console.log(`[dsh-model-manager] restart: autostart=${note} newPid=${pid || 'n/a'}`)
    // Give the detached child a moment to bind before we go away.
    setTimeout(() => process.exit(0), 700)
  }, 150)
}

/** GET /api/model-manager/restart — cheap liveness/probe (returns port + pid). */
export function handleRestartProbe(_req: IncomingMessage, res: ServerResponse): void {
  res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({
    ok: true,
    port: currentPort(),
    pid: process.pid,
  }))
}

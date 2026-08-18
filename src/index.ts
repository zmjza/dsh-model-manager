/**
 * @module dsh-model-manager
 *
 * Host plugin body.
 *
 * R1–R6 configuration rides the existing `llm-pi-ai` / `llm-deepseek` settings
 * namespaces (shared with the official Models page) and the credentials wire;
 * plugin-owned preferences such as model visibility live in `localStorage`.
 *
 * R7 (restart button) adds the host HTTP endpoint the client button `fetch`es
 * to restart the dsh web service. Restart is platform-neutral (spawn the same
 * command detached, then exit); login autostart is idempotently registered for
 * macOS (LaunchAgent `RunAtLoad`) and Windows (logon scheduled task).
 *
 * R9#2 (delete conversation) adds a second host endpoint that hard-deletes a
 * session's persisted directory (its event log + artifacts) from
 * `~/.dsh/sessions/<project>/<id>`, scoped to the exact session id (never a
 * project root or arbitrary path). Purely host-local, plugin-owned, no
 * harness source changes.
 */

import type { Context } from '@deepseek-ai/cordis'
// Pulls the cordis Context.webServer merge (declared by dsh-host-webserver).
import type {} from '@deepseek-ai/dsh-host-webserver'
import { handleRestartRequest } from './host/restart.ts'
import { handleDeleteSessionRequest } from './host/session-delete.ts'

/** Services this plugin needs before `apply` runs (webServer serves the routes). */
export const inject = ['webServer']

/**
 * Register this plugin's endpoints once the web server is up.
 *   POST /api/model-manager/restart        → autostart + spawn detached + exit old
 *   POST /api/model-manager/delete-session → hard-delete one session dir (R9#2)
 * @param ctx - host root context (services resolved).
 */
export function apply(ctx: Context): void {
  ctx.webServer.register({
    kind: 'exact',
    path: '/api/model-manager/restart',
    handler: handleRestartRequest,
  })
  ctx.webServer.register({
    kind: 'exact',
    path: '/api/model-manager/delete-session',
    handler: handleDeleteSessionRequest,
  })
}

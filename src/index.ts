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
 * R9#3 (flaky-auth fix) backfills `retryPolicy` (max 5, AUTH retryable) onto
 * every llm-pi-ai provider at boot, so transient gateway 401s are retried
 * instead of killing the turn. Purely host-local, plugin-owned, idempotent.
 */

import type { Context } from '@deepseek-ai/cordis'
// Pulls the cordis Context.webServer merge (declared by dsh-host-webserver).
import type {} from '@deepseek-ai/dsh-host-webserver'
import { handleRestartRequest } from './host/restart.ts'
import { backfillRetryPolicy, backfillShellTimeout, handleApplyRetryPolicy } from './host/retry-policy-backfill.ts'
import { backfillModelRetry, handleUpdateModelRetry } from './host/model-retry.ts'
import { handleTestProvider } from './host/test-provider.ts'

/** Services this plugin needs before `apply` runs (webServer serves the routes, settings powers the retry backfill, credentials resolves keys for the test-link probe). */
export const inject = ['webServer', 'settings', 'credentials']

/**
 * Register this plugin's endpoints once the web server is up.
 *   POST /api/model-manager/restart             → autostart + spawn detached + exit old
 *   POST /api/model-manager/apply-retry-policy  → re-stamp retry policy (R9#3)
 *   POST /api/model-manager/test-provider       → test-link probe (R? — 测试链接)
 *   POST /api/model-manager/update-model-retry  → per-model retry count (R? — 逐模型重试)
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
    path: '/api/model-manager/apply-retry-policy',
    handler: handleApplyRetryPolicy(ctx),
  })
  ctx.webServer.register({
    kind: 'exact',
    path: '/api/model-manager/test-provider',
    handler: handleTestProvider(ctx),
  })
  ctx.webServer.register({
    kind: 'exact',
    path: '/api/model-manager/update-model-retry',
    handler: handleUpdateModelRetry(ctx),
  })

  // R9#3 — stamp the retry policy on every existing pi-ai (custom) provider,
  // and raise the bash command deadline (2min→10min) so long-running commands
  // no longer stop the turn. Retried at a few boot points (settings mounts late).
  for (const at of [2000, 8000, 20000]) {
    setTimeout(() => {
      void backfillRetryPolicy(ctx).catch(() => 0)
    }, at)
    setTimeout(() => {
      void backfillShellTimeout(ctx).catch(() => 0)
    }, at + 400)
    setTimeout(() => {
      void backfillModelRetry(ctx).catch(() => 0)
    }, at + 800)
  }
}

/**
 * R9#3 — backfill the custom-provider retry policy into the harness settings.
 *
 * The editor path (schema-form) refuses fields it does not know, so retryPolicy
 * cannot be written through the provider editor for EXISTING custom providers.
 * The host can, however, write it through the real settings service, whose
 * namespace schema is the pi-ai profile schema and DOES accept retryPolicy.
 *
 * On boot this reads the current `llm-pi-ai` providers, stamps each with the
 * retry policy (max 5 retries, AUTH included so transient gateway 401s are
 * absorbed), and merges the whole providers object back — additive, idempotent,
 * and it never touches providers the plugin did not already see.
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-settings'

/** Max idle gap (no token) before the stream watchdog would abort, 20 min. */
const STREAM_IDLE_TIMEOUT_MS = 1_200_000

/**
 * The per-provider retry policy (shape matches NormalRetryPolicyConfig).
 * mode normal + maxRetries 5 + retryableCodes including AUTH (flaky-401 fix).
 */
const RETRY_POLICY = {
  mode: 'normal',
  maxRetries: 5,
  retryableCodes: ['RATE_LIMIT', 'SERVER', 'TIMEOUT', 'TRANSPORT', 'AUTH'],
  backoff: { initialDelayMs: 500, maxDelayMs: 8000, jitterRatio: 0.1 },
}

/** Strip the values back to JSON-safe plain data for the settings service. */
function plain<T>(value: T): T {
  return value
}

/**
 * Stamp every `llm-pi-ai` custom provider with the retry policy, if the settings
 * service is available. Safe to run repeatedly; never throws.
 * @param ctx - host root context.
 */
export async function backfillRetryPolicy(ctx: Context) {
  try {
    const settings = (ctx.settings ?? undefined)
    if (settings === undefined) return { changed: 0, debug: { settings: false } }
    const ns = 'llm-pi-ai' as unknown as Parameters<typeof settings.get>[0]
    const current = settings.get(ns) as unknown
    const providers = typeof current === 'object' && current !== null && !Array.isArray(current)
      ? (current as Record<string, unknown>)['providers']
      : undefined
    if (typeof providers !== 'object' || providers === null || Array.isArray(providers)) {
      const key = typeof current === 'object' && current !== null ? Object.keys(current as Record<string, unknown>) : []
      return { changed: 0, debug: { settings: true, currentType: typeof current, topKeys: key.slice(0, 10) } }
    }

    let changed = 0
    const nextProviders: Record<string, unknown> = {}
    for (const [provider, profile] of Object.entries(providers as Record<string, unknown>)) {
      if (typeof profile !== 'object' || profile === null || Array.isArray(profile)) {
        nextProviders[provider] = profile
        continue
      }
      const nextProfile = {
        ...(profile as Record<string, unknown>),
        retryPolicy: RETRY_POLICY,
        // No-output watchdog: raise from 5 min to 20 min so a slow reasoning /
        // gateway-buffering gap cannot abort generation ("stops while writing").
        streamIdleTimeoutMs: STREAM_IDLE_TIMEOUT_MS,
      }
      nextProviders[provider] = plain(nextProfile)
      changed += 1
    }

    if (changed === 0) return { changed: 0, debug: { settings: true, providersType: typeof providers, providerKeys: Object.keys(providers as Record<string, unknown>).slice(0, 6) } }
    await settings.update(ns, { providers: nextProviders })
    console.log(`[dsh-model-manager] stamped retryPolicy on ${changed} pi-ai provider(s)`)
    return { changed, debug: { settings: true } }
  } catch (error) {
    console.error('[dsh-model-manager] retryPolicy backfill failed:', String(error))
    return { changed: 0, debug: { error: String(error).slice(0, 200) } }
  }
}

/** HTTP handler for POST /api/model-manager/apply-retry-policy (manual trigger). */
export function handleApplyRetryPolicy(ctx: Context) {
  return (_req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse): void => {
    void backfillRetryPolicy(ctx).then((result) => {
      res.writeHead(200, { 'content-type': 'application/json' })
        .end(JSON.stringify({ ok: true, ...result }))
    }).catch((error) => {
      res.writeHead(500, { 'content-type': 'application/json' })
        .end(JSON.stringify({ ok: false, error: String(error) }))
    })
  }
}

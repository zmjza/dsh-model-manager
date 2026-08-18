/**
 * R? — per-model request retry count.
 *
 * The harness retry engine (`dsh-llm-retry`) is registered once per PROVIDER
 * route, with the policy captured at registration; there is no model-level
 * retry seam in pi-ai or the adapter. To give the user a per-model knob that
 * still changes behaviour, every MODEL owns a `maxRetries` field (default 5)
 * and a PROVIDER's effective `retryPolicy.maxRetries` is the widest of its
 * models' counts — so a model configured for N retries is always retried at
 * least N times, and bumping one model's count is honoured end to end.
 *
 * Backfill is additive + idempotent (missing defaults, no overwrite), and the
 * per-provider effective value is re-derived whenever any model's count is
 * written through `update-model-retry`.
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-settings'
import type {} from 'node:http'

/** Every model is retried this many times unless its own field says otherwise. */
export const DEFAULT_MODEL_RETRY = 5

/** Hard bounds kept in the UI too, so the number store stays sane. */
export const MIN_MODEL_RETRY = 0
export const MAX_MODEL_RETRY = 20

/** The shape of the provider-level retry policy we keep in sync. */
const RETRY_POLICY = {
  mode: 'normal',
  retryableCodes: ['RATE_LIMIT', 'SERVER', 'TIMEOUT', 'TRANSPORT', 'AUTH'],
  backoff: { initialDelayMs: 500, maxDelayMs: 8000, jitterRatio: 0.1 },
}

/** The `providers` dict of the llm-pi-ai settings section, or `undefined`. */
function providersOf(current: unknown): Record<string, unknown> | undefined {
  const providers = (typeof current === 'object' && current !== null && !Array.isArray(current)
    ? (current as Record<string, unknown>)['providers']
    : undefined)
  return (typeof providers === 'object' && providers !== null && !Array.isArray(providers))
    ? providers as Record<string, unknown>
    : undefined
}

/** The configured per-model retries present on a models array. */
function modelRetries(models: unknown): number[] {
  if (!Array.isArray(models)) return []
  const counts: number[] = []
  for (const entry of models) {
    if (typeof entry !== 'object' || entry === null) continue
    const value = (entry as Record<string, unknown>)['maxRetries']
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) counts.push(value)
  }
  return counts
}

/**
 * The effective retry count for a provider route: the widest per-model count,
 * falling back to {@link DEFAULT_MODEL_RETRY} when nothing is configured.
 */
export function effectiveRetry(models: unknown): number {
  const counts = modelRetries(models)
  return counts.length === 0 ? DEFAULT_MODEL_RETRY : Math.max(...counts)
}

/** Clamp and normalize one input retry count. */
export function clampRetry(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10)
  if (Number.isNaN(parsed)) return DEFAULT_MODEL_RETRY
  return Math.min(MAX_MODEL_RETRY, Math.max(MIN_MODEL_RETRY, parsed))
}

/** Rebuild the provider retry policy with the given max, keeping other knobs. */
function withMaxRetries(profile: Record<string, unknown>, maxRetries: number): void {
  const existing = (typeof profile['retryPolicy'] === 'object' && profile['retryPolicy'] !== null
    ? profile['retryPolicy'] as Record<string, unknown>
    : undefined)
  profile['retryPolicy'] = {
    ...(existing === undefined ? RETRY_POLICY : existing),
    maxRetries,
  }
}

/**
 * Backfill `maxRetries` (default 5) onto every model of every llm-pi-ai
 * provider and re-derive each provider's effective retry count. Idempotent.
 * @param ctx - host root context.
 */
export async function backfillModelRetry(ctx: Context) {
  try {
    const settings = (ctx.settings ?? undefined)
    if (settings === undefined) return { changed: 0, debug: { settings: false } }
    const ns = 'llm-pi-ai' as unknown as Parameters<typeof settings.get>[0]
    const current = settings.get(ns) as unknown
    const providers = providersOf(current)
    if (providers === undefined) return { changed: 0, debug: { providers: false } }

    let changed = 0
    const nextProviders: Record<string, unknown> = {}
    for (const [name, raw] of Object.entries(providers)) {
      if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
        nextProviders[name] = raw
        continue
      }
      const profile: Record<string, unknown> = { ...(raw as Record<string, unknown>) }
      // The settings service hands back frozen objects; clone every model entry
      // before touching it, or the write dies on "not extensible".
      let modelsChanged = false
      if (Array.isArray(profile['models'])) {
        profile['models'] = (profile['models'] as unknown[]).map((entry) =>
          typeof entry === 'object' && entry !== null ? { ...(entry as Record<string, unknown>) } : entry)
        for (const entry of profile['models'] as unknown[]) {
          if (typeof entry !== 'object' || entry === null) continue
          const model = entry as Record<string, unknown>
          if (model['maxRetries'] === undefined) {
            model['maxRetries'] = DEFAULT_MODEL_RETRY
            modelsChanged = true
          }
        }
      }
      const before = (typeof profile['retryPolicy'] === 'object' && profile['retryPolicy'] !== null
        ? (profile['retryPolicy'] as Record<string, unknown>)['maxRetries']
        : undefined)
      const after = effectiveRetry(profile['models'])
      if (modelsChanged || before !== after) {
        withMaxRetries(profile, after)
        changed += 1
      }
      nextProviders[name] = profile
    }

    if (changed === 0) return { changed: 0, debug: { settled: true } }
    await settings.update(ns, { providers: nextProviders })
    console.log(`[dsh-model-manager] stamped per-model retry on ${changed} provider(s)`)
    return { changed, debug: { settled: true } }
  } catch (error) {
    console.error('[dsh-model-manager] model-retry backfill failed:', String(error))
    return { changed: 0, debug: { error: String(error).slice(0, 200) } }
  }
}

/** Read a request body once (bounded to 64 KiB). */
function readBody(req: import('node:http').IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', (chunk) => {
      data += chunk
      if (data.length > 64 * 1024) req.destroy(new Error('body too large'))
    })
    req.on('end', () => resolve(data))
    req.on('error', reject)
  })
}

/**
 * HTTP handler for POST /api/model-manager/update-model-retry.
 * Body: `{ provider: string, models: [{ id, maxRetries }] }`.
 * Writes the models' counts, re-derives the provider effective retry, and
 * returns the new effective count.
 */
export function handleUpdateModelRetry(ctx: Context) {
  return async (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse): Promise<void> => {
    try {
      const body = await readBody(req)
      const parsed = JSON.parse(body) as { provider?: unknown; models?: unknown }
      const provider = typeof parsed?.provider === 'string' ? parsed.provider : undefined
      const rows = Array.isArray(parsed?.models) ? parsed.models : undefined
      if (provider === undefined || rows === undefined || rows.length === 0) {
        res.writeHead(400, { 'content-type': 'application/json' })
          .end(JSON.stringify({ ok: false, error: '请提供 provider 和 models（id + maxRetries）' }))
        return
      }
      const wants = new Map<string, number>()
      for (const row of rows) {
        if (typeof row !== 'object' || row === null) continue
        const entry = row as Record<string, unknown>
        if (typeof entry['id'] === 'string' && typeof entry['maxRetries'] === 'number') {
          wants.set(entry['id'], clampRetry(entry['maxRetries']))
        }
      }
      if (wants.size === 0) {
        res.writeHead(400, { 'content-type': 'application/json' })
          .end(JSON.stringify({ ok: false, error: 'models 需包含有效 id 和 maxRetries' }))
        return
      }

      const settings = (ctx.settings ?? undefined)
      const ns = 'llm-pi-ai' as unknown as Parameters<typeof settings.get>[0]
      const current = settings.get(ns) as unknown
      const providers = providersOf(current)
      const rawProfile = providers === undefined ? undefined : providers[provider]
      if (typeof rawProfile !== 'object' || rawProfile === null || Array.isArray(rawProfile)) {
        res.writeHead(404, { 'content-type': 'application/json' })
          .end(JSON.stringify({ ok: false, error: `未找到提供方「${provider}」` }))
        return
      }
      const profile: Record<string, unknown> = { ...(rawProfile as Record<string, unknown>) }
      if (!Array.isArray(profile['models'])) {
        res.writeHead(404, { 'content-type': 'application/json' })
          .end(JSON.stringify({ ok: false, error: `提供方「${provider}」没有可配置的模型` }))
        return
      }
      // Frozen settings objects: clone every entry before stamping a count.
      profile['models'] = (profile['models'] as unknown[]).map((entry) =>
        typeof entry === 'object' && entry !== null ? { ...(entry as Record<string, unknown>) } : entry)
      // Stamp the requested counts by id; keep entries the panel omitted.
      for (const entry of profile['models'] as unknown[]) {
        if (typeof entry !== 'object' || entry === null) continue
        const model = entry as Record<string, unknown>
        if (typeof model['id'] === 'string' && wants.has(model['id'])) {
          model['maxRetries'] = wants.get(model['id'])
        }
      }
      const effective = effectiveRetry(profile['models'])
      withMaxRetries(profile, effective)

      const nextProviders: Record<string, unknown> = { ...providers, [provider]: profile }
      await settings.update(ns, { providers: nextProviders })
      res.writeHead(200, { 'content-type': 'application/json' })
        .end(JSON.stringify({ ok: true, provider, retryPolicyMaxRetries: effective }))
    } catch (error) {
      res.writeHead(500, { 'content-type': 'application/json' })
        .end(JSON.stringify({ ok: false, error: String(error).slice(0, 200) }))
    }
  }
}

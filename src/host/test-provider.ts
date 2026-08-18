/**
 * R? — 「测试连通性」: probe one configured pi-ai provider by sending a real,
 * STREAMED minimal request over the provider's own wire protocol, and push the
 * outcome back to the client live as server-sent events — mirroring how gateway
 * consoles like sub2api run account tests.
 *
 * Streaming is the point: `stream: true` + a bounded read means the client
 * shows 「已连接到 API」 the moment the first byte flows, the reply prints as it
 * streams, and the probe short-circuits after a handful of content deltas — so
 * a slow/large Claude model no longer makes the test block until a full
 * response is generated (the non-streaming behaviour that read as 巨慢).
 *
 * The key is resolved through the harness credential seam (ctx.credentials),
 * never shown and never logged.
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-credentials'
import { credentialRef } from '@deepseek-ai/dsh-credentials'

/** One probe may wait up to this long before it is reported as a timeout. */
const PROBE_TIMEOUT_MS = 20_000

/** Stop streaming once this many content deltas arrived — enough to prove the
 *  route is live and show a legible reply, without waiting for full output. */
const MAX_CONTENT_DELTAS = 16

/** Hard cap on the echoed reply length shown in the console. */
const MAX_REPLY_CHARS = 400

/**
 * Defaults pi-ai ships for its built-in provider routes, so a connectivity test
 * still works when the user did not enter a base URL (a built-in route's
 * endpoint lives in the catalog, not the settings profile). Mirrors
 * `getBuiltinModels(route)[0]`; entries whose endpoint has placeholder or is
 * empty are refused at probe time with a clear message.
 */
const PI_BUILTIN: Readonly<Record<string, { baseUrl?: string; api?: string; model?: string }>> = {
  'amazon-bedrock': { baseUrl: 'https://bedrock-runtime.us-east-1.amazonaws.com', api: 'bedrock-converse-stream', model: 'amazon.nova-2-lite-v1:0' },
  'ant-ling': { baseUrl: 'https://api.ant-ling.com/v1', api: 'openai-completions', model: 'Ling-2.6-1T' },
  anthropic: { baseUrl: 'https://api.anthropic.com', api: 'anthropic-messages', model: 'claude-fable-5' },
  cerebras: { baseUrl: 'https://api.cerebras.ai/v1', api: 'openai-completions', model: 'gemma-4-31b' },
  'cloudflare-ai-gateway': { baseUrl: 'https://gateway.ai.cloudflare.com/v1/{CLOUDFLARE_ACCOUNT_ID}/{CLOUDFLARE_GATEWAY_ID}/anthropic', api: 'anthropic-messages', model: 'claude-3-5-haiku' },
  'cloudflare-workers-ai': { baseUrl: 'https://api.cloudflare.com/client/v4/accounts/{CLOUDFLARE_ACCOUNT_ID}/ai/v1', api: 'openai-completions', model: '@cf/google/gemma-4-26b-a4b-it' },
  deepseek: { baseUrl: 'https://api.deepseek.com', api: 'openai-completions', model: 'deepseek-v4-flash' },
  fireworks: { baseUrl: 'https://api.fireworks.ai/inference', api: 'anthropic-messages', model: 'accounts/fireworks/models/deepseek-v4-flash' },
  'github-copilot': { baseUrl: 'https://api.individual.githubcopilot.com', api: 'anthropic-messages', model: 'claude-haiku-4.5' },
  google: { baseUrl: 'https://generativelanguage.googleapis.com/v1beta', api: 'google-generative-ai', model: 'deep-research-max-preview-04-2026' },
  'google-vertex': { baseUrl: 'https://{location}-aiplatform.googleapis.com', api: 'google-vertex' },
  groq: { baseUrl: 'https://api.groq.com/openai/v1', api: 'openai-completions', model: 'llama-3.1-8b-instant' },
  huggingface: { baseUrl: 'https://router.huggingface.co/v1', api: 'openai-completions', model: 'MiniMaxAI/MiniMax-M2' },
  'kimi-coding': { baseUrl: 'https://api.kimi.com/coding', api: 'anthropic-messages', model: 'k3' },
  minimax: { baseUrl: 'https://api.minimax.io/anthropic', api: 'anthropic-messages', model: 'MiniMax-M2.7' },
  'minimax-cn': { baseUrl: 'https://api.minimaxi.com/anthropic', api: 'anthropic-messages', model: 'MiniMax-M2.7' },
  mistral: { baseUrl: 'https://api.mistral.ai', api: 'mistral-conversations', model: 'codestral-latest' },
  moonshotai: { baseUrl: 'https://api.moonshot.ai/v1', api: 'openai-completions', model: 'kimi-k2-0711-preview' },
  'moonshotai-cn': { baseUrl: 'https://api.moonshot.cn/v1', api: 'openai-completions', model: 'kimi-k2-0711-preview' },
  nvidia: { baseUrl: 'https://integrate.api.nvidia.com/v1', api: 'openai-completions', model: 'meta/llama-3.1-70b-instruct' },
  openai: { baseUrl: 'https://api.openai.com/v1', api: 'openai-responses', model: 'gpt-4' },
  'openai-codex': { baseUrl: 'https://chatgpt.com/backend-api', api: 'openai-codex-responses' },
  opencode: { baseUrl: 'https://opencode.ai/zen', api: 'anthropic-messages', model: 'claude-fable-5' },
  'opencode-go': { baseUrl: 'https://opencode.ai/zen/go', api: 'anthropic-messages', model: 'minimax-m3' },
  openrouter: { baseUrl: 'https://openrouter.ai/api/v1', api: 'openai-completions', model: 'ai21/jamba-large-1.7' },
  'qwen-token-plan': { baseUrl: 'https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1', api: 'openai-completions', model: 'MiniMax-M2.5' },
  'qwen-token-plan-cn': { baseUrl: 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1', api: 'openai-completions', model: 'MiniMax-M2.5' },
  together: { baseUrl: 'https://api.together.ai/v1', api: 'openai-completions', model: 'MiniMaxAI/MiniMax-M2.7' },
  'vercel-ai-gateway': { baseUrl: 'https://ai-gateway.vercel.sh', api: 'anthropic-messages', model: 'alibaba/qwen-3-14b' },
  xai: { baseUrl: 'https://api.x.ai/v1', api: 'openai-completions', model: 'grok-4.3' },
  xiaomi: { baseUrl: 'https://api.xiaomimimo.com/v1', api: 'openai-completions', model: 'mimo-v2-flash' },
  'xiaomi-token-plan-ams': { baseUrl: 'https://token-plan-ams.xiaomimimo.com/v1', api: 'openai-completions', model: 'mimo-v2-pro' },
  'xiaomi-token-plan-cn': { baseUrl: 'https://token-plan-cn.xiaomimimo.com/v1', api: 'openai-completions', model: 'mimo-v2-pro' },
  'xiaomi-token-plan-sgp': { baseUrl: 'https://token-plan-sgp.xiaomimimo.com/v1', api: 'openai-completions', model: 'mimo-v2-pro' },
  zai: { baseUrl: 'https://api.z.ai/api/coding/paas/v4', api: 'openai-completions', model: 'glm-4.5-air' },
  'zai-coding-cn': { baseUrl: 'https://open.bigmodel.cn/api/coding/paas/v4', api: 'openai-completions', model: 'glm-4.5-air' },
}

/** A non-empty string, or `undefined`. */
function textOf(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value.trim() : undefined
}

/** Extract the assistant text delta from one SSE JSON payload, any protocol. */
function sseDeltaText(payload: unknown): string | undefined {
  if (typeof payload !== 'object' || payload === null) return undefined
  const record = payload as Record<string, unknown>
  // anthropic-messages: { type:"content_block_delta", delta:{ text } }
  const type = typeof record['type'] === 'string' ? record['type'] : ''
  if (type === 'content_block_delta') {
    const delta = record['delta']
    if (typeof delta === 'object' && delta !== null) {
      const text = textOf((delta as Record<string, unknown>)['text'])
      if (text !== undefined) return text
    }
  }
  // openai-responses: { type:"response.output_text.delta", delta:"…" }
  if (type.startsWith('response.output_text') && typeof record['delta'] === 'string') {
    return record['delta']
  }
  // openai-completions: { choices:[{ delta:{ content } }] }
  const choices = record['choices']
  if (Array.isArray(choices)) {
    for (const choice of choices) {
      if (typeof choice === 'object' && choice !== null) {
        const delta = (choice as Record<string, unknown>)['delta']
        if (typeof delta === 'object' && delta !== null) {
          const content = textOf((delta as Record<string, unknown>)['content'])
          if (content !== undefined) return content
        }
      }
    }
  }
  return undefined
}

/** Build the streamed probe request for the provider's protocol. */
async function streamProbe(
  baseURL: string,
  api: string,
  model: string,
  key: string | undefined,
  onEvent: (name: string, data: Record<string, unknown>) => void,
): Promise<void> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS)
  let reply = ''
  let contentDeltas = 0
  try {
    const base = baseURL.replace(/\/+$/, '')
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      accept: 'text/event-stream',
      // The host process pools keep-alive connections; a stale pooled socket to
      // a slow relay made probes hang on reads after headers. Each probe opens a
      // fresh connection so the test mirrors a cold client and never inherits a
      // half-dead socket from an earlier request.
      connection: 'close',
    }
    const body: Record<string, unknown> = { model, stream: true, max_tokens: 32 }
    let url: string
    if (api === 'anthropic-messages') {
      url = `${base}/v1/messages`
      body['messages'] = [{ role: 'user', content: 'hi' }]
      body['temperature'] = 1
      headers['anthropic-version'] = '2023-06-01'
    } else if (api === 'openai-responses') {
      url = `${base}/responses`
      body['input'] = 'hi'
      body['max_output_tokens'] = 32
    } else {
      // openai-completions and any unknown protocol default to chat completions.
      url = `${base}/chat/completions`
      body['messages'] = [{ role: 'user', content: 'hi' }]
    }
    // Anthropic-wire providers authenticate with `x-api-key` (mirroring the
    // pi-ai client), which is what opencode zen and some relays expect; the
    // OpenAI family uses `Authorization: Bearer`. Sending Bearer to an
    // anthropic gateway that only reads x-api-key answers 401 even when the
    // key is valid — exactly the false failure seen on opencode-go.
    if (key !== undefined) {
      if (api === 'anthropic-messages') headers['x-api-key'] = key
      else headers['authorization'] = `Bearer ${key}`
    }

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    // The route is reachable and answered this far; reflect the first byte
    // before deciding success — this is what makes the test feel instant.
    onEvent('connected', {})
    if (!response.ok) {
      const responseText = await response.text().catch(() => '')
      const status = response.status
      if (status === 401 || status === 403) throw new Error(`AUTH:${status}`)
      if (status === 404) {
        const lower = responseText.toLowerCase()
        throw new Error(lower.includes('model') ? `MODEL:404` : 'ENDPOINT:404')
      }
      const snippet = responseText.replace(/\s+/g, ' ').slice(0, 140)
      throw new Error(`HTTP ${status} · ${snippet}`)
    }
    if (response.body === null) throw new Error('NETWORK:empty body')

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let index: number
      while ((index = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, index).trim()
        buffer = buffer.slice(index + 1)
        if (!line.startsWith('data:')) continue
        const payload = line.slice(5).trim()
        if (payload === '[DONE]') {
          break
        }
        let parsed: unknown
        try { parsed = JSON.parse(payload) } catch { continue }
        const delta = sseDeltaText(parsed)
        if (delta !== undefined) {
          onEvent('content', { text: delta })
          reply += delta
          contentDeltas += 1
          if (contentDeltas >= MAX_CONTENT_DELTAS || reply.length >= MAX_REPLY_CHARS) break
        }
      }
      if (contentDeltas >= MAX_CONTENT_DELTAS || reply.length >= MAX_REPLY_CHARS) break
    }
    // A connected stream with zero text is still a live route; treat as done.
    onEvent('complete', {
      reply: reply.slice(0, MAX_REPLY_CHARS),
      ...reply.length === 0 ? {} : { text: reply.slice(0, MAX_REPLY_CHARS) },
    })
  } catch (error) {
    // Already consumed inside streamProbe? No — errors bubble to the caller.
    throw error
  } finally {
    clearTimeout(timer)
    controller.abort()
  }
}

/**
 * HTTP handler (server-sent events) for POST /api/model-manager/test-provider.
 * Body: `{ provider, model? }`. Pushes `connected`, `content`, `complete` /
 * `error` events back to the modal console.
 */
export function handleTestProvider(ctx: Context) {
  return (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse): void => {
    let body = ''
    req.on('data', (chunk) => { body += chunk })
    req.on('end', () => {
      let provider: string | undefined
      let model: string | undefined
      try {
        const parsed = JSON.parse(body) as { provider?: unknown; model?: unknown }
        if (typeof parsed?.provider === 'string') provider = parsed.provider
        if (typeof parsed?.model === 'string' && parsed.model.length > 0) model = parsed.model
      } catch { /* malformed → reported below */ }
      void runTest(ctx, provider, model, res)
    })
  }
}

async function runTest(
  ctx: Context,
  provider: string | undefined,
  model: string | undefined,
  res: import('node:http').ServerResponse,
): Promise<void> {
  const send = (name: string, data: Record<string, unknown>): void => {
    if (res.writableEnded) return
    res.write(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`)
  }
  const fail = (code: number, message: string): void => {
    try {
      res.writeHead(code, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ ok: false, error: message }))
    } catch { /* already written headers */ }
  }
  if (provider === undefined || provider.length === 0) {
    fail(400, '请提供 provider 路由')
    return
  }

  let key: string | undefined
  let api = 'openai-completions'
  let baseURL: string | undefined
  let probeModel: string | undefined
  try {
    const settings = (ctx.settings ?? undefined)
    if (settings === undefined) throw new Error('settings service unavailable')
    const ns = 'llm-pi-ai' as unknown as Parameters<typeof settings.get>[0]
    const current = settings.get(ns) as unknown
    const providers = (typeof current === 'object' && current !== null && !Array.isArray(current)
      ? (current as Record<string, unknown>)['providers']
      : undefined)
    const rawProfile = (typeof providers === 'object' && providers !== null && !Array.isArray(providers)
      ? (providers as Record<string, unknown>)[provider]
      : undefined)
    // A route may be a pure catalog built-in with no settings entry at all —
    // allow that and rely on the catalog defaults below.
    if (rawProfile !== undefined && (typeof rawProfile !== 'object' || rawProfile === null || Array.isArray(rawProfile))) {
      throw new Error('PROVIDER_MISSING')
    }
    const profile = rawProfile === undefined ? {} : rawProfile as Record<string, unknown>
    const builtin = PI_BUILTIN[provider]
    // A built-in route's endpoint/api/models live in the catalog — pull them in
    // when the user did not override them, so 内置模型 without a typed base URL
    // are still testable (R: 自动提取内置默认地址).
    baseURL = textOf(profile['baseURL']) ?? builtin?.baseUrl
    if (baseURL === undefined) throw new Error('NO_BASEURL')
    if (baseURL.includes('{')) throw new Error('BASEURL_PLACEHOLDER')
    probeModel = textOf(model)
    if (probeModel === undefined) {
      const models = profile['models']
      if (Array.isArray(models)) {
        for (const entry of models) {
          if (typeof entry === 'object' && entry !== null && typeof (entry as { id?: unknown }).id === 'string') {
            const id = (entry as { id: string }).id
            if (id.length > 0) { probeModel = id; break }
          }
        }
      }
    }
    if (probeModel === undefined) probeModel = builtin?.model
    if (probeModel === undefined) throw new Error('NO_MODELS')
    api = textOf(profile['api']) ?? builtin?.api ?? 'openai-completions'

    const keyEnv = textOf(profile['apiKeyEnv'])
    if (keyEnv !== undefined) {
      const credentials = ctx.credentials as unknown as
        | { resolve(ref: ReturnType<typeof credentialRef>): Promise<{ value: string } | undefined> }
        | undefined
      if (credentials !== undefined) {
        const resolved = await credentials.resolve(credentialRef(keyEnv)).catch(() => undefined)
        key = resolved?.value
      }
    }
  } catch (error) {
    const reason = String(error)
    fail(400, reason === 'NO_BASEURL' ? '该提供方未配置 API 地址' : reason === 'BASEURL_PLACEHOLDER' ? '该内置提供方的地址含账号占位符，请先在编辑中填写实际 API 地址' : reason === 'NO_MODELS' ? '该提供方没有模型' : reason === 'PROVIDER_MISSING' ? `未找到提供方「${provider}」` : `读取配置失败: ${reason}`)
    return
  }

  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  })
  res.flushHeaders?.()

  const startedAt = Date.now()
  try {
    await streamProbe(baseURL!, api, probeModel!, key, send)
    const latencyMs = Date.now() - startedAt
    if (!res.writableEnded) {
      send('latency', { ms: latencyMs, model: probeModel })
      res.end()
    }
  } catch (error) {
    const latencyMs = Date.now() - startedAt
    const reason = String(error)
    const name = error instanceof Error ? error.name : ''
    let kind = 'invalid'
    let detail = reason
    if (name === 'AbortError' || name === 'TimeoutError' || reason.startsWith('TimeoutError')) {
      kind = 'timeout'; detail = `超过 ${PROBE_TIMEOUT_MS / 1000}s`
    } else if (reason.startsWith('AUTH:')) {
      kind = 'auth'; detail = reason
    } else {
      kind = 'network'
    }
    if (!res.writableEnded) {
      send('error', { kind, detail, latencyMs, model: probeModel })
      res.end()
    }
  }
}

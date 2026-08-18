/**
 * Multimodal family defaults for custom providers.
 *
 * The harness gates image-capable sessions on a model's resolved
 * `inputModalities` (pi-ai surfaces its `input` array; the gate rejects
 * `inputModalities` that exist but omit `'image'`). Anthropic (claude),
 * OpenAI (gpt), Google (gemini) and xAI (grok) families are all multimodal
 * (text + image; files ride the attachment channel), so any custom-provider
 * model whose id/name belongs to one of these families gets
 * `input: ['text', 'image']` written into its profile record. The modal
 * vocabulary is only `text | image`, so this is the maximum the platform
 * can express.
 */

/** Lowercase leading-token match: claude / gpt / gemini / grok (+ separators). */
const FAMILY_RE = /^(claude|gpt|gemini|grok)([-_.:\d]|$)/

/** Whether a model belongs to a known multimodal vendor family. */
export function isMultimodalFamily(model: Record<string, unknown>): boolean {
  const id = typeof model.id === 'string' ? model.id.toLowerCase() : ''
  const name = typeof model.name === 'string' ? model.name.toLowerCase() : ''
  return FAMILY_RE.test(id) || FAMILY_RE.test(name)
}

/** The modality set every member of the four families accepts. */
export const MULTIMODAL_INPUT: readonly ['text', 'image'] = ['text', 'image']

/**
 * Return a copy of the model record with multimodal `input` when it belongs to
 * a multimodal family and does not already declare image input. Non-family
 * models (e.g. DeepSeek) are returned untouched.
 * @param model - the pi-ai profile model record (structurally open).
 * @returns the (possibly extended) record.
 */
export function ensureMultimodalInput<T extends Record<string, unknown>>(model: T): T {
  if (!isMultimodalFamily(model)) return model
  const existing = model['input']
  if (Array.isArray(existing) && existing.includes('image')) return model
  return { ...model, input: ['text', 'image'] }
}

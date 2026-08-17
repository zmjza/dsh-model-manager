/**
 * Name-based thinking-level inference for models whose advertised efforts are
 * unknown — a custom gateway, a route not yet registered, or an endpoint that
 * does not disclose reasoning. When the `llm.models` probe finds nothing, these
 * rules infer the selectable levels from the model's name so common families are
 * prefilled instead of left empty.
 *
 * The level sets below were re-verified against the official vendor docs on
 * 2026-08-18 (v5 R2, conservative policy — only model lines the official docs
 * actually expose keep a level set; anything undocumented is left empty so the
 * user picks by hand rather than being handed a guess):
 *
 * - OpenAI GPT-5.x (gpt-5.5 / gpt-5.6 …): low/medium/high/xhigh/max — the
 *   "Reasoning models" guide lists none|minimal|low|medium|high|xhigh|max as
 *   model-dependent; we keep low…max and conservatively drop "none"/"minimal".
 *   https://developers.openai.com/api/docs/guides/reasoning
 * - OpenAI o-series (o1/o3/o4): minimal/medium/high — the classic o-series
 *   reasoning_effort trio, unchanged by the guide above.
 * - Anthropic Claude (4.6+, 5-series): low/medium/high/xhigh/max — the official
 *   "Effort" parameter ladder is max/xhigh/high/default/medium/low; there is NO
 *   "minimal" in the Anthropic effort ladder, so it was removed (v5 claimed 6
 *   levels). Only model lines the Effort docs list as supporting the parameter
 *   are matched (Sonnet/Opus 4.6+ and the 5-series Fable/Mythos/Opus/Sonnet);
 *   older Claude (3.x) used budget_tokens and is left empty.
 *   https://platform.claude.com/docs/en/build-with-claude/effort
 * - DeepSeek V4 (deepseek-v4-flash / deepseek-v4-pro): low/high/max — the
 *   Thinking Mode guide documents `reasoning_effort: low/high/max`
 *   (medium and xhigh are mapped onto high). R1 has no documented effort X
 *   parameter and is left empty.
 *   https://api-docs.deepseek.com/guides/thinking_mode
 *
 * Everything else stays empty on purpose:
 * - Google Gemini (gemini-3 / 2.5) — thinking is budget-driven
 *   (`thinkingConfig` budget / Interactions thought steps), no effort ladder.
 *   https://ai.google.dev/gemini-api/docs/thinking
 * - xAI Grok (grok-4.6 …) — the model card only says "configurable reasoning",
 *   no documented level ladder. https://docs.x.ai/docs/models
 * - Qwen / QwQ, Llama — not documented with a reasoning-effort ladder on the
 *   OpenAI-compatible surface. Add families here ONLY when backed by a concrete
 *   official doc fact.
 */

import type { ThinkingLevel } from './DeepSeekModelsEditor.tsx'

/** A keyword matcher acting on the lowercased model id + display name. */
interface EffortRule {
  /** Substring(s) any of which identify the family. */
  match: readonly string[]
  /** Levels the family supports, in escalation order (no `off`). */
  levels: readonly ThinkingLevel[]
}

/** OpenAI GPT-5.x reasoning models: "none"…"max" (we keep low…max). */
const LEVELS_GPT = ['low', 'medium', 'high', 'xhigh', 'max'] as const
/** OpenAI o-series reasoning effort trio (minimal/medium/high). */
const LEVELS_OSERIES = ['minimal', 'medium', 'high'] as const
/** Anthropic Claude effort ladder — max/xhigh/high/medium/low, no "minimal". */
const LEVELS_CLAUDE = ['low', 'medium', 'high', 'xhigh', 'max'] as const
/** DeepSeek V4 thinking effort — docs expose low/high/max. */
const LEVELS_DEEPSEEK = ['low', 'high', 'max'] as const

const RULES: readonly EffortRule[] = [
  // o-series: reasoning by construction (o1/o3/o4-mini). No family gate — the
  // token itself is the signal.
  { match: ['o1', 'o3', 'o4'], levels: LEVELS_OSERIES },
  // GPT-5.x (gpt-5.5/5.6, gpt5X, gpt-5.x). Not bare gpt-4o/4.5/4.1 (those don't
  // expose the extended effort ladder).
  { match: ['gpt-5', 'gpt5'], levels: LEVELS_GPT },
  // Claude families the official Effort docs list as supporting the parameter:
  // Opus/Sonnet 4.6+ and the 5-series Fable/Mythos/Opus/Sonnet. Older Claude is
  // left empty (budget-based thinking, no effort param).
  {
    match: [
      'claude-fable', 'claude-mythos',
      'claude-opus-5', 'claude-sonnet-5', 'claude-5', 'claude5',
      'claude-opus-4.6', 'claude-opus-4.7', 'claude-opus-4.8',
      'claude-sonnet-4.6',
    ],
    levels: LEVELS_CLAUDE,
  },
  // DeepSeek V4 thinking mode (reasoning_effort: low/high/max). R1 is not
  // matched — it has no documented effort parameter on this surface.
  { match: ['deepseek-v4'], levels: LEVELS_DEEPSEEK },
]

/** Normalize a model identity for matching. */
function normalize(name: string): string {
  return name.toLowerCase().replace(/[\s_]+/g, '-').replace(/-+/g, '-')
}

/** Match the first rule whose token appears in either the id or the name. */
export function inferEfforts(modelId: string, displayName: string | undefined): readonly ThinkingLevel[] {
  const haystack = `${normalize(modelId)} ${normalize(displayName ?? '')}`
  for (const rule of RULES) {
    const familyHit = rule.match.some(token => haystack.includes(token))
    if (!familyHit) continue
    return rule.levels
  }
  return []
}

/** Whether inference produced a non-empty level set for this model identity. */
export function canInferEfforts(modelId: string, displayName: string | undefined): boolean {
  return inferEfforts(modelId, displayName).length > 0
}

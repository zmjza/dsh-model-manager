/**
 * Name-based thinking-level inference for models whose advertised efforts are
 * unknown — a custom gateway, a route not yet registered, or an endpoint that
 * does not disclose reasoning. When the fabricated `llm.models` probe finds
 * nothing, these rules infer the selectable levels from the model's name so
 * common families are prefilled instead of left empty.
 *
 * Rules are matched from most-specific to least-specific: a family's keyword
 * plus a version constraint wins over the bare family, so "gpt-5.6" is
 * recognized as a reasoning-capable GPT while an early "gpt-3.5" is not.
 */

import type { ThinkingLevel } from './DeepSeekModelsEditor.tsx'

/** A keyword matcher acting on the lowercased model id + display name. */
interface EffortRule {
  /** Substring(s) any of which identify the family. */
  match: readonly string[]
  /** Levels the family supports, in escalation order (no `off`). */
  levels: readonly ThinkingLevel[]
}

/** Reasoning-capable GPT models (GPT-4.1+, GPT-5, o-series, gpt-reasoner). */
const LEVELS_GPT = ['minimal', 'low', 'medium', 'high'] as const
/** Anthropic Claude: thinking budget levels. */
const LEVELS_CLAUDE = ['low', 'medium', 'high'] as const
/** DeepSeek reasoner models (R1/V3.1/V4 thinking). */
const LEVELS_DEEPSEEK = ['high', 'max'] as const
/** Google Gemini thinking models. */
const LEVELS_GEMINI = ['low', 'medium', 'high'] as const
/** OpenAI o-series reasoning effort. */
const LEVELS_OSERIES = ['minimal', 'medium', 'high'] as const
/** xAI Grok reasoning. */
const LEVELS_GROK = ['low', 'medium', 'high'] as const
/** Qwen with thinking (QwQ / Qwen3). */
const LEVELS_QWEN = ['low', 'medium', 'high'] as const

const RULES: readonly EffortRule[] = [
  // o-series: reasoning by construction (o1/o3/o4-mini). No family gate — the
  // token itself is the signal.
  { match: ['o1', 'o3', 'o4'], levels: LEVELS_OSERIES },
  // Explicit reasoning-capable GPT generations (4o and later). 4o and 4o-mini
  // ship reasoning_effort low/medium/high; earlier 3.x models predate it.
  { match: ['gpt-5', 'gpt5', 'gpt-4.1', 'gpt-4.5', 'gpt-o', 'reasoner', 'gpt-4o'], levels: LEVELS_GPT },
  // Claude: models at or after Claude 3.5 carry extended thinking.
  { match: ['claude'], levels: LEVELS_CLAUDE },
  // DeepSeek reasoning models.
  { match: ['deepseek-reasoner', 'deepseek-r1', 'deepseek-v3.1', 'deepseek-v4'], levels: LEVELS_DEEPSEEK },
  // Gemini 2.5 thinking.
  { match: ['gemini-2.5'], levels: LEVELS_GEMINI },
  // Grok reasoning.
  { match: ['grok-3', 'grok 3'], levels: LEVELS_GROK },
  // Qwen thinking / QwQ.
  { match: ['qwq', 'qwen3'], levels: LEVELS_QWEN },
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

/**
 * Shared per-model reasoning-effort editor: the available thinking levels a
 * model supports (its `reasoningEfforts`), edited as a multi-select inside a
 * model row's disclosure, with an optional auto-detect button that reads a
 * registered route's advertised efforts from `llm.models`.
 */

import { useState } from 'react'
import type { ReactNode } from 'react'
import type { IApiClient } from '@deepseek-ai/dsh-api-remotes/client'
import {
  modelEfforts, THINKING_LEVELS, withModelEfforts,
  type DeepSeekModelDraft, type ThinkingLevel,
} from './DeepSeekModelsEditor.tsx'
import { messageOf } from './store.ts'
import type { en } from './locales.ts'
import styles from './ModelsSection.module.css'

/** Props of {@link ReasoningEffortEditor}. */
export interface ReasoningEffortEditorProps {
  /** The model row being edited. */
  model: DeepSeekModelDraft
  /** Row position, for aria labels and array writes. */
  index: number
  /** The whole drafted rows array (parent owns it). */
  models: readonly DeepSeekModelDraft[]
  /** Replace the drafted rows array (parent's onChange). */
  onChange: (models: DeepSeekModelDraft[]) => void
  /** Wire face for `llm.models` auto-detection, when offered. */
  api?: Pick<IApiClient, 'llm'>
  /** Route whose advertised efforts auto-detect reads, when known. */
  provider?: string
  /** Section copy. */
  t: (key: keyof typeof en) => string
  /** Disable every control. */
  disabled: boolean
}

/** Map a detected opaque effort id to a known THINKING_LEVELS entry. */
function levelOf(id: string): ThinkingLevel | undefined {
  const lookup = id.toLowerCase().replace(/[\s-]+/g, '')
  return THINKING_LEVELS.find(level => level.toLowerCase() === lookup)
}

/**
 * Render the reasoning-effort editor for one model row.
 * @param props - the row, the parent array, and optional auto-detect.
 * @returns the effort multi-select, plus a detect action when api+provider
 *   were supplied.
 */
export function ReasoningEffortEditor(props: ReasoningEffortEditorProps): ReactNode {
  const { model, index, models, onChange, api, provider, t, disabled } = props
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | undefined>(undefined)

  const selected = modelEfforts(model)
  const applyEfforts = (levels: readonly ThinkingLevel[]): void => {
    onChange(models.map((row, at) => at === index ? withModelEfforts(row, levels) : row))
  }
  const toggle = (level: ThinkingLevel): void => {
    const next = selected.includes(level)
      ? selected.filter(candidate => candidate !== level)
      : [...THINKING_LEVELS.filter(candidate => selected.includes(candidate) || candidate === level)]
    // `off` is a dispatch nuance, not a selectable level: a model that only
    // "supports off" carries no reasoningEfforts (non-reasoning).
    applyEfforts(next.filter(candidate => candidate !== 'off'))
  }

  const detect = async (): Promise<void> => {
    if (api === undefined || provider === undefined) return
    const id = typeof model['id'] === 'string' ? model['id'] : ''
    if (id.length === 0) return
    setBusy(true)
    setFailure(undefined)
    try {
      const response = await api.llm.models({})
      if (!response.result.ok) throw new Error(response.result.error.message)
      const group = response.result.value.groups.find(candidate => candidate.id === provider)
      const found = group?.models.find(candidate => candidate.id === id)
      const efforts = found?.reasoning?.efforts ?? []
      const levels = efforts
        .map(effort => levelOf(effort.id))
        .filter((level): level is ThinkingLevel => level !== undefined)
      // Deduplicate in escalation order; `off` alone leaves the model without
      // reasoningEfforts (non-reasoning), exactly like an empty selection.
      const unique = [...new Set(levels)].filter(level => level !== 'off')
      if (unique.length > 0) applyEfforts(unique)
      else setFailure(t('effortDetectNone'))
    } catch (error) {
      setFailure(messageOf(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={styles['modelField']} role="group" aria-label={t('thinkingLevels')}>
      <span className={styles['modelFieldLabel']}>{t('thinkingLevels')}</span>
      <div className={styles['effortGrid']}>
        {THINKING_LEVELS.slice(1).map(level => {
          const checked = selected.includes(level)
          return (
            <label key={level} className={styles['effortChoice']}>
              <input
                type="checkbox"
                checked={checked}
                disabled={disabled}
                onChange={() => { toggle(level) }}
              />
              <span>{level}</span>
            </label>
          )
        })}
        {api !== undefined && provider !== undefined ? (
          <button
            type="button"
            className={styles['linkButton']}
            disabled={disabled || busy}
            onClick={() => { void detect() }}
          >
            {busy ? t('effortDetecting') : t('effortDetect')}
          </button>
        ) : null}
      </div>
      {failure === undefined ? null : <p className={styles['error']}>{failure}</p>}
    </div>
  )
}

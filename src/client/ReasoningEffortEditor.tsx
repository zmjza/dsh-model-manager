/**
 * Shared per-model reasoning-effort editor: the available thinking levels a
 * model supports (its `reasoningEfforts`), edited as a multi-select inside a
 * model row's disclosure, with an optional auto-detect button that reads a
 * registered route's advertised efforts from `llm.models`.
 */

import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { IApiClient } from '@deepseek-ai/dsh-api-remotes/client'
import {
  modelEfforts, THINKING_LEVELS, withModelEfforts,
  type DeepSeekModelDraft, type ThinkingLevel,
} from './DeepSeekModelsEditor.tsx'
import { inferEfforts } from './model-efforts.ts'
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

  const modelId = typeof model['id'] === 'string' ? model['id'] : ''
  const modelName = typeof model['name'] === 'string' ? model['name'] : undefined
  /** Advertised efforts from the registered route, when discoverable. */
  const detect = async (): Promise<readonly ThinkingLevel[]> => {
    if (api === undefined || provider === undefined) return []
    const response = await api.llm.models({})
    if (!response.result.ok) throw new Error(response.result.error.message)
    const group = response.result.value.groups.find(candidate => candidate.id === provider)
    const found = group?.models.find(candidate => candidate.id === modelId)
    const efforts = found?.reasoning?.efforts ?? []
    return [...new Set(
      efforts
        .map(effort => levelOf(effort.id))
        .filter((level): level is ThinkingLevel => level !== undefined),
    )].filter(level => level !== 'off')
  }

  /** Resolve the levels to fill: advertised first, name inference second. */
  const resolveEfforts = async (): Promise<readonly ThinkingLevel[]> => {
    if (modelId.length === 0) return []
    if (api !== undefined && provider !== undefined) {
      const advertised = await detect()
      if (advertised.length > 0) return advertised
    }
    // Fall back to name-based inference so a custom gateway or a not-yet-
    // registered route still gets the levels its family is known for.
    return inferEfforts(modelId, modelName)
  }

  // Auto-fill on model id change when nothing is selected yet (name inference
  // only — advertised efforts stay a manual Detect action).
  const lastIdRef = useRef<string>('')
  useEffect(() => {
    if (lastIdRef.current === modelId) return
    lastIdRef.current = modelId
    if (modelId.length === 0 || selected.length > 0) return
    const inferred = inferEfforts(modelId, modelName)
    if (inferred.length > 0) applyEfforts(inferred)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelId])

  const runDetect = async (): Promise<void> => {
    if (modelId.length === 0) return
    setBusy(true)
    setFailure(undefined)
    try {
      const unique = await resolveEfforts()
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
        {modelId.length > 0 ? (
          <button
            type="button"
            className={styles['linkButton']}
            disabled={disabled || busy}
            onClick={() => { void runDetect() }}
          >
            {busy ? t('effortDetecting') : t('effortDetect')}
          </button>
        ) : null}
      </div>
      {failure === undefined ? null : <p className={styles['error']}>{failure}</p>}
    </div>
  )
}

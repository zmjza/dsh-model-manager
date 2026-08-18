/**
 * Per-model visibility toggle: hides/shows a model in the picker.
 *
 * Persisted to `localStorage` under a stable key
 * (`dsh.modelManager.visibility`). A missing entry means visible (opt-out
 * model), matching the "new models show by default" decision. localStorage is
 * used because the official settings proxy refuses to expose third-party
 * namespaces to configuration clients (a hard-coded allowlist, per the
 * api-proxy seam); visibility is a UI preference, so browser-local storage is
 * the right home and needs no host-side registration.
 */

import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { messageOf } from './store.ts'
import type { en } from './locales.ts'
import styles from './ModelsSection.module.css'

/** The callback-provider route being edited, when one is known. */
export interface ModelVisibilityToggleProps {
  /** The model id whose visibility this switch edits. */
  modelId: string
  /** The provider route owning the model, when known. */
  provider?: string | undefined
  /** Section copy. */
  t: (key: keyof typeof en) => string
  /** Disable every control. */
  disabled: boolean
}

/** localStorage key holding `{ [provider]: { [model]: hidden } }`. */
export const VISIBILITY_STORAGE_KEY = 'dsh.modelManager.visibility'

/** Read the whole visibility map (best-effort; malformed data reads empty). */
function readVisibility(): Record<string, Record<string, boolean>> {
  try {
    const raw = localStorage.getItem(VISIBILITY_STORAGE_KEY)
    if (raw === null) return {}
    const parsed = JSON.parse(raw) as unknown
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {}
    const map = parsed as Record<string, unknown>
    const result: Record<string, Record<string, boolean>> = {}
    for (const [provider, entries] of Object.entries(map)) {
      if (typeof entries !== 'object' || entries === null || Array.isArray(entries)) continue
      const perModel: Record<string, boolean> = {}
      for (const [modelId, hidden] of Object.entries(entries as Record<string, unknown>)) {
        if (typeof hidden === 'boolean') perModel[modelId] = hidden
      }
      result[provider] = perModel
    }
    return result
  } catch {
    return {}
  }
}

/** Whether one model is hidden, per the stored visibility map. */
function isHidden(provider: string, modelId: string): boolean {
  return readVisibility()[provider]?.[modelId] === true
}

/**
 * Render the model visibility switch.
 * @param props - the model/route identity + copy.
 * @returns a labelled checkbox, or null while the route is unknown.
 */
export function ModelVisibilityToggle(props: ModelVisibilityToggleProps): ReactNode | null {
  const { modelId, provider, t, disabled } = props

  const [hidden, setHidden] = useState<boolean | undefined>(() =>
    provider === undefined ? undefined : isHidden(provider, modelId))

  useEffect(() => {
    if (provider !== undefined) setHidden(isHidden(provider, modelId))
  }, [provider, modelId])

  if (provider === undefined) return null

  const toggle = (nextHidden: boolean): void => {
    try {
      const current = readVisibility()
      const perModel = current[provider] ?? {}
      const next: Record<string, Record<string, boolean>> = { ...current }
      if (nextHidden) {
        next[provider] = { ...perModel, [modelId]: true }
      } else {
        const { [modelId]: _removed, ...rest } = perModel
        if (Object.keys(rest).length === 0) delete next[provider]
        else next[provider] = rest
      }
      localStorage.setItem(VISIBILITY_STORAGE_KEY, JSON.stringify(next))
      setHidden(nextHidden)
    } catch (error) {
      // Storage can be unavailable (private mode / quota). Surface it but keep
      // the optimistic UI consistent with what we could persist.
      console.error('[dsh-model-manager] visibility write failed:', messageOf(error))
      setHidden(nextHidden)
    }
  }

  return (
    <label className={styles['modelField']}>
      <span className={styles['modelFieldLabel']}>{t('hideModel')}</span>
      <span className={styles['effortChoice']}>
        <input
          type="checkbox"
          checked={hidden === true}
          disabled={disabled || hidden === undefined}
          onChange={(event) => { toggle(event.target.checked) }}
        />
        <span>{hidden === true ? t('hidden') : t('shown')}</span>
      </span>
    </label>
  )
}

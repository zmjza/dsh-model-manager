/**
 * Per-model visibility toggle: hides/shows a model in the picker. Persists to
 * the plugin-owned `model-manager` settings namespace (`visibility.<provider>.<model>`).
 * A missing entry means visible (opt-out model), matching the "new models show
 * by default" decision.
 */

import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { IApiClient } from '@deepseek-ai/dsh-api-remotes/client'
import { getPath } from '@deepseek-ai/dsh-client-schema-form'
import { messageOf } from './store.ts'
import type { en } from './locales.ts'
import styles from './ModelsSection.module.css'

/** The callback-provider route being edited, when one is known. */
export interface ModelVisibilityToggleProps {
  /** The model id whose visibility this switch edits. */
  modelId: string
  /** The provider route owning the model, when known. */
  provider?: string
  /** Wire faces for reading and writing the namespace. */
  api: Pick<IApiClient, 'settings'>
  /** Section copy. */
  t: (key: keyof typeof en) => string
  /** Disable every control. */
  disabled: boolean
}

/** The plugin-owned settings namespace the toggle writes. */
const VISIBILITY_NS = 'model-manager'

/**
 * Render the model visibility switch.
 * @param props - the model/route identity + settings wire.
 * @returns a labelled checkbox, or null while the namespace/route is unknown.
 */
export function ModelVisibilityToggle(props: ModelVisibilityToggleProps): ReactNode | null {
  const { modelId, provider, api, t, disabled } = props
  const [hidden, setHidden] = useState<boolean | undefined>(undefined)
  const [failure, setFailure] = useState<string | undefined>(undefined)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let stale = false
    setHidden(undefined)
    void api.settings.describe({}).then((response) => {
      if (stale) return
      if (!response.result.ok) { setFailure(response.result.error.message); return }
      const visibility = getPath(
        response.result.value.namespaces.find(view => view.ns === VISIBILITY_NS)?.value,
        ['visibility'],
      )
      const entry = typeof visibility === 'object' && visibility !== null
        ? (visibility as Record<string, unknown>)[provider ?? '']
        : undefined
      const value = typeof entry === 'object' && entry !== null
        ? (entry as Record<string, unknown>)[modelId]
        : undefined
      setHidden(value === true)
    })
    return () => { stale = true }
  }, [api.settings, modelId, provider])

  if (provider === undefined) return null

  const toggle = async (nextHidden: boolean): Promise<void> => {
    setBusy(true)
    setFailure(undefined)
    try {
      const response = nextHidden
        ? await api.settings.mutate({
          ns: VISIBILITY_NS,
          ops: [{ op: 'set', path: ['visibility', provider, modelId], value: true }],
        })
        : await api.settings.mutate({
          ns: VISIBILITY_NS,
          ops: [{ op: 'unset', path: ['visibility', provider, modelId] }],
        })
      if (!response.result.ok) throw new Error(response.result.error.message)
      setHidden(nextHidden)
    } catch (error) {
      setFailure(messageOf(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <label className={styles['modelField']}>
      <span className={styles['modelFieldLabel']}>{t('hideModel')}</span>
      <span className={styles['effortChoice']}>
        <input
          type="checkbox"
          checked={hidden === true}
          disabled={disabled || busy || hidden === undefined}
          onChange={(event) => { void toggle(event.target.checked) }}
        />
        <span>{hidden === true ? t('hidden') : t('shown')}</span>
      </span>
      {failure === undefined ? null : <p className={styles['error']}>{failure}</p>}
    </label>
  )
}

/**
 * Composer thinking-level slider (Claude / Codex style). Renders in the tool
 * row (conversation.input.right) for the session's current model: a horizontal
 * track with a tick per available effort, a draggable handle, and a
 * per-level glow whose intensity scales with the level's position. Selecting
 * submits through the shared per-session ModelDirectory, so the official
 * model picker's effort panel and this slider always agree.
 */

import { useRef, useState } from 'react'
import { useSyncExternalStore } from 'react'
import type { CSSProperties, PointerEvent as ReactPointerEvent, ReactNode } from 'react'
import type { ModelReasoningEffort, SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import type { ModelDirectoryResolver } from '@deepseek-ai/dsh-client-ui-model-selection/client'
import type { en } from './locales.ts'
import styles from './EffortSlider.module.css'

/** The slider's own localized copy keys (kept small; section copy stays in locales). */
export interface EffortSliderInjected {
  /** Per-session shared model directory (official resolver). */
  modelDirectories: ModelDirectoryResolver
  /** Section copy. */
  t: (key: keyof typeof en) => string
}

/** Props delivered by the slot outlet + our inject faces. */
export interface EffortSliderProps extends EffortSliderInjected {
  /** The owning session (standard prop of conversation.input.right). */
  sessionId: SessionId
  /** Disable the control (read-only / no selected model). */
  locked?: boolean
}

/** Position of the selected effort among the model's advertised levels. */
function effortIndex(efforts: readonly ModelReasoningEffort[], selected: string | undefined): number {
  if (selected === undefined) return -1
  return efforts.findIndex(effort => effort.id === selected)
}

/** Level strength 0..1 for glow intensity, from its escalation position. */
function levelStrength(index: number, count: number): number {
  if (count <= 1) return 0
  return index / (count - 1)
}

/**
 * Render the composer thinking-level slider.
 * @param props - the session, model directory, and copy.
 * @returns the slider, or null when the current model has no selectable
 *   reasoning levels.
 */
export function EffortSlider(props: EffortSliderProps): ReactNode | null {
  const { modelDirectories, sessionId, t, locked } = props
  const directory = modelDirectories.directoryFor(sessionId)
  const state = useSyncExternalStore(
    (onChange) => directory.store.subscribe(onChange),
    () => directory.store.getSnapshot(),
  )
  const [open, setOpen] = useState(false)
  const [dragging, setDragging] = useState(false)
  const trackRef = useRef<HTMLDivElement | null>(null)

  const { current, groups } = state
  if (current === null) return null
  const group = groups.find(candidate => candidate.id === current.provider)
  const model = group?.models.find(candidate => candidate.id === current.model)
  const reasoning = model?.reasoning
  if (reasoning === undefined || reasoning.efforts.length === 0) return null

  const efforts = reasoning.efforts
  const index = effortIndex(efforts, current.reasoningEffort)
  const selectedEffort = index >= 0 ? efforts[index] : undefined
  const strength = index >= 0 ? levelStrength(index, efforts.length) : 0
  const disabled = locked === true || state.status === 'selecting'

  const selectEffort = (effort: ModelReasoningEffort | undefined): void => {
    void directory.select({
      provider: current.provider,
      model: current.model,
      ...effort === undefined ? {} : { reasoningEffort: effort.id },
    })
  }

  const pickAt = (clientX: number): void => {
    const track = trackRef.current
    if (track === null || efforts.length === 0) return
    const rect = track.getBoundingClientRect()
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
    const picked = Math.round(ratio * (efforts.length - 1))
    const effort = efforts[picked]
    if (effort !== undefined) selectEffort(effort)
  }

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (disabled) return
    event.preventDefault()
    setDragging(true)
    pickAt(event.clientX)
  }

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (!dragging || disabled) return
    pickAt(event.clientX)
  }

  const stopDrag = (): void => { setDragging(false) }

  // The trigger label: current level name when known, else provider default.
  const label = index < 0
    ? t('effortSliderProviderDefault')
    : selectedEffort?.name ?? current.reasoningEffort ?? t('effortSliderProviderDefault')

  return (
    <div className={styles['root']}>
      <button
        type="button"
        className={styles['trigger']}
        aria-expanded={open}
        aria-label={t('effortSliderAria')}
        title={t('effortSliderTitle')}
        onClick={() => { setOpen(current => !current) }}
      >
        {/* Glow badge mirrors the current level's strength. */}
        <span
          className={styles['badge']}
          style={{ '--effort-strength': String(strength) } as CSSProperties}
        />
        <span className={styles['triggerLabel']}>{label}</span>
      </button>
      {open ? (
        <div className={styles['popup']}>
          <div
            ref={trackRef}
            className={styles['track']}
            role="slider"
            aria-valuemin={0}
            aria-valuemax={Math.max(0, efforts.length - 1)}
            aria-valuenow={index < 0 ? 0 : index}
            aria-label={t('effortSliderAria')}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={stopDrag}
            onPointerLeave={stopDrag}
          >
            <div className={styles['rail']} />
            {efforts.map((effort, at) => {
              const active = at === index
              const tickStrength = levelStrength(at, efforts.length)
              return (
                <button
                  key={effort.id}
                  type="button"
                  className={`${styles['tick']} ${active ? styles['tickActive'] : ''}`}
                  style={{ '--effort-strength': String(tickStrength) } as CSSProperties}
                  disabled={disabled}
                  aria-label={effort.name}
                  title={effort.description ?? effort.name}
                  onClick={(event) => {
                    event.stopPropagation()
                    selectEffort(effort)
                  }}
                />
              )
            })}
            {index >= 0 ? (
              <span
                className={styles['handle']}
                style={{
                  '--effort-position': `${String((index / Math.max(1, efforts.length - 1)) * 100)}%`,
                  '--effort-strength': String(strength),
                } as CSSProperties}
              />
            ) : null}
          </div>
          <div className={styles['labels']}>
            {efforts.map(effort => (
              <span key={effort.id} className={effort.id === current.reasoningEffort ? styles['labelActive'] : undefined}>
                {effort.name}
              </span>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}

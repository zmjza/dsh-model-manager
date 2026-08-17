/**
 * Composer thinking-level slider, replicating the Claude / Codex "Effort"
 * control (v5 R3+R4): a theme-adaptive card (all colours via DSH tokens) with
 * a horizontal track whose purple particle fill runs left→right up to the
 * current level, a white rounded thumb, a "思考程度" title and 低 ── 高 endpoint
 * labels (decision A). The track is draggable and click-through; selecting
 * submits through the shared per-session ModelDirectory so the official effort
 * panel and this slider always agree.
 *
 * Each thinking level binds a DIFFERENT animation morphology through the
 * `data-tier` attribute the CSS reads (off = none, minimal = static sprinkles,
 * low = twinkle, medium = drift, high = ring pulse, xhigh = halo grow, max =
 * comet trail), so switching levels visibly changes the animation, not just the
 * brightness. The popup opens ABOVE the trigger (R5) and flips below only in
 * short windows.
 */

import { useRef, useState } from 'react'
import { useSyncExternalStore } from 'react'
import type { CSSProperties, PointerEvent as ReactPointerEvent, ReactNode } from 'react'
import type { ModelReasoningEffort, SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import type { ModelDirectoryResolver } from '@deepseek-ai/dsh-client-ui-model-selection/client'
import type { en } from './locales.ts'
import { playEffortPick } from './effort-sound.ts'
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

/** The fixed animation tiers, in escalation order (matches the 7-level ladder). */
const ANIM_TIERS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const

/**
 * Pick the animation tier for the current level. Standard ids map 1:1 to the
 * tier; an unrecognized id (custom gateway, "ultracode"-style name) falls back
 * to the nearest standard tier by its position on the track.
 */
function tierOf(effortId: string | undefined, index: number, count: number): string {
  if (effortId === undefined) return 'off'
  const known = ANIM_TIERS.find(tier => tier === effortId)
  if (known !== undefined) return known
  if (count <= 1) return 'off'
  const step = Math.round((index / (count - 1)) * (ANIM_TIERS.length - 1))
  return ANIM_TIERS[Math.min(ANIM_TIERS.length - 1, Math.max(0, step))] ?? 'off'
}

/** Level strength 0..1 for particle intensity, from its escalation position. */
function levelStrength(index: number, count: number): number {
  if (count <= 1) return 0
  return index / (count - 1)
}

/** Left→right fill percentage for the track's particle fill at a level. */
function fillPercent(index: number, count: number): number {
  if (index < 0 || count <= 1) return 0
  return (index / (count - 1)) * 100
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
  const lastPickedRef = useRef<string | undefined>(undefined)

  const { current, groups } = state
  if (current === null) return null
  const group = groups.find(candidate => candidate.id === current.provider)
  const model = group?.models.find(candidate => candidate.id === current.model)
  const reasoning = model?.reasoning
  if (reasoning === undefined || reasoning.efforts.length === 0) return null

  const efforts = reasoning.efforts
  const index = effortIndex(efforts, current.reasoningEffort)
  const strength = index >= 0 ? levelStrength(index, efforts.length) : 0
  const disabled = locked === true || state.status === 'selecting'
  const selectedEffortId = index >= 0 ? efforts[index]?.id : undefined
  const tier = tierOf(selectedEffortId, index, efforts.length)

  const selectEffort = (effortId: string): void => {
    if (lastPickedRef.current === effortId || current.reasoningEffort === effortId) return
    lastPickedRef.current = effortId
    const pickedIndex = efforts.findIndex(effort => effort.id === effortId)
    playEffortPick(pickedIndex, efforts.length)
    void directory.select({
      provider: current.provider,
      model: current.model,
      reasoningEffort: effortId,
    })
  }

  const pickAt = (clientX: number): void => {
    const track = trackRef.current
    if (track === null || efforts.length === 0) return
    const rect = track.getBoundingClientRect()
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
    const picked = Math.round(ratio * (efforts.length - 1))
    const effort = efforts[picked]
    if (effort !== undefined) selectEffort(effort.id)
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

  const stopDrag = (): void => {
    setDragging(false)
    lastPickedRef.current = undefined
  }

  // Endpoint labels: 思考程度 低 ── 高 (confirmed A).
  const lowerLabel = t('effortSliderLow')
  const upperLabel = t('effortSliderHigh')

  const effortStyle = {
    '--effort-strength': String(strength),
    '--effort-fill': `${String(fillPercent(index, efforts.length))}%`,
  } as CSSProperties

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
        <span
          className={styles['badge']}
          style={{ '--effort-strength': String(strength) } as CSSProperties}
        />
        <span className={styles['triggerLabel']}>{selectedEffortId ?? t('effortSliderProviderDefault')}</span>
      </button>
      {open ? (
        <div className={styles['popup']} data-tier={tier} style={effortStyle}>
          <div className={styles['popupHeader']}>
            <span className={styles['popupTitle']}>{t('effortSliderNav')}</span>
            <span className={styles['popupLevel']}>{selectedEffortId ?? t('effortSliderProviderDefault')}</span>
          </div>
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
            {/* Particle fill galore: a clamped gradient whose width follows the level. */}
            <div className={styles['particleFill']} />
            {/* Ancillary fx layers: a breathing halo ring and a comet trail —
                only the tiers that need them switch them on (see the CSS). */}
            <div className={styles['ring']} />
            <div className={styles['comet']} />
            {efforts.map((effort, at) => {
              const active = at === index
              const tickStrength = levelStrength(at, efforts.length)
              return (
                <button
                  key={effort.id}
                  type="button"
                  className={`${styles['tick']} ${active ? styles['tickActive'] : ''}`}
                  style={{ '--effort-strength': String(tickStrength), '--tick-pos': `${String((at / Math.max(1, efforts.length - 1)) * 100)}%` } as CSSProperties}
                  disabled={disabled}
                  aria-label={effort.name}
                  title={effort.description ?? effort.name}
                  onClick={(event) => {
                    event.stopPropagation()
                    selectEffort(effort.id)
                  }}
                />
              )
            })}
            {efforts.length > 0 ? (
              <span
                className={styles['thumb']}
                style={{ '--thumb-pos': `${String((index / Math.max(1, efforts.length - 1)) * 100)}%` } as CSSProperties}
              />
            ) : null}
          </div>
          <div className={styles['labels']}>
            <span>{lowerLabel}</span>
            <span>{selectedEffortId ?? ''}</span>
            <span>{upperLabel}</span>
          </div>
        </div>
      ) : null}
    </div>
  )
}

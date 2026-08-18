/**
 * Composer thinking-level slider — prototype "Effort" deck integrated.
 *
 * Ports the user's Effort slider prototype (dark/light decks) into the
 * composer control: a glass card with an "Effort" header + level word, a
 * 32px gridded rail whose fill follows the level, a white rounded thumb with
 * a purple bloom, and a FINER canvas particle field (soft radial glow dots +
 * the occasional star glint at high effort). Theme comes from the two decks
 * through CSS custom properties keyed on `body[data-ds-dark-theme]`, so the
 * card matches the page automatically.
 *
 * Behaviour:
 *   • the slider is the discrete set of levels the model advertises — dragging
 *     snaps to the nearest one and commits through the shared per-session
 *     ModelDirectory (official effort panel stays in lockstep); arrow keys
 *     bump it too; each pick plays the ascending blip.
 *   • opened ABOVE the trigger (R5), flipping below only in short windows.
 *   • AUTO-HIDE: while open, a click/tap anywhere outside this control
 *     (trigger + card) closes it — no extra click on a close affordance, and
 *     Escape closes too.
 *   • the particle field only animates while the card is open.
 */

import { useEffect, useRef, useState } from 'react'
import { useSyncExternalStore } from 'react'
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent, ReactNode } from 'react'
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

/** Level strength 0..1 for particle intensity, from its escalation position. */
function levelStrength(index: number, count: number): number {
  if (count <= 1) return 0
  return index / (count - 1)
}

/** Left→right fill percentage for the rail at a level. */
function fillPercent(index: number, count: number): number {
  if (index < 0 || count <= 1) return 0
  return (index / (count - 1)) * 100
}

/** Pretty header word for a level id (the prototype deck's Low/Medium/High/Max). */
function levelWord(id: string | undefined): string {
  const base = id ?? ''
  const lower = base.toLowerCase()
  if (lower === 'max' || lower === 'maximum' || lower === 'ultracode' || lower === 'xhigh') return 'Max'
  if (lower.includes('high')) return 'High'
  if (lower.includes('medium') || lower.includes('med')) return 'Medium'
  if (lower === 'minimal' || lower === 'minimum') return 'Minimal'
  if (lower === 'off' || lower === 'none') return 'Off'
  return base.length > 0 ? base.charAt(0).toUpperCase() + base.slice(1) : 'Low'
}

/** Particle-interest multiplier per tier; escalating density + sparkle. */
const TIER_INTEREST: Record<string, number> = {
  off: 0, minimal: 0.45, low: 0.75, medium: 1, high: 1.35, xhigh: 1.7, max: 2.1,
}
const TIER_ORDER = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const

/** Map a level (by id) to a particle-interest factor, with position fallback. */
function tierInterest(effortId: string | undefined, index: number, count: number): number {
  if (effortId !== undefined) {
    const direct = TIER_INTEREST[effortId]
    if (direct !== undefined) return direct
  }
  if (count <= 1) return 0
  const step = Math.round((index / (count - 1)) * (TIER_ORDER.length - 1))
  return TIER_INTEREST[TIER_ORDER[Math.min(TIER_ORDER.length - 1, Math.max(0, step))] ?? 'medium'] ?? 1
}

/* ------------------------------------------------------------------ *
 * Refined particle field (canvas). Soft radial glow-dots, gentle Brownian
 * drift, a twinkle on each particle, and star glints near maximum.
 * ------------------------------------------------------------------ */
interface Particle {
  x: number; y: number
  vx: number; vy: number
  size: number
  life: number; decay: number
  phase: number; phaseSpeed: number
  twinkle: number; twinkleSpeed: number
  glint: boolean
}

function Particles({ strength, interest, dark }: { strength: number; interest: number; dark: boolean }): ReactNode {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const stateRef = useRef<{ raf: number; particles: Particle[]; last: number }>({ raf: 0, particles: [], last: 0 })

  useEffect(() => {
    const canvas = canvasRef.current
    if (canvas === null) return
    const ctx = canvas.getContext('2d')
    if (ctx === null) return

    const core = dark ? [206, 170, 255] : [139, 92, 246]
    const glintRgb = dark ? '255,255,255' : '109,40,217'

    // Crisp backing store on hi-dpi.
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    const resize = (): void => {
      const rect = canvas.parentElement?.getBoundingClientRect()
      if (!rect) return
      canvas.width = Math.round(rect.width * dpr)
      canvas.height = Math.round(78 * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    resize()
    window.addEventListener('resize', resize)

    const spawn = (spawnX: number): void => {
      const st2 = stateRef.current
      if (st2.particles.length > 200) return
      const spark = strength > 0.82 && Math.random() < 0.16
      const size = spark
        ? Math.random() * 0.7 + 0.5
        : Math.random() * 1.05 + 0.35
      st2.particles.push({
        x: spawnX,
        y: 39 + (Math.random() - 0.5) * 14,
        vx: Math.random() * 0.55 + 0.12 + strength * 0.5,
        vy: (Math.random() - 0.42) * 0.5,                // slight upward bias
        size,
        life: 1,
        decay: Math.random() * 0.018 + 0.009 + strength * 0.014,
        phase: Math.random() * Math.PI * 2,
        phaseSpeed: Math.random() * 0.09 + 0.04,
        twinkle: Math.random() * Math.PI * 2,
        twinkleSpeed: Math.random() * 2.4 + 1.4,
        glint: spark,
      })
    }

    const frame = (timeMs: number): void => {
      const t = timeMs / 1000
      // gentle ease toward the target strength so sparkle ramps softly
      const density = Math.pow(strength, 1.4) * 9 * interest
      if (strength > 0.005 && density > 0) {
        for (let i = 0; i < density; i++) {
          if (Math.random() < 0.55) continue
          const fillEdge = strength * canvas.width / dpr
          const x = Math.random() < 0.3 ? fillEdge : Math.random() * fillEdge
          spawn(x)
        }
      }
      ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr)
      ctx.globalCompositeOperation = dark ? 'lighter' : 'multiply'
      const px = stateRef.current.particles
      for (let i = px.length - 1; i >= 0; i--) {
        const p = px[i]
        if (p === undefined) continue
        const e = strength
        p.vy += Math.sin(p.phase) * 0.06 * e
        p.phase += p.phaseSpeed
        p.x += p.vx
        p.y += p.vy
        p.life -= p.decay
        if (p.life <= 0) { px.splice(i, 1); continue }

        const twinkle = 0.62 + 0.38 * Math.sin(p.twinkle + t * p.twinkleSpeed)
        const alpha = Math.max(0, Math.min(1, p.life * twinkle)) * (e > 0.7 ? 1.05 : 0.8)
        ctx.globalAlpha = alpha
        const r = p.size
        if (p.glint) {
          // fine 4-point spark at high effort
          const L = r * 4.2
          const g = ctx.createLinearGradient(p.x, p.y - L, p.x, p.y + L)
          g.addColorStop(0, 'rgba(' + glintRgb + ',0)')
          g.addColorStop(0.5, 'rgba(' + glintRgb + ',' + Math.min(0.9, alpha + 0.15) + ')')
          g.addColorStop(1, 'rgba(' + glintRgb + ',0)')
          ctx.strokeStyle = g
          ctx.lineWidth = 0.6
          ctx.beginPath()
          ctx.moveTo(p.x, p.y - L); ctx.lineTo(p.x, p.y + L)
          ctx.moveTo(p.x - L, p.y); ctx.lineTo(p.x + L, p.y)
          ctx.stroke()
        } else {
          const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r * 2.1)
          grad.addColorStop(0, 'rgba(' + core[0] + ',' + core[1] + ',' + core[2] + ',' + Math.min(0.95, alpha) + ')')
          grad.addColorStop(0.45, 'rgba(' + core[0] + ',' + core[1] + ',' + core[2] + ',' + Math.max(0, alpha * 0.4) + ')')
          grad.addColorStop(1, 'rgba(' + core[0] + ',' + core[1] + ',' + core[2] + ',0)')
          ctx.fillStyle = grad
          ctx.beginPath()
          ctx.arc(p.x, p.y, r * 2.1, 0, Math.PI * 2)
          ctx.fill()
        }
      }
      ctx.globalAlpha = 1
      ctx.globalCompositeOperation = 'source-over'
      stateRef.current.raf = requestAnimationFrame(frame)
    }
    stateRef.current.raf = requestAnimationFrame(frame)
    return () => {
      cancelAnimationFrame(stateRef.current.raf)
      stateRef.current.particles = []
      window.removeEventListener('resize', resize)
    }
  }, [strength, interest, dark])

  return (
    <canvas
      ref={canvasRef}
      className={styles['canvas']}
      style={{ width: '100%', height: 78 }}
      aria-hidden
    />
  )
}

/* ------------------------------------------------------------------ */

/**
 * Render the composer thinking-level slider (prototype deck).
 * @param props - the session, model directory, and copy.
 * @returns the slider, or null when the current model has no selectable levels.
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
  const [dark, setDark] = useState(
    () => typeof document !== 'undefined' && document.body.getAttribute('data-ds-dark-theme') !== null,
  )
  const wrapperRef = useRef<HTMLDivElement | null>(null)
  const trackRef = useRef<HTMLDivElement | null>(null)
  const lastPickedRef = useRef<string | undefined>(undefined)

  // Keep the deck in sync when the page theme toggles live.
  useEffect(() => {
    const mo = new MutationObserver(() => {
      setDark(document.body.getAttribute('data-ds-dark-theme') !== null)
    })
    mo.observe(document.body, { attributes: true, attributeFilter: ['data-ds-dark-theme'] })
    return () => mo.disconnect()
  }, [])

  // AUTO-HIDE: any press outside the control (trigger + card) closes it; Esc too.
  useEffect(() => {
    if (!open) return
    const onPress = (event: PointerEvent): void => {
      const target = event.target instanceof Node ? event.target : null
      if (target !== null && wrapperRef.current !== null && !wrapperRef.current.contains(target)) {
        setOpen(false)
      }
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPress, true)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPress, true)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

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
  const interest = tierInterest(selectedEffortId, index, efforts.length)
  const atMax = index === efforts.length - 1

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
  const onKey = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (disabled) return
    if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (index >= 0 && index < efforts.length - 1) selectEffort(efforts[index + 1]?.id ?? current.reasoningEffort ?? '')
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
      event.preventDefault()
      if (index > 0) selectEffort(efforts[index - 1]?.id ?? '')
    }
  }

  const lowerLabel = t('effortSliderLow')
  const upperLabel = t('effortSliderHigh')

  const trackStyle = {
    '--effort-strength': String(strength),
    '--effort-fill': `${String(fillPercent(index, efforts.length))}%`,
    '--thumb-pos': `${String(index >= 0 ? (index / Math.max(1, efforts.length - 1)) * 100 : 0)}%`,
  } as CSSProperties

  return (
    <div ref={wrapperRef} className={styles['root']}>
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
        <div className={styles['popup']} role="dialog" aria-modal="false" aria-label={t('effortSliderNav')} style={trackStyle}>
          <header className={styles['popupHeader']}>
            <span className={styles['popupTitle']}>{t('effortSliderNav')}</span>
            <span className={styles['popupLevel']}>{levelWord(selectedEffortId)}</span>
          </header>
          <div className={styles['trackWrap']}>
            <div className={styles['trackContainer']}>
              <div className={styles['trackFill']} />
            </div>
            <Particles strength={strength} interest={interest} dark={dark} />
            <div
              ref={trackRef}
              className={styles['track']}
              role="slider"
              aria-valuemin={0}
              aria-valuemax={Math.max(0, efforts.length - 1)}
              aria-valuenow={index < 0 ? 0 : index}
              aria-label={t('effortSliderAria')}
              tabIndex={disabled ? -1 : 0}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={stopDrag}
              onPointerLeave={stopDrag}
              onKeyDown={onKey}
            />
            <span className={styles['thumb']} aria-hidden />
          </div>
          <div className={styles['labels']}>
            <span className={styles['labelLow']}>{lowerLabel}</span>
            <span className={`${styles['labelMax']} ${atMax ? styles['labelMaxOn'] : ''}`}>{t('effortSliderMaxYield')}</span>
            <span className={styles['labelHigh']}>{upperLabel}</span>
          </div>
        </div>
      ) : null}
    </div>
  )
}

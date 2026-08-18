/**
 * Composer thinking-level slider — prototype "Effort" deck integrated.
 *
 * Ports the user's Effort slider prototype (dark/light decks) into the
 * composer control: a glass card with an "Effort" header + level word, a
 * 32px gridded rail whose fill follows the level, a white rounded thumb with
 * a purple bloom, and a dense, FINER canvas particle field (soft radial
 * glow-dots, per-particle twinkle, star glints near maximum).
 *
 * SILKY interaction: the thumb/fill is driven by a framerate-independent
 * spring. While dragging the handle follows the pointer ~tight (fast time
 * constant) but with no 1:1 CSS transition jitter; on release it glides to
 * the nearest level and settles softly. Selection is committed ONCE on
 * release (not per pointer-move), so the remote effort panel only updates at
 * the final value and the audio blips once — the drag itself stays pure
 * rendering. Arrow keys bump levels directly with the same spring settle.
 *
 * Behaviour:
 *   • discrete levels from the model; drag snaps + commits on release through
 *     the shared per-session ModelDirectory.
 *   • opened ABOVE the trigger (R5), flipping below only in short windows.
 *   • AUTO-HIDE: a press anywhere outside (trigger + card) closes it; Esc too.
 *   • the particle field animates only while the card is open.
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

/** The 0..1 thumb position of a level stop. */
function levelPosition(index: number, count: number): number {
  if (index < 0 || count <= 1) return 0
  return index / (count - 1)
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
  off: 0, minimal: 0.5, low: 0.8, medium: 1.1, high: 1.5, xhigh: 1.85, max: 2.3,
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
 * Dense refined particle field. Soft radial glow-dots + occasional star
 * glints; spawn volume scales with effort so higher levels visibly bloom.
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
  const stateRef = useRef<{ raf: number; particles: Particle[] }>({ raf: 0, particles: [] })

  useEffect(() => {
    const canvas = canvasRef.current
    if (canvas === null) return
    const ctx = canvas.getContext('2d')
    if (ctx === null) return

    const core = dark ? [212, 178, 255] : [139, 92, 246]
    const glintRgb = dark ? '255,255,255' : '109,40,217'

    // Crisp backing store on hi-dpi.
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    const resize = (): void => {
      const rect = canvas.parentElement?.getBoundingClientRect()
      if (!rect) return
      canvas.width = Math.round(rect.width * dpr)
      canvas.height = Math.round(82 * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    resize()
    window.addEventListener('resize', resize)

    const spawn = (spawnX: number): void => {
      const store = stateRef.current
      if (store.particles.length > 420) return
      const spark = strength > 0.75 && Math.random() < 0.22
      const size = spark
        ? Math.random() * 1.2 + 1.0
        : Math.random() * 1.5 + 0.8
      store.particles.push({
        x: spawnX,
        y: 41 + (Math.random() - 0.5) * 22,
        vx: Math.random() * 0.75 + 0.18 + strength * 0.65,
        vy: (Math.random() - 0.42) * 0.6,               // slight upward bias
        size,
        life: 1,
        decay: Math.random() * 0.014 + 0.006 + strength * 0.01,
        phase: Math.random() * Math.PI * 2,
        phaseSpeed: Math.random() * 0.09 + 0.04,
        twinkle: Math.random() * Math.PI * 2,
        twinkleSpeed: Math.random() * 2.4 + 1.4,
        glint: spark,
      })
    }

    const frame = (timeMs: number): void => {
      const t = timeMs / 1000
      // DENSE, soft spawn cloud; volume grows steeply with strength so higher
      // levels visibly bloom with sparkling light.
      const density = Math.pow(strength, 1.25) * 28 * interest
      if (strength > 0.005 && density > 0) {
        for (let i = 0; i < density; i++) {
          if (Math.random() < 0.12) continue   // keep ~9/10 of the budget
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

        const twinkle = 0.66 + 0.34 * Math.sin(p.twinkle + t * p.twinkleSpeed)
        const alpha = Math.max(0, Math.min(1, p.life * twinkle)) * (e > 0.7 ? 1.15 : 0.9)
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
      style={{ width: '100%', height: 82 }}
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
  // Live nearest-level word while dragging (final comes from the committed index).
  const [previewIndex, setPreviewIndex] = useState(-1)

  const wrapperRef = useRef<HTMLDivElement | null>(null)
  const popupRef = useRef<HTMLDivElement | null>(null)
  const trackRef = useRef<HTMLDivElement | null>(null)
  const lastPickedRef = useRef<string | undefined>(undefined)
  // Silk manipulation state (never flows through React re-renders):
  const visualRef = useRef(0)          // current smoothed 0..1 position of the thumb/fill
  const targetRef = useRef(0)          // where the spring is easing toward
  const ratioRef = useRef(0)           // raw pointer ratio while dragging
  const draggingRef = useRef(false)

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
  const count = efforts.length
  const index = effortIndex(efforts, current.reasoningEffort)
  const committedPos = levelPosition(index, count)
  const strength = levelStrength(index >= 0 ? index : 0, count)
  const disabled = locked === true || state.status === 'selecting'
  const selectedEffortId = index >= 0 ? efforts[index]?.id : undefined
  const interest = tierInterest(selectedEffortId, index, count)
  // What the header shows: live preview during a drag, else the committed level.
  const displayIndex = dragging && previewIndex >= 0 ? previewIndex : index
  const atMax = displayIndex === count - 1

  // The spring: a framerate-independent ease that keeps the handle planted when
  // idle (loops only while it is still moving). While dragging it chases the
  // pointer tightly; on release it glides to the nearest stop and settles.
  useEffect(() => {
    if (!open) return
    let raf = 0
    let last = performance.now()
    const tick = (now: number): void => {
      const dt = Math.min(50, now - last)
      last = now
      // ms time constant: tight follow while dragging (~24ms), silky settle
      // after (~85ms) so the release whole-motion reads as one smooth glide.
      const tau = dragging ? 24 : 85
      const k = 1 - Math.exp(-dt / tau)
      const cur = visualRef.current
      const next = cur + (targetRef.current - cur) * k
      visualRef.current = next
      const popup = popupRef.current
      if (popup !== null) {
        popup.style.setProperty('--thumb-pos', `${String(next * 100)}%`)
        popup.style.setProperty('--effort-fill', `${String(next * 100)}%`)
      }
      if (Math.abs(targetRef.current - next) > 1e-4) {
        raf = requestAnimationFrame(tick)
      } else {
        visualRef.current = targetRef.current
        if (popup !== null) {
          popup.style.setProperty('--thumb-pos', `${String(targetRef.current * 100)}%`)
          popup.style.setProperty('--effort-fill', `${String(targetRef.current * 100)}%`)
        }
      }
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [open, dragging])

  // Anchor the spring to the committed level whenever it changes (external
  // switches, keyboard, and the release commit).
  useEffect(() => {
    if (dragging) return
    targetRef.current = committedPos
  }, [committedPos, dragging])

  const selectEffort = (effortId: string): void => {
    if (lastPickedRef.current === effortId || current.reasoningEffort === effortId) return
    lastPickedRef.current = effortId
    const pickedIndex = efforts.findIndex(effort => effort.id === effortId)
    playEffortPick(pickedIndex, count)
    void directory.select({
      provider: current.provider,
      model: current.model,
      reasoningEffort: effortId,
    })
  }

  const ratioAt = (clientX: number): number => {
    const track = trackRef.current
    if (track === null) return 0
    const rect = track.getBoundingClientRect()
    return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
  }
  const nearestIndex = (ratio: number): number => Math.round(ratio * (count - 1))

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (disabled) return
    event.preventDefault()
    draggingRef.current = true
    setDragging(true)
    try { event.currentTarget.setPointerCapture(event.pointerId) } catch { /* ignore */ }
    ratioRef.current = ratioAt(event.clientX)
    targetRef.current = ratioRef.current
    setPreviewIndex(nearestIndex(ratioRef.current))
  }
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (!draggingRef.current || disabled) return
    ratioRef.current = ratioAt(event.clientX)
    targetRef.current = ratioRef.current
    const preview = nearestIndex(ratioRef.current)
    setPreviewIndex(current => current === preview ? current : preview)
  }
  const commitDrag = (): void => {
    if (!draggingRef.current) return
    draggingRef.current = false
    const picked = nearestIndex(ratioRef.current)
    const effort = efforts[picked]
    if (effort !== undefined) selectEffort(effort.id)
    targetRef.current = levelPosition(picked, count)
    setPreviewIndex(-1)
    setDragging(false)
    lastPickedRef.current = undefined
  }
  const onKey = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (disabled) return
    if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (index >= 0 && index < count - 1) {
        const target = efforts[index + 1]
        if (target !== undefined) selectEffort(target.id)
      }
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
      event.preventDefault()
      if (index > 0) {
        const target = efforts[index - 1]
        if (target !== undefined) selectEffort(target.id)
      }
    }
  }

  const lowerLabel = t('effortSliderLow')
  const upperLabel = t('effortSliderHigh')

  const trackStyle = {
    '--effort-strength': String(strength),
    '--effort-fill': `${String(committedPos * 100)}%`,
    '--thumb-pos': `${String(committedPos * 100)}%`,
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
        <div
          ref={popupRef}
          className={styles['popup']}
          role="dialog"
          aria-modal="false"
          aria-label={t('effortSliderNav')}
          style={trackStyle}
        >
          <header className={styles['popupHeader']}>
            <span className={styles['popupTitle']}>{t('effortSliderNav')}</span>
            <span className={styles['popupLevel']}>{levelWord(displayIndex >= 0 ? efforts[displayIndex]?.id : undefined)}</span>
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
              aria-valuemax={Math.max(0, count - 1)}
              aria-valuenow={index < 0 ? 0 : index}
              aria-label={t('effortSliderAria')}
              tabIndex={disabled ? -1 : 0}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={commitDrag}
              onPointerCancel={commitDrag}
              onPointerLeave={commitDrag}
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

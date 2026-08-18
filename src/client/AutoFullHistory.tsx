/**
 * R9#1 — Auto full conversation history (plugin-only).
 *
 * The harness pages long conversations (50 messages/page) behind a
 * "加载更早 / Load earlier" button, so a long chat shows only the tail until
 * the user clicks through every page. This entry is an invisible sidecar
 * mounted on the active conversation: it finds the load-earlier button in the
 * chat DOM and keeps clicking it until it is gone (i.e. the whole history is
 * materialized), so the default view is the FULL conversation with no manual
 * paging. Bounded (page clicks capped, settle checker, stops on unmount /
 * session switch) so it can never spin.
 */

import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import type { SessionId } from '@deepseek-ai/dsh-api-remotes/client'

/** Props the conversation.input.right outlet hands us (session standard kit). */
export interface AutoFullHistoryProps {
  sessionId: SessionId
}

/** The load-earlier button labels we recognise (zh + en). */
const LOAD_EARLIER_LABELS = new Set(['加载更早', 'Load earlier'])

/** Interval between auto-page clicks (ms). */
const TICK = 220
/** How many consecutive ticks without the button until we conclude "all loaded". */
const SETTLE_TICKS = 10
/** Hard ceiling on page clicks, so an endless log can never spin forever. */
const MAX_CLICKS = 600

/**
 * Render nothing; while the session is open, drive the load-earlier button to
 * exhaustion so the whole history shows by default.
 * @param props - the owning session.
 * @returns null (invisible sidecar).
 */
export function AutoFullHistory(props: AutoFullHistoryProps): ReactNode {
  const sessionId = props.sessionId
  const ref = useRef({ alive: true, clicks: 0 })

  useEffect(() => {
    const state = ref.current
    state.alive = true
    state.clicks = 0
    let timer: number | undefined
    let ticksAbsent = 0

    const findButton = (): HTMLButtonElement | null => {
      const buttons = document.querySelectorAll<HTMLButtonElement>('button')
      for (const button of buttons) {
        const text = (button.textContent ?? '').trim()
        if (LOAD_EARLIER_LABELS.has(text) && button.isConnected) return button
      }
      return null
    }

    const step = (): void => {
      if (!state.alive) return
      const button = findButton()
      if (button !== null) {
        ticksAbsent = 0
        state.clicks += 1
        if (state.clicks <= MAX_CLICKS) {
          try { button.click() } catch { /* ignore */ }
        }
        timer = window.setTimeout(step, TICK)
        return
      }
      // Button absent — settle until we are confident the thread is fully loaded.
      ticksAbsent += 1
      if (ticksAbsent >= SETTLE_TICKS || state.clicks >= MAX_CLICKS) return
      timer = window.setTimeout(step, TICK)
    }

    // Start after the chat view has had a chance to mount its pages.
    timer = window.setTimeout(step, 400)
    return () => {
      state.alive = false
      if (timer !== undefined) window.clearTimeout(timer)
    }
  }, [sessionId])

  return null
}

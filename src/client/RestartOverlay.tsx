/**
 * R7 — Restart-service button (client half).
 *
 * A small floating control in the `shell.overlay` layer (frame-wide, above
 * every column; entries order among themselves). Clicking opens a confirm
 * dialog; confirming POSTs /api/model-manager/restart (the host answers 204,
 * then spawns a detached same-command child and exits itself). While the new
 * instance comes up this component polls the origin and, as soon as it answers
 * again, `location.replace`s back to the URL the user was on — DSH restores
 * the session, so the page "comes back" as before.
 *
 * The shell.overlay seat declares no inject face, so the few strings this
 * control needs live in a tiny module dictionary driven by the UI language.
 */

import { useRef, useState } from 'react'
import type { ReactNode } from 'react'
import styles from './RestartOverlay.module.css'

type Phase = 'idle' | 'confirm' | 'restarting' | 'error'

const ZH = 'zh'

/** Minimal inline dictionary (the overlay is a utility, not a settings page). */
function pick(zh: string, en: string): string {
  return (typeof navigator !== 'undefined' && navigator.language && navigator.language.toLowerCase().startsWith(ZH))
    ? zh
    : en
}

const COPY = {
  button: pick('重启服务', 'Restart service'),
  confirmTitle: pick('重启 DeepSeek Harness？', 'Restart DeepSeek Harness?'),
  confirmBody: pick(
    '服务将短暂断开并自动重启（退出自动拉起 + 登录开机自启）。运行中的智能体任务会被中断；恢复后自动回到当前页面。',
    'The service will briefly disconnect and restart itself (auto-relaunch + login autostart). Running agent tasks will be interrupted; you will return to the current page when it is back.',
  ),
  cancel: pick('取消', 'Cancel'),
  confirm: pick('确认重启', 'Restart'),
  restarting: pick('正在重启服务…', 'Restarting service…'),
  failed: pick('重启失败', 'Restart failed'),
  failedHint: pick('服务未能在限时内恢复，请打开终端手动检查并重启 dsh web。', 'The service did not return in time. Please check and restart dsh web manually.'),
  close: pick('关闭', 'Close'),
  retry: pick('重试', 'Retry'),
}

/** Fixed overlay layer is click-through by default; our entry opts back in via CSS. */
export function RestartOverlay(): ReactNode {
  const [phase, setPhase] = useState<Phase>('idle')
  const [errorMsg, setErrorMsg] = useState('')
  const targetRef = useRef<string | null>(null)
  const tokenRef = useRef(0)

  const beginRestart = async (): Promise<void> => {
    targetRef.current = window.location.href
    const token = ++tokenRef.current
    setPhase('restarting')
    setErrorMsg('')
    try {
      const response = await fetch('/api/model-manager/restart', { method: 'POST', cache: 'no-store' })
      if (!response.ok) {
        setPhase('error')
        setErrorMsg(`HTTP ${response.status}`)
        return
      }
    } catch (error) {
      // The host may already be tearing down; a failed ack is fine — the
      // restart still proceeds server-side, so keep polling below.
      setErrorMsg(String(error))
    }
    const origin = window.location.origin
    const started = Date.now()
    const poll = async (): Promise<void> => {
      if (tokenRef.current !== token) return
      try {
        const probe = await fetch(origin + '/', { method: 'GET', cache: 'no-store', redirect: 'follow' })
        if (probe.ok) {
          setPhase('idle')
          window.location.replace(targetRef.current ?? origin)
          return
        }
      } catch {
        // still down — keep polling
      }
      if (Date.now() - started > 45_000) {
        setPhase('error')
        setErrorMsg(COPY.failedHint)
        return
      }
      window.setTimeout(() => void poll(), 1000)
    }
    window.setTimeout(() => void poll(), 1500)
  }

  const cancel = (): void => {
    tokenRef.current += 1
    setPhase('idle')
    setErrorMsg('')
  }

  return (
    <div className={styles['seat']}>
      {phase === 'idle' && (
        <button
          type="button"
          className={styles['button']}
          onClick={() => setPhase('confirm')}
          aria-label={COPY.button}
          title={COPY.button}
        >
          <span className={styles['buttonGlyph']} aria-hidden>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2v10" />
              <path d="M18.4 6.6a9 9 0 1 1-12.8 0" />
            </svg>
          </span>
        </button>
      )}

      {phase === 'confirm' && (
        <div className={styles['card']} role="dialog" aria-modal="true" aria-label={COPY.confirmTitle}>
          <div className={styles['cardTitle']}>{COPY.confirmTitle}</div>
          <div className={styles['cardBody']}>{COPY.confirmBody}</div>
          <div className={styles['cardActions']}>
            <button type="button" className={styles['ghost']} onClick={cancel}>
              {COPY.cancel}
            </button>
            <button type="button" className={styles['primary']} onClick={() => void beginRestart()}>
              {COPY.confirm}
            </button>
          </div>
        </div>
      )}

      {phase === 'restarting' && (
        <div className={styles['card']} role="status" aria-live="polite">
          <div className={styles['restartingRow']}>
            <span className={styles['spinner']} />
            <span className={styles['cardBody']}>{COPY.restarting}</span>
          </div>
        </div>
      )}

      {phase === 'error' && (
        <div className={styles['card']} role="alert">
          <div className={styles['cardTitle']}>{COPY.failed}</div>
          <div className={styles['cardBody']}>{errorMsg || COPY.failedHint}</div>
          <div className={styles['cardActions']}>
            <button type="button" className={styles['ghost']} onClick={cancel}>
              {COPY.close}
            </button>
            <button type="button" className={styles['primary']} onClick={() => void beginRestart()}>
              {COPY.retry}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

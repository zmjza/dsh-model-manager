/**
 * R9#2 — delete the current conversation (client half).
 *
 * A small trash action in the open conversation's header actions
 * (`conversation.session.header.actions`, session-scoped list slot — our own
 * plugin seat, no harness patch). Clicking opens a two-step confirm (hard
 * delete is irreversible), then POSTs /api/model-manager/delete-session to the
 * host, which removes the session's persisted directory. On success the app
 * leaves to the workspace root (the deleted session is gone for good).
 */

import { useState } from 'react'
import type { ReactNode } from 'react'
import type { SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import styles from './DeleteSession.module.css'

/** Props the session-scoped header.actions outlet hands us (session kit). */
export interface DeleteSessionActionProps {
  sessionId: SessionId
}

const COPY = (navigator !== undefined && typeof navigator.language === 'string' && navigator.language.toLowerCase().startsWith('zh'))
  ? {
      label: '删除此对话',
      title: '删除此对话（不可恢复）',
      heading: '删除此对话？',
      body: '此会话的完整聊天记录（含所有工具调用与附件）将被永久删除，无法恢复。',
      cancel: '取消',
      delete: '删除',
      busy: '正在删除…',
      failed: '删除失败，请重试。',
    }
  : {
      label: 'Delete conversation',
      title: 'Delete this conversation (permanent)',
      heading: 'Delete this conversation?',
      body: 'The full chat log (including every tool call and attachment) will be permanently removed and cannot be restored.',
      cancel: 'Cancel',
      delete: 'Delete',
      busy: 'Deleting…',
      failed: 'Deletion failed, please retry.',
    }

/** Render the trash action + confirm modal. */
export function DeleteSessionAction(props: DeleteSessionActionProps): ReactNode {
  const [phase, setPhase] = useState<'idle' | 'confirm' | 'busy' | 'error'>('idle')

  const confirm = async (): Promise<void> => {
    setPhase('busy')
    try {
      const response = await fetch('/api/model-manager/delete-session', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId: String(props.sessionId) }),
      })
      const payload = await response.json().catch(() => null)
      if (response.ok && payload?.ok === true) {
        // Leave to the workspace home; the deleted session is no longer restorable.
        window.location.assign('/')
        return
      }
      setPhase('error')
    } catch {
      setPhase('error')
    }
  }

  return (
    <>
      <button
        type="button"
        className={styles['action']}
        aria-label={COPY.label}
        title={COPY.title}
        onClick={() => setPhase('confirm')}
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M3 6h18" />
          <path d="M8 6V4h8v2" />
          <path d="M6 6l1 14h10l1-14" />
          <path d="M10 11v6" />
          <path d="M14 11v6" />
        </svg>
        <span className={styles['actionLabel']}>{COPY.label}</span>
      </button>

      {phase === 'confirm' || phase === 'busy' || phase === 'error' ? (
        <div className={styles['backdrop']} onMouseDown={(event) => { if (event.target === event.currentTarget && phase !== 'busy') setPhase('idle') }}>
          <div className={styles['card']} role="alertdialog" aria-modal="true" aria-label={COPY.heading}>
            <div className={styles['cardTitle']}>{COPY.heading}</div>
            <div className={styles['cardBody']}>{phase === 'busy' ? COPY.busy : phase === 'error' ? COPY.failed : COPY.body}</div>
            <div className={styles['cardActions']}>
              <button type="button" className={styles['ghost']} disabled={phase === 'busy'} onClick={() => setPhase('idle')}>
                {COPY.cancel}
              </button>
              <button
                type="button"
                className={styles['danger']}
                disabled={phase === 'busy'}
                onClick={() => { void confirm() }}
              >
                {COPY.delete}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}

/**
 * R8 — Tool-call decorator (chat node renderer).
 *
 * Replaces the default `tool-call` chat node renderer via the keyed slot
 * `conversation.chat.node` at a negative priority (registered in index.tsx).
 * It renders pure-colour rows (no card frame):
 *   • a tool-appropriate icon before the name,
 *   • a four-colour accent for the tool name (blue/green/soft-yellow/red —
 *     R8 table; errored calls always red),
 *   • the file being read/written/edited shown right after the name for
 *     read / write / edit (and the deleted path for rm),
 *   • a `+N −M` badge for file-changing tools (R8 ± spec, computed from
 *     arguments — honest about rm / overwrite limits),
 *   • run/settled status, and an expandable flat payload (args JSON + result),
 *   • recursive rendering of nested sub-calls.
 */

import { Component, useState } from 'react'
import type { ReactNode } from 'react'
import type { ChatNode } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ToolCallBlock } from '@deepseek-ai/dsh-client-runtime/client'
import styles from './ToolCardDecorator.module.css'
import { colorOf, diffBadge, type DiffBadge, type ToolColor } from './tool-color.ts'

/** Props the keyed slot actually hands us (the 'tool-call' node; rest is extra). */
export interface ToolCardRenderProps {
  readonly node: ChatNode<'tool-call'>
}

/** Settled tool-call arm (carries `content`; the running arm does not). */
function isResult(root: ToolCallBlock): root is Extract<ToolCallBlock, { content: unknown }> {
  return 'content' in root
}function argsOf(root: ToolCallBlock): { name: string; argsRaw: string } {
  // ToolResultNode carries `call`; RunningToolCall carries name/argsRaw directly.
  return 'call' in root
    ? { name: root.call?.name ?? root.callId, argsRaw: root.call?.argsRaw ?? '{}' }
    : { name: root.name, argsRaw: root.argsRaw }
}

function parseArgs(raw: string): Record<string, unknown> {
  try {
    const value = JSON.parse(raw) as unknown
    return value !== null && typeof value === 'object' ? value as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

/** The file a read/write/edit targets, when the arguments name one. */
function pathOf(tool: string, args: Record<string, unknown>): string | null {
  if (tool === 'bash' || tool === 'exec_command' || tool === 'execute_command') {
    const command = String(args.command ?? args.cmd ?? args.line ?? args.command_lines ?? '')
    const cat = /^(?:sudo\s+)?(?:cat|less|tail|head|grep|rg)\s+([^\s>&|;]+)/.exec(command.trim())
    return cat ? (cat[1] ?? null) : null
  }
  if (!['read', 'write', 'edit', 'glob', 'openpencil'].some((k) => tool.startsWith(k))) return null
  for (const key of ['file_path', 'filePath', 'path', 'file', 'target', 'filename', 'name']) {
    const value = args[key]
    if (typeof value === 'string' && value.length > 0) return value
  }
  return null
}

function shortPath(path: string | null, max = 46): string {
  if (!path) return ''
  return path.length <= max ? path : `${path.slice(0, max - 3)}\u2026`
}

/** Loose result-block shape (text-ish blocks carry `text` or `content`). */
function textOf(blocks: readonly unknown[] | undefined): string {
  if (!blocks) return ''
  return blocks
    .map((block) => {
      const b = block as { type?: unknown; text?: unknown; content?: unknown }
      if (typeof b.text === 'string') return b.text
      if (typeof b.content === 'string') return b.content
      return ''
    })
    .join('\n')
    .trim()
}

/** The ± badge row: only the +N / −M counts carry colour (green add, red
 *  minus); the rest stays with the neutral badge text. */
function BadgeText({ badge }: { badge: DiffBadge }): ReactNode {
  if (badge.kind === 'delete') {
    return (
      <>
        {'\u5220\u9664'} <span className={styles['badgePath']}>{badge.path}</span>
      </>
    )
  }
  if (badge.del === 0) return <span className={styles['badgeAdd']}>+{badge.add}</span>
  if (badge.add === 0) return <span className={styles['badgeMinus']}>\u2212{badge.del}</span>
  return (
    <>
      <span className={styles['badgeAdd']}>+{badge.add}</span>{' '}
      <span className={styles['badgeMinus']}>\u2212{badge.del}</span>
    </>
  )
}

/* ---- per-tool icons (16x16, currentColor → inherits the tool colour) ---- */
function ToolIcon({ name }: { name: string }): ReactNode {
  const icon = ICONS.forName(name)
  return (
    <svg className={styles['icon']} width="14" height="14" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {icon}
    </svg>
  )
}

const SEARCH = <><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></>
const DOC = <><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5" /></>
const DOC_PLUS = <><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5" /><path d="M12 12v6" /><path d="M9 15h6" /></>
const PENCIL = <><path d="M17 3l4 4L8 20l-5 1 1-5z" /></>
const TERMINAL = <><path d="m4 7 5 5-5 5" /><path d="M12 18h8" /></>
const QUESTION = <><circle cx="12" cy="12" r="9" /><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 2.5-3 4" /><path d="M12 17h.01" /></>
const GLOBE = <><circle cx="12" cy="12" r="9" /><path d="M3 12h18" /><path d="M12 3a15 15 0 0 1 0 18a15 15 0 0 1 0-18" /></>
const TRASH = <><path d="M3 6h18" /><path d="M8 6V4h8v2" /><path d="M6 6l1 14h10l1-14" /></>
const ROBOT = <><rect x="5" y="9" width="14" height="11" rx="2" /><path d="M12 5v4" /><circle cx="9" cy="14" r="1.4" /><circle cx="15" cy="14" r="1.4" /></>
const TARGET = <><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1.5" /></>
const CHECK = <><path d="M20 6 9 17l-5-5" /></>
const IMAGE = <><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="9" cy="10" r="1.6" /><path d="m5 19 5-5 3 3 4-4 3 3" /></>
const BOLT = <><path d="M13 2 4 14h6l-1 8 9-12h-6z" /></>
const BRANCH = <><circle cx="6" cy="6" r="2.6" /><circle cx="6" cy="18" r="2.6" /><circle cx="18" cy="8" r="2.6" /><path d="M6 8.6v6.8M8.4 6h6a4 4 0 0 1 0 8" transform="translate(0 0)" /><path d="M18 10.6v4.9" /></>

const READ_NAMES = new Set(['read'])
const WRITE_NAMES = new Set(['write', 'writeText', 'createFile'])
const EDIT_NAMES = new Set(['edit'])
const SEARCH_NAMES = new Set(['grep', 'glob', 'web_search', 'argo_search', 'argo_fetch', 'argo_screenshot', 'argo_research',
  'argo_evidence', 'argo_crawl', 'argo_clarify', 'argo_pdf', 'argo_local_search', 'argo_social_search', 'job_list', 'job_output',
  'mcp__argo__argo_search', 'mcp__argo__argo_fetch', 'mcp__argo__argo_screenshot'])
const SHELL_NAMES = new Set(['bash', 'exec_command', 'execute_command'])
const ASK_NAMES = new Set(['ask_user_question'])
const DESTROY_NAMES = new Set(['job_kill', 'interrupt_agent'])
const AGENT_NAMES = new Set(['subagent', 'subagent_fork', 'workflow', 'ralph'])
const GOAL_NAMES = new Set(['create_goal', 'update_goal', 'get_goal'])
const IMG_NAMES = new Set(['read_image', 'modlens_read_image', 'openpencil_new', 'openpencil_create', 'openpencil_edit', 'openpencil_render', 'openpencil_selection'])
const TODO_NAMES = new Set(['todo_write', 'send_message', 'skill'])

const ICONS = {
  forName(name: string): ReactNode {
    if (READ_NAMES.has(name)) return DOC
    if (WRITE_NAMES.has(name)) return DOC_PLUS
    if (EDIT_NAMES.has(name) || /^openpencil_(edit|create)/.test(name)) return PENCIL
    if (SHELL_NAMES.has(name)) return TERMINAL
    if (name.startsWith('git')) return BRANCH
    if (SEARCH_NAMES.has(name)) return SEARCH
    if (DESTROY_NAMES.has(name) || name === 'rm') return TRASH
    if (ASK_NAMES.has(name)) return QUESTION
    if (AGENT_NAMES.has(name)) return ROBOT
    if (GOAL_NAMES.has(name) || TODO_NAMES.has(name)) return name === 'todo_write' || name === 'update_goal' ? CHECK : TARGET
    if (IMG_NAMES.has(name)) return IMAGE
    if (/^argo|fetch|api|remote|mcp|http/.test(name)) return GLOBE
    return BOLT
  },
}

/** One root Tool lifecycle (recursively renders sub-calls). */
function ToolRow({ root, depth }: { root: ToolCallBlock; depth: number }): ReactNode {
  const [expanded, setExpanded] = useState(false)
  const { name, argsRaw } = argsOf(root)
  const args = parseArgs(argsRaw)
  const running = !isResult(root)
  const isError = isResult(root) && Boolean(root.isError)
  const color: ToolColor = isError ? 'red' : colorOf(name, args)
  const badge = diffBadge(name, args)
  const path = pathOf(name, args)
  const resultText = isResult(root) ? textOf(root.content) : ''
  const subs = Array.isArray(root.subCalls) ? root.subCalls : []

  return (
    <div className={styles['row']} data-depth={depth} data-color={color} data-mm-tool={name} data-error={isError || undefined}>
      <button
        type="button"
        className={styles['head']}
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        <ToolIcon name={name} />
        <span className={`${styles['statusDot']} ${running ? styles['dotRunning'] : ''}`} aria-hidden />
        <span className={styles['name']}>{name}</span>
        {path ? <span className={styles['path']} title={path}>{shortPath(path)}</span> : null}
        {badge ? <span className={styles['badge']}><BadgeText badge={badge} /></span> : null}
        <span className={styles['chevron']} aria-hidden>{expanded ? '\u25BE' : '\u25B8'}</span>
      </button>
      {expanded ? (
        <div className={styles['details']}>
          <div className={styles['sectionTitle']}>Arguments</div>
          <pre className={styles['pre']}>{pretty(argsRaw)}</pre>
          {resultText ? (
            <>
              <div className={styles['sectionTitle']}>Result{isError ? ' (error)' : ''}</div>
              <pre className={`${styles['pre']} ${isError ? styles['preError'] : ''}`}>{resultText.slice(0, 4000)}</pre>
            </>
          ) : running ? (
            <div className={styles['runningHint']}>running\u2026</div>
          ) : null}
        </div>
      ) : null}
      {subs.length > 0 ? (
        <div className={styles['children']}>
          {subs.map((sub) => <ToolRow key={sub.callId} root={sub} depth={depth + 1} />)}
        </div>
      ) : null}
    </div>
  )
}

function pretty(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2)
  } catch {
    return raw
  }
}

/** React error boundary: a malformed tool node must never take the whole chat
 *  view down. Any render exception inside the card falls back to a plain,
 *  still-clickable row instead of crashing the slot (which would freeze the
 *  conversation right at the bash card — the "stops at bash" symptom). */
class CardBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false }

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true }
  }

  override render(): ReactNode {
    if (this.state.failed) {
      return (
        <div className={styles['row']} data-color="red" data-error>
          <span className={styles['name']}>tool-call</span>
          <span className={styles['badge']}>render error</span>
        </div>
      )
    }
    return this.props.children
  }
}

/** R8 decorator component bound to the 'tool-call' chat node. */
export function ToolCardDecorator(props: ToolCardRenderProps): ReactNode {
  const root = props.node?.data?.root
  if (!root) return null
  return (
    <CardBoundary>
      <ToolRow root={root} depth={0} />
    </CardBoundary>
  )
}

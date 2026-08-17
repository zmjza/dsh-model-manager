/**
 * R8 — Tool-call decoration data: the four-colour classification and the
 * file-change ± line summary.
 *
 * Colours (one fixed set, D4):
 *   blue  = read / query / info
 *   green = create / generate
 *   yellow= modify / update / interact
 *   red   = delete / interrupt / failure (and any errored call)
 * `bash` is classified by the semantics of its leading command (D1).
 *
 * The ± badge is honest about what the client can see (2.3/2.5): `edit`
 * computes the old→new line diff from its arguments; `write` counts the new
 * content lines (the removed lines of an overwrite are not available
 * client-side); an `rm` shows the path without a line count.
 */

export type ToolColor = 'blue' | 'green' | 'yellow' | 'red'

/** Tools that read/query — blue. */
const READ_TOOLS = new Set([
  'read', 'glob', 'grep', 'list_agents', 'job_list', 'job_output', 'get_goal',
  'read_image', 'modlens_read_image', 'skill', 'openpencil_selection',
  'web_search', 'argo_search', 'argo_fetch', 'argo_screenshot', 'argo_research',
  'argo_evidence', 'argo_pdf', 'argo_crawl', 'argo_local_search', 'argo_social_search',
  'mcp__argo__argo_search', 'mcp__argo__argo_fetch', 'mcp__argo__argo_screenshot',
])

/** Tools that create/spawn — green. */
const CREATE_TOOLS = new Set([
  'write', 'create_goal', 'subagent', 'subagent_fork', 'workflow', 'ralph',
  'openpencil_new',
])

/** Tools that delete/interrupt — red. */
const DESTROY_TOOLS = new Set(['job_kill', 'interrupt_agent'])

/** Leading command → colour for `bash`. */
function bashColor(command: string): ToolColor {
  const head = command.trim().replace(/^sudo\s+/, '').replace(/^(\w+)=(\S+)\s+(.*)$/, '$3').toLowerCase()
  if (/^(rm|rmdir|unlink|kill|pkill|killall)\b/.test(head)) return 'red'
  if (/^(git\s+(reset\s+--hard|clean\s+-[a-z]*f|push\s+-[a-z]*f|branch\s+-D)|pnpm\s+(remove|uninstall)|npm\s+(uninstall|rm))\b/.test(head)) return 'red'
  if (/^(ls|cat|pwd|head|tail|less|more|echo|ps|top|df|du|stat|which|whoami|env|find|rg|grep|git\s+(status|diff|log|show)|pnpm\s+(ls|why)|curl|wget)\b/.test(head)) return 'blue'
  if (/^(mkdir|touch|git\s+init|install\s+-)?(mkdir|touch)\b/.test(head)) return 'green'
  return 'yellow'
}

/** Classify one tool call. */
export function colorOf(tool: string, args: Record<string, unknown>): ToolColor {
  if (tool === 'bash' || tool === 'exec_command' || tool === 'execute_command') {
    const command = String(args.command ?? args.cmd ?? args.line ?? args.command_lines ?? '')
    return bashColor(command)
  }
  if (DESTROY_TOOLS.has(tool)) return 'red'
  if (CREATE_TOOLS.has(tool)) {
    // A `write` that targets an existing file is a modification (yellow)…
    // Without old content we can't be sure; treat as green per R8 table.
    return 'green'
  }
  if (READ_TOOLS.has(tool)) return 'blue'
  return 'yellow'
}

/** A parseable ± summary. */
export interface FileDiffBadge {
  kind: 'text'
  /** Lines added. */
  add: number
  /** Lines removed. */
  del: number
}
/** A deletion marker (no reliable line count client-side). */
export interface DeleteBadge {
  kind: 'delete'
  path: string
}

export type DiffBadge = FileDiffBadge | DeleteBadge

/** Lowercase amino command matchers for `rm` (skips option flags, keeps a path). */
const RM_RE = /(?:^|\n)\s*(?:sudo\s+)?(?:rm|rmdir|unlink)\b(?:\s+-[^\s]+)*(?:\s+)([^\s;&|$]+)/
const WRITE_ARGS = new Set(['content', 'contents', 'newContent', 'text'])

/** Longest-common-subsequence line count (small inputs only). */
function lcsLineLength(a: readonly string[], b: readonly string[]): number {
  const n = a.length
  const m = b.length
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    const row = dp[i] as number[]
    const next = dp[i + 1] as number[]
    for (let j = m - 1; j >= 0; j--) {
      row[j] = a[i] === b[j]
        ? (next[j + 1] as number) + 1
        : Math.max(next[j] as number, row[j + 1] as number)
    }
  }
  return (dp[0] as number[])[0] as number
}

/** Compute the honest ± badge for a file-changing tool call. */
export function diffBadge(tool: string, args: Record<string, unknown>): DiffBadge | null {
  if (tool === 'edit') {
    const oldText = String(args.old_string ?? args.old_value ?? args.before ?? '')
    const newText = String(args.new_string ?? args.new_value ?? args.after ?? '')
    if (oldText || newText) {
      const a = oldText.split('\n')
      const b = newText.split('\n')
      const lcs = lcsLineLength(a, b)
      return { kind: 'text', add: b.length - lcs, del: a.length - lcs }
    }
    return null
  }
  if (tool === 'write' || tool === 'writeText' || tool === 'createFile') {
    const content = WRITE_ARGS.size
      ? [args.content, args.contents, args.newContent, args.text].find((v) => typeof v === 'string')
      : args.content
    if (typeof content === 'string') {
      const lines = content === '' ? 0 : content.split('\n').length
      return { kind: 'text', add: lines, del: 0 }
    }
    return null
  }
  if (tool === 'bash' || tool === 'exec_command' || tool === 'execute_command') {
    const command = String(args.command ?? args.cmd ?? args.line ?? args.command_lines ?? '')
    const rm = RM_RE.exec(command)
    const fallback = command.trim().split(/\s+/).pop() ?? command
    if (rm) return { kind: 'delete', path: rm[1] && rm[1].length > 0 ? rm[1] : fallback }
  }
  return null
}

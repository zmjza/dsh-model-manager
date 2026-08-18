/**
 * Models settings section: the provider rows joined from the configurable
 * directory, settings namespaces, and credential states, with one editor
 * card at a time. Rows expose only confirmed API-key state through accessible
 * solid configured or missing dots. A whole-section provider without a
 * configured key renders as its open setup card instead of a row, but only in
 * the first-run posture — no provider on the page can serve requests yet — and
 * only until the user closes that card; the add flow is a card carrying the
 * dormant-provider select. Each card kind owns its own open state, so closing
 * one never discards a draft in another. Every mutation writes through the
 * wire, while a provider removal first requires confirmation; the page
 * re-renders from pushed invalidations or the post-apply reload.
 */

import { useState } from 'react'
import type { ReactNode } from 'react'
import type { IApiClient } from '@deepseek-ai/dsh-api-remotes/client'
import { Button, IconPlusOutline16, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SnapshotSelectorHook } from '@deepseek-ai/dsh-client-web-react'
import { CustomProviderCard } from './CustomProviderCard.tsx'
import { deriveKeyRef, isFamilyRoute, messageOf, nextRouteId, protocolChoices, providerUsable } from './store.ts'
import { getPath } from '@deepseek-ai/dsh-client-schema-form'
import type { ModelsSettingsState, ModelsSettingsStore, ProviderRow } from './store.ts'
import { ProviderEditor, type ProviderEditorProps } from './ProviderEditor.tsx'
import type { en } from './locales.ts'
import styles from './ModelsSection.module.css'

/** Injected dependencies of {@link ModelsSection} (slot `inject`). */
export interface ModelsSectionInjected {
  /** The page store (loaded on mount, refreshed on pushed invalidations). */
  controller: ModelsSettingsStore
  /** uSES subscription hook bound to the store. */
  useSnapshot: SnapshotSelectorHook<ModelsSettingsState>
  /** Wire faces the editor writes through. */
  api: Pick<IApiClient, 'settings' | 'credentials' | 'llm'>
  /** Section copy. */
  t: (key: keyof typeof en) => string
}

/**
 * Props delivered by the slot outlet: the inject face spread flat (the
 * renderer erases the share boundary at the render call).
 */
export type ModelsSectionProps = Partial<ModelsSectionInjected>

/** Provider identity shared by row actions and confirmation copy. */
export interface ProviderIdentity {
  /** Stable provider route id. */
  provider: string
  /** Human-facing provider name. */
  displayName: string
}

/** One existing row or dormant directory entry addressed by an editor action. */
interface EditorTarget extends ProviderIdentity {
  settingsNs: string
  settingsPath: readonly string[]
  /** Writable credential identified under this page's conventional reference. */
  credentialRef?: string
  /** The adapter reports this route as one it does not ship (see {@link ProviderEditorProps.declared}). */
  declared?: boolean
}

/** Values that vary around the shared provider-editor rendering. */
interface ProviderEditorRenderProps extends Pick<
  ProviderEditorProps,
  'namespace' | 'api' | 't' | 'readOnly' | 'onClose'
> {
  target: EditorTarget
}

/** Render an editor for either the setup posture or an expanded provider row. */
function renderProviderEditor({ target, ...props }: ProviderEditorRenderProps): ReactNode {
  return (
    <ProviderEditor
      provider={target.provider}
      displayName={target.displayName}
      settingsPath={target.settingsPath}
      {...target.declared === true ? { declared: true } : {}}
      {...props}
    />
  )
}

/**
 * Remove one user-added provider and its page-managed credential. Credential
 * removal comes first so a second-step failure leaves the provider row visible
 * and the whole operation safely retryable; both unsets are idempotent.
 * The settings removal names the profile rather than rebuilding its whole
 * namespace from a partial view.
 * @param api - settings and credential wire faces.
 * @param controller - the page store to refresh.
 * @param target - the provider's settings address and optional managed credential.
 * @returns the failure message, or undefined once the write and reload landed.
 */
export async function removeProviderProfile(
  api: Pick<IApiClient, 'settings' | 'credentials'>,
  controller: ModelsSettingsStore,
  target: { settingsNs: string; settingsPath: readonly string[]; credentialRef?: string },
): Promise<string | undefined> {
  try {
    if (target.credentialRef !== undefined) {
      const credential = await api.credentials.unset({ ref: target.credentialRef })
      if (!credential.result.ok) return credential.result.error.message
    }
    const response = await api.settings.mutate({
      ns: target.settingsNs,
      ops: [{ op: 'unset', path: [...target.settingsPath] }],
    })
    if (!response.result.ok) return response.result.error.message
  } catch (error) {
    // The transport rejected rather than answering; the caller must be able
    // to retry the idempotent operation instead of the row silently staying.
    return messageOf(error)
  }
  await controller.load()
  return undefined
}

/**
 * Whether a whole-section provider still needs its first key: an unconfigured
 * credential opens the setup card instead of showing a row. This is the
 * first-run posture alone — a user who can already reach some provider gets an
 * ordinary row with the missing-key dot, since nothing here is blocking them.
 * @param row - the joined provider row.
 * @param anyUsable - whether any joined row can already serve requests.
 * @returns whether to render the setup card.
 */
export function needsSetup(row: ProviderRow, anyUsable: boolean): boolean {
  if (anyUsable) return false
  if (row.entry.settingsPath.length > 0) return false
  return row.credential?.configured !== true
}

function targetOf(row: ProviderRow): EditorTarget {
  const managedRef = deriveKeyRef(row.entry.provider)
  const credentialRef = row.apiKeyEnv === managedRef
    && row.credential?.configured === true
    && row.credential.writable
    ? managedRef
    : undefined
  return {
    provider: row.entry.provider,
    displayName: row.entry.displayName,
    settingsNs: row.entry.settingsNs,
    settingsPath: row.entry.settingsPath,
    ...credentialRef === undefined ? {} : { credentialRef },
    // Absent is not "shipped": an adapter that answers nothing leaves the
    // route-level fields only a declared route owns off the card, exactly as
    // it leaves the custom tag off the row.
    ...row.entry.declared === true ? { declared: true } : {},
  }
}

/** Stable visible and accessible identity for one provider target. */
export function providerTargetLabel(target: ProviderIdentity): string {
  return target.provider === target.displayName
    ? target.provider
    : `${target.displayName} (${target.provider})`
}

/** Replace the one provider placeholder in localized destructive-action copy. */
export function providerCopy(template: string, target: ProviderIdentity): string {
  return template.replace('{provider}', () => providerTargetLabel(target))
}

/** The classified outcome of a 「测试连通性」 probe, as returned by the host. */
interface TestProbeResult {
  ok: boolean
  kind?: string
  latencyMs?: number
  model?: string
  detail?: string
  reply?: string
}

/** Localize a probe verdict. */
function testLabel(t: (key: keyof typeof en) => string, result: TestProbeResult): string {
  if (result.ok && result.kind === 'ok') {
    return t('testOk')
      .replace('{model}', result.model ?? '?')
      .replace('{ms}', String(result.latencyMs ?? '?'))
  }
  const base = result.kind === 'auth' ? t('testAuth')
    : result.kind === 'network' ? t('testNetwork')
      : result.kind === 'timeout' ? t('testTimeout')
        : result.kind === 'missing' ? t('testMissing')
          : result.kind === 'model' ? t('testModel')
            : t('testInvalid')
  return result.detail === undefined || result.detail.length === 0
    ? base
    : `${base}${t('testDetail').replace('{detail}', result.detail)}`
}

/**
 * Render the Models section content column.
 * @param props - slot-delivered injected dependencies.
 * @returns the section, or null while the shell has not injected yet.
 */
export function ModelsSection(props: ModelsSectionProps): ReactNode {
  const { controller, useSnapshot, api, t } = props
  if (controller === undefined || useSnapshot === undefined || api === undefined || t === undefined) return null
  return <Loaded injected={{ controller, useSnapshot, api, t }} />
}

function Loaded({ injected }: { injected: ModelsSectionInjected }): ReactNode {
  const { controller, api, t } = injected
  const state = injected.useSnapshot(snapshot => snapshot)
  const [editing, setEditing] = useState<EditorTarget | undefined>(undefined)
  const [adding, setAdding] = useState(false)
  // Same-family multi-gateway flow: the family route id being cloned into a
  // new instance (its route id, not a configured route's address).
  const [cloningFamily, setCloningFamily] = useState<string | undefined>(undefined)
  const [deleteTarget, setDeleteTarget] = useState<EditorTarget | undefined>(undefined)
  const [deleting, setDeleting] = useState(false)
  const [deleteFailure, setDeleteFailure] = useState<string | undefined>(undefined)
  const [savedTarget, setSavedTarget] = useState<ProviderIdentity | undefined>(undefined)
  const [declaring, setDeclaring] = useState(false)
  const [dismissedSetup, setDismissedSetup] = useState<ReadonlySet<string>>(() => new Set())
  // 「测试连通性」 modal: which provider it is open for, the pickable models,
  // the chosen one, and the console log the probe appends to as it runs.
  const [testOpen, setTestOpen] = useState<string | undefined>(undefined)
  const [testOptions, setTestOptions] = useState<readonly string[]>([])
  const [testModel, setTestModel] = useState<string>('')
  const [testBusy, setTestBusy] = useState(false)
  const [testLog, setTestLog] = useState<readonly { kind: 'info' | 'ok' | 'err'; text: string }[]>([])
  // The live-streamed reply, shown as one 响应: line that grows as deltas arrive.
  const [testReply, setTestReply] = useState('')
  // The final verdict line (✓ 测试完成! / ✗ 测试失败: …).
  const [testOutcome, setTestOutcome] = useState<{ ok: boolean; text: string } | undefined>(undefined)
  // Measured round-trip time shown as a status chip once the probe completes.
  const [testLatency, setTestLatency] = useState<number | undefined>(undefined)
  // 「各模型重试」 panel: which provider row it is open for + per-id edits.
  const [retryOpen, setRetryOpen] = useState<string | undefined>(undefined)
  const [retryDrafts, setRetryDrafts] = useState<Readonly<Record<string, string>>>({})
  const [retrySaving, setRetrySaving] = useState(false)
  const [retryNotice, setRetryNotice] = useState<string | undefined>(undefined)

  /** Open the test modal for one row, preloading its pickable models. */
  const openTest = (row: ProviderRow): void => {
    const namespace = state.namespaces.get(row.entry.settingsNs)
    const profile = namespace === undefined
      ? undefined
      : getPath(namespace.value, row.entry.settingsPath) as { models?: unknown[] } | undefined
    const models = Array.isArray(profile?.models) ? profile.models : []
    const ids: string[] = []
    for (const entry of models) {
      if (typeof entry === 'object' && entry !== null && typeof (entry as { id?: unknown }).id === 'string') {
        ids.push((entry as { id: string }).id)
      }
    }
    setTestOptions(ids)
    setTestModel(ids[0] ?? '')
    setTestLog([])
    setTestReply('')
    setTestOutcome(undefined)
    setTestLatency(undefined)
    setTestOpen(row.entry.provider)
  }

  /** Run the probe for the modal's chosen model, appending to the log. */
  const runTest = async (): Promise<void> => {
    if (testOpen === undefined || testModel.trim().length === 0) return
    const row = state.rows.find(candidate => candidate.entry.provider === testOpen)
    if (row === undefined) return
    const append = (kind: 'info' | 'ok' | 'err', text: string): void => {
      setTestLog(current => [...current, { kind, text }])
    }
    setTestBusy(true)
    setTestReply('')
    setTestOutcome(undefined)
    append('info', t('testLogStart').replace('{name}', providerTargetLabel(targetOf(row))))
    append('info', t('testLogType').replace('{type}', 'apikey'))
    append('info', t('testLogModel').replace('{model}', testModel.trim()))
    append('info', t('testLogSend'))
    try {
      const response = await fetch('/api/model-manager/test-provider', {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
        body: JSON.stringify({ provider: testOpen, model: testModel.trim() }),
        cache: 'no-store',
      })
      if (!response.ok) {
        const data = await response.json().catch(() => ({})) as { error?: string }
        append('err', t('testLogBad').replace('{reason}', data.error ?? `HTTP ${response.status}`))
        return
      }
      if (response.body === null) {
        append('err', t('testLogBad').replace('{reason}', 'empty stream'))
        return
      }
      // Consume the host's server-sent events and update the console live.
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let currentEvent = ''
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        let index: number
        while ((index = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, index).trim()
          buffer = buffer.slice(index + 1)
          if (line.length === 0) { currentEvent = ''; continue }
          if (line.startsWith('event:')) {
            currentEvent = line.slice(6).trim()
            continue
          }
          if (!line.startsWith('data:')) continue
          const payload = line.slice(5).trim()
          let data: Record<string, unknown>
          try { data = JSON.parse(payload) as Record<string, unknown> } catch { continue }
          if (currentEvent === 'connected') {
            append('info', t('testLogConnected'))
          } else if (currentEvent === 'content') {
            const text = typeof data['text'] === 'string' ? data['text'] : ''
            if (text.length > 0) setTestReply(current => current + text)
          } else if (currentEvent === 'complete') {
            const text = typeof data['text'] === 'string' ? data['text'] : ''
            if (text.length > 0) setTestReply(text)
            setTestOutcome({ ok: true, text: t('testDone') })
          } else if (currentEvent === 'latency') {
            if (typeof data['ms'] === 'number') setTestLatency(data['ms'])
          } else if (currentEvent === 'error') {
            const detail = typeof data['detail'] === 'string' ? data['detail'] : String(data['kind'] ?? '')
            const kind = typeof data['kind'] === 'string' ? data['kind'] : 'invalid'
            setTestOutcome({
              ok: false,
              text: t('testLogBad').replace('{reason}', testLabel(t, { ok: false, kind, detail })),
            })
          }
        }
      }
      // Stream ended without a verdict (e.g. a gateway that streams nothing):
      // a connected live stream still counts as a passing connectivity test.
      setTestOutcome(current => current ?? { ok: true, text: t('testDone') })
    } catch (error) {
      append('err', t('testLogBad').replace('{reason}', String(error)))
      setTestOutcome({ ok: false, text: t('testLogBad').replace('{reason}', String(error)) })
    } finally {
      setTestBusy(false)
    }
  }

  /** Open the per-model retry editor for one row, seeding drafts from settings. */
  const openRetry = (row: ProviderRow): void => {
    const namespace = state.namespaces.get(row.entry.settingsNs)
    const profile = namespace === undefined
      ? undefined
      : getPath(namespace.value, row.entry.settingsPath) as { models?: unknown[] } | undefined
    const models = Array.isArray(profile?.models) ? profile.models : []
    const drafts: Record<string, string> = {}
    for (const entry of models) {
      if (typeof entry !== 'object' || entry === null) continue
      const model = entry as Record<string, unknown>
      if (typeof model['id'] !== 'string') continue
      drafts[model['id']] = String(typeof model['maxRetries'] === 'number' ? model['maxRetries'] : 5)
    }
    setRetryDrafts(drafts)
    setRetryNotice(undefined)
    setRetryOpen(row.entry.provider)
  }

  /** Save the per-model retry counts and re-derive the provider's effective one. */
  const saveRetry = async (row: ProviderRow): Promise<void> => {
    const models = Object.entries(retryDrafts).map(([id, text]) => ({
      id,
      maxRetries: Number.parseInt(text.replace(/\D/g, ''), 10) || 5,
    }))
    if (models.length === 0) return
    setRetrySaving(true)
    setRetryNotice(undefined)
    try {
      const response = await fetch('/api/model-manager/update-model-retry', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ provider: row.entry.provider, models }),
        cache: 'no-store',
      })
      const data = await response.json().catch(() => ({})) as { ok?: boolean; error?: string }
      if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`)
      setRetryNotice(t('retrySaved'))
      void controller.load()
    } catch (error) {
      setRetryNotice(String(error))
    } finally {
      setRetrySaving(false)
    }
  }

  const announceSaved = (target: ProviderIdentity): void => {
    // Announced only once the refreshed directory is in the snapshot the
    // notice reads its name from: an apply can rename the route, and the
    // target captured when the card opened still carries the old name.
    void controller.load().then(() => { setSavedTarget(target) })
  }

  const closeEditor = (changed: boolean, target: ProviderIdentity): void => {
    setEditing(undefined)
    setAdding(false)
    setCloningFamily(undefined)
    setDeclaring(false)
    if (changed) announceSaved(target)
  }

  /**
   * Close a setup card, which owns none of the state above: the row-editor,
   * add, and declare cards each own one of those, so clearing them here would
   * discard a draft the user opened beside this card. Dismissal is this card's
   * own — the provider falls back to an ordinary row for the rest of the
   * session, and reopens through Edit.
   */
  const closeSetup = (changed: boolean, target: ProviderIdentity): void => {
    setDismissedSetup(previous => new Set([...previous, target.provider]))
    if (changed) announceSaved(target)
  }

  const closeDelete = (): void => {
    if (deleting) return
    setDeleteTarget(undefined)
    setDeleteFailure(undefined)
  }

  const confirmDelete = (): void => {
    /* v8 ignore next -- the action only renders with a target and is disabled while a deletion is pending */
    if (deleteTarget === undefined || deleting) return
    setDeleting(true)
    setDeleteFailure(undefined)
    void removeProviderProfile(api, controller, deleteTarget)
      .then((failure) => {
        if (failure !== undefined) {
          setDeleteFailure(failure)
          return
        }
        setDeleteTarget(undefined)
      })
      .finally(() => { setDeleting(false) })
  }

  if (state.status === 'idle') void controller.load()
  if (state.status === 'error') {
    /* v8 ignore next -- an error status always carries text; the fallback satisfies the nullable type */
    const errorText = state.error ?? ''
    return (
      <div className={styles['section']}>
        <p className={styles['error']}>{`${t('loadFailed')}: ${errorText}`}</p>
        <button type="button" className={styles['secondaryButton']} onClick={() => { void controller.load() }}>
          {t('retry')}
        </button>
      </div>
    )
  }

  // The saved provider as the directory currently names it. The route id is
  // what the apply cannot change, so it is what the notice is keyed by; a row
  // the same apply removed keeps the captured identity, since nothing newer
  // exists to name it with.
  const savedRow = savedTarget === undefined
    ? undefined
    : state.rows.find(row => row.entry.provider === savedTarget.provider)
  const savedIdentity = savedRow === undefined
    ? savedTarget
    : { provider: savedRow.entry.provider, displayName: savedRow.entry.displayName }

  // One fact decides both first-run postures on this page and the onboarding
  // step: whether the user already has a provider to talk to.
  const anyUsable = state.rows.some(providerUsable)
  const configured = state.rows.filter(row => row.configured)
  // Every configurable family (indexed by route id), configured or dormant, so
  // a family can always be added again — the same-family multi-gateway flow.
  // Catalogue routes without a settings address have nothing to write and stay
  // off the picker, exactly as before.
  const families = state.rows.filter(row => row.entry.settingsNs !== '')
  const instanceCount = (family: string): number =>
    state.rows.filter(row => isFamilyRoute(row.entry.provider, family)).length
  /**
   * The dormant (unconfigured) directory row for a family, when adopting it
   * for the first time — the official flow: the route is the family id itself
   * and the editor only asks for a key and optional extras.
   */
  const dormantOf = (family: string): ProviderRow | undefined =>
    state.rows.find(row => row.entry.provider === family && !row.configured)
  const familyConfigured = (family: string): boolean =>
    state.rows.some(row => isFamilyRoute(row.entry.provider, family) && row.configured)
  // Hand-declared routes live in the pi-ai namespace, which is also the only
  // one whose schema names the protocols one may speak; without it mounted
  // there is nothing to declare and the entry point stays disabled.
  const protocols = protocolChoices(state.namespaces.get('llm-pi-ai'))
  // The family being added: its dormant directory row when adopting it for the
  // first time (route = family id, official editor), or undefined when it is
  // already configured and a same-family clone is being created instead.
  const addingFamily = cloningFamily
  const dormant = addingFamily === undefined ? undefined : dormantOf(addingFamily)
  const cloningRoute = addingFamily === undefined
    ? undefined
    : nextRouteId(addingFamily, state.rows.map(row => row.entry.provider))
  // A first-time adopted family routes under its own id and edits via the
  // official provider editor (key + extras, route fixed). An already-configured
  // family is cloned under an incremental route with a distinct relay endpoint.
  const cloningAsConfigured = addingFamily !== undefined && familyConfigured(addingFamily)
  const cloning = addingFamily === undefined
    ? undefined
    : state.rows.find(row => row.entry.provider === addingFamily)
  const addNamespace = dormant === undefined ? undefined : state.namespaces.get(dormant.entry.settingsNs)

  return (
    <div className={styles['section']}>
      <h2 className={styles['title']}>{t('title')}</h2>
      <p className={styles['intro']}>{t('intro')}</p>
      <p className={styles['notice']}>{t('sharedHint')}</p>
      {!state.writable && state.status === 'ready' ? <p className={styles['notice']}>{t('readOnly')}</p> : null}
      {savedIdentity === undefined
        ? null
        : (
          <p className={styles['savedNotice']} role="status" aria-live="polite">
            {providerCopy(t('savedProvider'), savedIdentity)}
          </p>
        )}
      <ul className={styles['rows']}>
        {configured.map((row) => {
          const target = targetOf(row)
          const namespace = state.namespaces.get(target.settingsNs)
          /* v8 ignore next -- the join marks a row configured only when its namespace resolved */
          if (namespace === undefined) return null
          if (needsSetup(row, anyUsable) && !dismissedSetup.has(row.entry.provider)) {
            // First-run posture: the provider exists but has no key — the
            // setup card IS its presence on the page, until the user closes it.
            return (
              <li key={row.entry.provider} className={styles['setupCard']}>
                {renderProviderEditor({
                  target,
                  namespace,
                  api,
                  t,
                  readOnly: !state.writable,
                  onClose: (changed) => { closeSetup(changed, target) },
                })}
              </li>
            )
          }
          const open = !adding && editing?.provider === row.entry.provider
          const credentialConfigured = row.credential?.configured === true
          const credentialMissing = !credentialConfigured
            && row.apiKeyEnv !== undefined
            && row.credential?.configured === false
          const retryIsOpen = retryOpen === row.entry.provider
          return (
            <li key={row.entry.provider} className={styles['rowCard']}>
              <div className={styles['rowHead']}>
                <span className={styles['rowIdentity']}>
                  <span className={styles['rowName']}>{row.entry.displayName}</span>
                  {/* Only the adapter can tell a hand-declared route from a
                      shipped one it also has a stored profile for, so the tag
                      follows its answer and stays off when it gives none. */}
                  {row.entry.declared === true
                    ? <span className={styles['rowTag']}>{t('customTag')}</span>
                    : null}
                  {credentialConfigured
                    ? (
                      <span
                        className={`${styles['credentialDot']} ${styles['credentialDotConfigured']}`}
                        role="img"
                        aria-label={t('credentialConfigured')}
                        title={t('credentialConfigured')}
                      />
                    )
                    : credentialMissing
                      ? (
                        <span
                          className={`${styles['credentialDot']} ${styles['credentialDotMissing']}`}
                          role="img"
                          aria-label={t('credentialMissing')}
                          title={t('credentialMissing')}
                        />
                      )
                      : null}
                </span>
                <span className={styles['rowActions']}>
                  <button
                    type="button"
                    className={styles['secondaryButton']}
                    aria-label={providerCopy(t('editProvider'), target)}
                    onClick={() => {
                      setSavedTarget(undefined)
                      // One card at a time: leaving `declaring` set would show
                      // the create card beside this editor, and closing either
                      // one discards the other's draft.
                      setDeclaring(false)
                      setAdding(false)
                      setEditing(open ? undefined : target)
                    }}
                  >
                    {t('edit')}
                  </button>
                  {row.entry.settingsNs === 'llm-pi-ai' && (
                    <>
                      <button
                        type="button"
                        className={styles['secondaryButton']}
                        aria-label={providerCopy(t('testLink'), target)}
                        disabled={!state.writable}
                        onClick={() => { openTest(row) }}
                      >
                        {t('testLink')}
                      </button>
                      <button
                        type="button"
                        className={styles['secondaryButton']}
                        aria-label={providerCopy(t('retrySettings'), target)}
                        disabled={!state.writable}
                        onClick={() => {
                          if (retryOpen === row.entry.provider) setRetryOpen(undefined)
                          else openRetry(row)
                        }}
                      >
                        {t('retrySettings')}
                      </button>
                    </>
                  )}
                  {row.removable
                    ? (
                      <button
                        type="button"
                        className={styles['dangerButton']}
                        aria-label={providerCopy(t('removeProvider'), target)}
                        disabled={!state.writable}
                        onClick={() => {
                          setSavedTarget(undefined)
                          setDeleteFailure(undefined)
                          setDeleteTarget(target)
                        }}
                      >
                        {t('remove')}
                      </button>
                    )
                    : null}
                </span>
              </div>
              {retryIsOpen
                ? (() => {
                  const retryNamespace = state.namespaces.get(row.entry.settingsNs)
                  const retryProfile = retryNamespace === undefined
                    ? undefined
                    : getPath(retryNamespace.value, row.entry.settingsPath) as { models?: unknown[] } | undefined
                  const retryModels = Array.isArray(retryProfile?.models) ? retryProfile.models : []
                  return (
                    <div className={styles['retryPanel']}>
                      <p className={styles['notice']}>{t('retryHint')}</p>
                      <div className={styles['retryModelList']}>
                        {retryModels.map((entry) => {
                          if (typeof entry !== 'object' || entry === null) return null
                          const model = entry as Record<string, unknown>
                          if (typeof model['id'] !== 'string') return null
                          const id = model['id']
                          return (
                            <label key={id} className={styles['retryModelRow']}>
                              <span className={styles['retryModelId']}>{id}</span>
                              <input
                                className={styles['input']}
                                type="number"
                                min={0}
                                max={20}
                                step={1}
                                value={retryDrafts[id] ?? '5'}
                                aria-label={`${t('modelRetry')} ${id}`}
                                disabled={!state.writable || retrySaving}
                                onChange={(event) => {
                                  const text = event.target.value.replace(/[^\d]/g, '')
                                  setRetryDrafts(current => ({ ...current, [id]: text }))
                                }}
                              />
                            </label>
                          )
                        })}
                      </div>
                      <div className={styles['retryActions']}>
                        <button
                          type="button"
                          className={styles['secondaryButton']}
                          disabled={retrySaving}
                          onClick={() => {
                            const next: Record<string, string> = {}
                            for (const key of Object.keys(retryDrafts)) next[key] = '5'
                            setRetryDrafts(next)
                          }}
                        >
                          {t('retryReset')}
                        </button>
                        <button
                          type="button"
                          className={styles['primaryButton']}
                          disabled={!state.writable || retrySaving}
                          onClick={() => { void saveRetry(row) }}
                        >
                          {retrySaving ? t('retrySaved') : t('retrySave')}
                        </button>
                        <button
                          type="button"
                          className={styles['secondaryButton']}
                          onClick={() => { setRetryOpen(undefined) }}
                        >
                          {t('close')}
                        </button>
                      </div>
                      {retryNotice === undefined ? null : <p className={styles['notice']}>{retryNotice}</p>}
                    </div>
                  )
                })()
                : null}
              {open
                ? renderProviderEditor({
                  target,
                  namespace,
                  api,
                  t,
                  readOnly: !state.writable,
                  onClose: (changed) => { closeEditor(changed, target) },
                })
                : null}
            </li>
          )
        })}
      </ul>
      <div className={styles['addBlock']}>
        {adding && addingFamily !== undefined ? (
          <div className={styles['addCard']}>
            <div className={styles['field']}>
              <span className={styles['fieldLabel']}>{t('provider')}</span>
              <select
                className={`${styles['input']} ${styles['selectInput']}`}
                value={addingFamily}
                aria-label={t('provider')}
                onChange={(event) => { setCloningFamily(event.target.value) }}
              >
                {families.map(family => (
                  <option key={family.entry.provider} value={family.entry.provider}>
                    {family.entry.displayName} · {t('instances').replace('{count}', String(instanceCount(family.entry.provider)))}
                  </option>
                ))}
              </select>
            </div>
            {/* First-time adoption: official editor, route fixed to the family id. */}
            {!cloningAsConfigured && dormant !== undefined && addNamespace !== undefined
              ? (
                <ProviderEditor
                  key={addingFamily}
                  provider={dormant.entry.provider}
                  displayName={dormant.entry.displayName}
                  hideTitle
                  namespace={addNamespace}
                  settingsPath={dormant.entry.settingsPath}
                  api={api}
                  t={t}
                  readOnly={!state.writable}
                  onClose={(changed) => {
                    setCloningFamily(undefined)
                    setAdding(false)
                    if (changed) void controller.load()
                  }}
                />
              )
              /* Same-family clone: incremental route + distinct relay endpoint. */
              : cloning !== undefined && cloningRoute !== undefined
                ? (
                  <CustomProviderCard
                    key={addingFamily}
                    taken={state.rows.map(row => row.entry.provider)}
                    protocols={protocols}
                    /* v8 ignore next -- the card only opens from a button disabled without this namespace */
                    revision={state.namespaces.get('llm-pi-ai')?.revision ?? 0}
                    api={api}
                    t={t}
                    readOnly={!state.writable}
                    initialRoute={cloningRoute}
                    familyHint={t('familyCloneHint').replace('{family}', cloning.entry.displayName)}
                    onClose={(changed) => {
                      setCloningFamily(undefined)
                      setAdding(false)
                      if (changed) void controller.load()
                    }}
                  />
                )
                : null}
          </div>
        )
          : declaring
            ? (
              <div className={styles['addCard']}>
                <CustomProviderCard
                  taken={state.rows.map(row => row.entry.provider)}
                  protocols={protocols}
                  /* v8 ignore next -- the card only opens from a button disabled without this namespace */
                  revision={state.namespaces.get('llm-pi-ai')?.revision ?? 0}
                  api={api}
                  t={t}
                  readOnly={!state.writable}
                  onClose={(changed) => {
                    setDeclaring(false)
                    if (changed) void controller.load()
                  }}
                />
              </div>
            )
            : (
              // One row for the two ways to gain a provider: reuse a known
              // family (same-family multi-gateway, selectable again once it is
              // configured) or declare a route the adapter does not ship. Side
              // by side and equal-width so they read as siblings and line up
              // with the rows above, rather than two pills of different lengths.
              <div className={styles['addActions']}>
                <button
                  type="button"
                  className={styles['addButton']}
                  disabled={families.length === 0 || !state.writable}
                  onClick={() => {
                    const first = families[0]
                    /* v8 ignore next -- the button is disabled while nothing is addable */
                    if (first === undefined) return
                    setSavedTarget(undefined)
                    setDeclaring(false)
                    setAdding(true)
                    setCloningFamily(first.entry.provider)
                  }}
                >
                  {/* Same glyph as the composer's attach button. */}
                  <IconPlusOutline16 size={14} />
                  {t('add')}
                </button>
                <button
                  type="button"
                  className={styles['addButton']}
                  disabled={protocols.length === 0 || !state.writable}
                  onClick={() => {
                    setSavedTarget(undefined)
                    setAdding(false)
                    setCloningFamily(undefined)
                    setDeclaring(true)
                  }}
                >
                  <IconPlusOutline16 size={14} />
                  {t('customAdd')}
                </button>
              </div>
            )}
      </div>
      <Modal
        open={testOpen !== undefined}
        onClose={() => { if (!testBusy) setTestOpen(undefined) }}
        title={t('testModalTitle')}
        closeLabel={t('close')}
        className={styles['testDialog'] as string}
      >
        <div className={styles['testStatusBar']}>
          <span
            className={`${styles['testPulse']}${testBusy && testOutcome === undefined ? ` ${styles['testPulseBusy']}` : ''}`}
            aria-hidden="true"
          />
          <span className={styles['testStatusName']}>{testOpen === undefined ? '' : testOpen}</span>
          <span className={styles['testStatusChip']}>{t('testLogType').replace('{type}', 'apikey')}</span>
          <span className={styles['testStatusChip']}>{t('testModalStream')}</span>
          {testLatency === undefined ? null : <span className={styles['testStatusChip']}>{testLatency}ms</span>}
        </div>
        <div className={styles['testPickRow']}>
          <span className={styles['testPickLabel']}>{t('testModelPick')}</span>
          <select
            className={`${styles['input']} ${styles['selectInput']}`}
            value={testModel}
            aria-label={t('testModelPick')}
            disabled={testBusy || testOptions.length === 0}
            onChange={(event) => { setTestModel(event.target.value) }}
          >
            {testOptions.map(id => <option key={id} value={id}>{id}</option>)}
          </select>
          <button
            type="button"
            className={styles['testStartBtn']}
            disabled={testBusy || testModel.trim().length === 0}
            onClick={() => { void runTest() }}
          >
            <span className={styles['testStartGlyph']}>▸</span>
            {testBusy ? t('testRunning') : t('testStart')}
          </button>
        </div>
        <div className={styles['testConsole']} role="log" aria-live="polite">
          {testLog.length === 0 && testReply.length === 0 && testOutcome === undefined
            ? <div className={`${styles['testLine']} ${styles['testMuted']}`}>{t('testConsoleEmpty')}</div>
            : testLog.map((line, index) => (
              <div
                key={index}
                className={`${styles['testLine']} ${
                  line.kind === 'ok' ? styles['testOk'] : line.kind === 'err' ? styles['testErr'] : styles['testInfo']
                }`}
              >
                {line.text}
              </div>
            ))}
          {testBusy && testOutcome === undefined
            ? <div className={`${styles['testLine']} ${styles['testInfo']} ${styles['testCursor']}`}>{t('testRunning')}</div>
            : null}
          {testReply.length > 0
            ? <div className={`${styles['testLine']} ${styles['testInfo']}`}>{t('testLogReply').replace('{reply}', testReply)}</div>
            : null}
          {testOutcome !== undefined
            ? (
              <div className={`${styles['testLine']} ${testOutcome.ok ? styles['testOk'] : styles['testErr']}`}>
                {testOutcome.text}
              </div>
            )
            : null}
        </div>
        <div className={styles['testActions']}>
          <button
            type="button"
            className={styles['testGhostBtn']}
            onClick={() => { setTestOpen(undefined) }}
          >
            {t('close')}
          </button>
          <button
            type="button"
            className={styles['testGhostBtn']}
            disabled={testBusy || testLog.length === 0}
            onClick={() => { void runTest() }}
          >
            {t('testRetry')}
          </button>
        </div>
      </Modal>
      <Modal
        open={deleteTarget !== undefined}
        onClose={closeDelete}
        title={deleteTarget === undefined ? '' : providerCopy(t('deleteTitle'), deleteTarget)}
        closeLabel={t('close')}
        description={deleteTarget === undefined
          ? ''
          : providerCopy(
            deleteTarget.credentialRef === undefined
              ? t('deleteDescription')
              : t('deleteDescriptionWithCredential'),
            deleteTarget,
          )}
        className={styles['deleteDialog'] as string}
        footer={(
          <>
            <Button variant="outline" autoFocus disabled={deleting} onClick={closeDelete}>
              {t('cancel')}
            </Button>
            <Button
              variant="outline"
              className={styles['deleteConfirm']}
              disabled={deleting}
              onClick={confirmDelete}
            >
              {deleteTarget === undefined
                ? ''
                : providerCopy(deleting ? t('deleting') : t('deleteConfirm'), deleteTarget)}
            </Button>
          </>
        )}
      >
        {deleteFailure === undefined ? null : <p className={styles['error']}>{deleteFailure}</p>}
      </Modal>
    </div>
  )
}

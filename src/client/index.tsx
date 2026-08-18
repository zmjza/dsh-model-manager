/**
 * dsh-model-manager browser half. Registers the「模型增强」(Models Enhanced)
 * settings section alongside the official Models page. The page reuses the
 * official Models settings join verbatim (same `llm.providers` / `settings`
 * / `credentials` wire faces and the same editor cards), so the enhanced page
 * reads and writes the SAME configuration the official page does — the two
 * stay in sync because they share one configuration source. Enhancement
 * features (same-family multi-gateway providers, per-model reasoning effort
 * configuration with auto-detection, model visibility control) layer onto the
 * editors in later milestones.
 *
 * Derived from the MIT-licensed official Models page implementation in
 * deepseek-harness (packages/client/ui-settings-models) to guarantee parity;
 * see file headers and the LICENSE for attribution.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { ConnectionHandle } from '@deepseek-ai/dsh-api-remotes/client'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-web-react'
// Type-only: pulls the shell's SlotMap merge (the 'settings.section' entry).
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the ctx.remote merge and the forwarded-event key face.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
// Type-only: pulls the modelDirectories Context merge (ctx.modelDirectories).
import type {} from '@deepseek-ai/dsh-client-ui-model-selection/client'
// Type-only: pulls the composer slot map merge (conversation.input.right).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: pulls the frame-wide shell.overlay slot (R7 restart control).
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import { ModelsSection } from './ModelsSection.tsx'
import type { ModelsSectionInjected } from './ModelsSection.tsx'
import { ModelsSettingsStore } from './store.ts'
import { en, zh, type ModelsKey } from './locales.ts'
import { EffortSlider } from './EffortSlider.tsx'
import { AutoFullHistory } from './AutoFullHistory.tsx'
import { RestartOverlay } from './RestartOverlay.tsx'
import { ToolCardDecorator } from './ToolCardDecorator.tsx'

export type { ModelsSectionInjected, ModelsSectionProps } from './ModelsSection.tsx'
export type { ModelsKey } from './locales.ts'
export type { ModelsSettingsState, ProviderRow } from './store.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The Models Enhanced page copy. */
    'model-manager': ModelsKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'model-manager'

/** The settings.nav id of this page (distinct from the official `models`). */
export const SECTION_ID = 'models-enhanced'

/**
 * Refetch the page snapshot only after its first load: an unopened page must
 * not fetch on background invalidations.
 * @param controller - the page store.
 */
export function refreshIfLoaded(controller: ModelsSettingsStore): void {
  if (controller.store.getSnapshot().status === 'idle') return
  void controller.load()
}

/**
 * Required services (cordis fiber inject). The target slot is declared by
 * ui-settings' apply, whose activation order relative to this one is NOT
 * constrained; registration depends on each slot through `slots.inject()`.
 */
export const inject = ['slots', 'locale', 'connection', 'remote', 'modelDirectories']

/**
 * Register the enhanced Models section once the `settings.section` declaration
 * is on the ledger, wire its store to the connection, and keep it fresh on
 * every pushed invalidation (settings, credentials, or provider topology).
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'model-manager: copy dictionaries')

  const connection = ctx.get('connection') as ConnectionHandle
  const controller = new ModelsSettingsStore(connection.api)
  const useSnapshot = bindSnapshotSelector(controller.store)
  // Registration-time text (the nav label thunk) and the inject faces share
  // one bound translate; copy freshness rides the locale revision.
  const t = ctx.locale.bind(NS) as ModelsSectionInjected['t']
  const injected = (): ModelsSectionInjected => ({
    controller,
    useSnapshot,
    api: connection.api,
    t,
  })

  // Pushed invalidations converge every open surface without polling: any
  // settings/credentials/topology change refetches once the page loaded.
  ctx.effect(() => {
    const refreshModels = (): void => { refreshIfLoaded(controller) }
    const disposers = [
      ctx.remote.$on('settings/document-updated', refreshModels),
      ctx.remote.$on('credentials/updated', refreshModels),
      ctx.remote.$on('llm/adapters-updated', refreshModels),
      ctx.on('connection/reset', refreshModels),
    ]
    return () => { for (const dispose of disposers) dispose() }
  }, 'model-manager: pushed invalidations')

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: SECTION_ID,
    // Beside the official Models page (order 10): models-enhanced at 11 keeps
    // the two adjacent while the official page stays untouched.
    order: 11,
    label: () => t('nav'),
    inject: injected,
  }, ModelsSection))

  // Composer thinking-level slider: a small control in the tool row, before
  // the model select. Reads/writes the shared per-session ModelDirectory, so
  // it stays in lockstep with the official effort panel.
  ctx.slots.inject('conversation.input.right', () => ctx.slots.register({
    name: 'conversation.input.right',
    id: 'model-manager-effort-slider',
    order: 10,
    inject: () => ({
      modelDirectories: ctx.modelDirectories,
      t,
    }),
  }, EffortSlider))

  // R9#1 — full history by default: an invisible sidecar in the same slot that
  // auto-clicks the conversation's "加载更早" button until the whole thread is
  // materialized, so long chats are not paged behind a manual button.
  ctx.slots.inject('conversation.input.right', () => ctx.slots.register({
    name: 'conversation.input.right',
    id: 'model-manager-auto-full-history',
    order: 100,
  }, AutoFullHistory))

  // R7 — restart-service button: a small floating control in the frame-wide
  // overlay layer (root scope, orders among other overlays). Confirming POSTs
  // the host route /api/model-manager/restart and returns to the page.
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'model-manager-restart',
    order: 1000,
  }, RestartOverlay))

  // R8 — tool-call card decorator: replace the default 'tool-call' chat-node
  // renderer with the four-colour + ±-badge card. The keyed slot elects the
  // lowest-priority live entry, so -1000 (below the shipped priority 0) wins.
  // Keyed slots identify entries by `key` (no `id`).
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register({
    name: 'conversation.chat.node',
    key: 'tool-call',
    priority: -1000,
  }, ToolCardDecorator))
}

/**
 * @module dsh-model-manager
 *
 * Host plugin body: registers the `model-manager` settings namespace that
 * persists plugin-owned model preferences (per-model visibility). Provider
 * configuration itself stays in the official `llm-pi-ai` / `llm-deepseek`
 * namespaces so the enhanced page and the official Models page share one
 * source; this namespace holds only what no official surface owns.
 */
import z from '@deepseek-ai/schemastery'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import type { SettingsSectionHooks } from '@deepseek-ai/dsh-settings'

const NS = settingsNamespace('model-manager')

/** Per-model visibility: `visibility.<provider>.<model>` → whether shown. */
const Config = z.object({
  visibility: z.dict(z.dict(z.boolean())).default({}),
})

/** No derived facts depend on the visibility source — hooks are inert. */
const hooks: SettingsSectionHooks<any> = {
  setSource() {},
  onChange() {},
}

/**
 * Install the plugin-owned settings namespace. The client half reads and
 * writes visibility through the standard settings wire, the same way the
 * official Models page does for llm-pi-ai.
 */
export function apply(ctx: Parameters<typeof installSettingsSection>[0]): void {
  installSettingsSection(ctx, NS, Config, {}, hooks)
}

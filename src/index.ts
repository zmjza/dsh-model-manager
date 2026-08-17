/**
 * @module dsh-model-manager
 *
 * Host plugin body — no host-side behavior. All configuration rides the
 * existing `llm-pi-ai` / `llm-deepseek` settings namespaces (shared with the
 * official Models page) and the credentials wire; plugin-owned preferences
 * such as model visibility live in `localStorage` (the official settings
 * proxy refuses third-party namespaces to configuration clients, and a UI
 * preference is browser-local anyway).
 */
export function apply(): void {}

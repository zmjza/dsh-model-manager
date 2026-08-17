# dsh-model-manager

English | [中文](README.zh.md)

**Model management for dsh, enhanced.** Adds a **「模型增强 (Models Enhanced)」** settings page that fully replicates the official Models page and layers on: same-family multi-gateway providers, per-model thinking-level (reasoning effort) configuration with auto-detection and name-based inference, a Claude/Codex-style thinking-level slider in the composer, and per-model visibility control.

The enhanced page **shares the same configuration source** as the official Models page — one `llm-pi-ai` / `llm-deepseek` document, one set of credentials — so the two pages always read and write the same thing and stay in sync. The enhanced page is a strict superset of the official one: anything you can do there, you can do here, plus the extras below.

## Install

Edit your web profile's `package.json` and install from this repository (like every other plugin in the family):

```json
{
  "dependencies": {
    "dsh-model-manager": "github:zmjza/dsh-model-manager"
  }
}
```

```sh
cd ~/.dsh/profiles/web
pnpm update dsh-model-manager   # pulls the latest commit and builds it
```

then restart `dsh web`. The bundle patch (`cordis.patch.yml`) mounts the plugin automatically — no profile file edits.

Or use the CLI channel once published:

```sh
dsh plugin --profile web add dsh-model-manager
```

## What you get

A new **模型增强** entry in Settings, right next to the official Models page:

```
设置 (Settings)
├── 模型            (official page — unchanged)
└── 模型增强         (this plugin — full copy + enhancements)
    ├── provider rows (list / add / edit / delete)
    ├── 添加提供方     → same-family multi-gateway
    ├── 添加自定义提供方
    └── per model: capacities + thinking levels + detect + show/hide
```

| # | Feature | Where |
|---|---|---|
| 1 | Same-family multi-gateway providers | 添加提供方 picker |
| 2 | Per-model thinking levels + default level | model row disclosure + provider editor |
| 3 | Auto-detect by `llm.models` + name-based inference | 思考程度 Detect + auto-fill |
| 4 | Composer thinking-level slider (Claude/Codex style) | tool row, beside the model select |
| 5 | Per-model show/hide | model row disclosure |

## 1. Same-family multi-gateway providers

The「添加提供方」picker no longer hides a family once it is configured. Every configurable family stays selectable; choosing one that is already configured creates a **same-family instance** under an incremental route (`openai-2`, `openai-3`, …) with its own relay endpoint, credentials, and model catalog.

- **First-time add** of a family → the official editor (route = family id, key + optional extras).
- **Re-add** of a configured family → a clone card prefilled with the next free route and a hint to enter a distinct relay endpoint.

```
添加提供方 ▾
  openai · instances: 1   ← still selectable
  anthropic · instances: 3
  deepseek · instances: 0
→ creates openai-2, openai-3, …
```

Why this matters: you can point several OpenAI/Anthropic-compatible gateways into one harness — one base URL per instance, one credential per instance, independent model catalogs.

## 2. Per-model thinking levels (思考程度)

Each model row's disclosure adds a **Thinking levels** multi-select. Selecting levels writes the model's `reasoningEfforts` (wire spelling = the level id, the OpenAI-compatible convention), and the composer's model picker then shows exactly the levels you declared.

The pi-ai provider editor adds a **Default thinking level** select writing the route-level `reasoning` default — the level a request falls back to when the UI names none.

| off | minimal | low | medium | high | xhigh | max |
|---|---|---|---|---|---|---|

- A model with no selection keeps its inherited capability (or none), preserving the official behavior exactly.
- Gateways using a different wire spelling can be edited directly in `settings.yaml`.

## 3. Auto-detect + name-based inference

Two sources fill a model's thinking levels:

1. **Detect (llm.models)** — reads the *registered route's* advertised efforts and prefills the selection. Best for official catalog models.
2. **Name-based inference (fallback)** — when the route is not registered or advertises nothing, a built-in rules table infers the family's levels from the model id/name and **auto-fills as soon as you type the id** (while nothing is selected).

| Model id / name | Inferred levels |
|---|---|
| `gpt-5.6`, `gpt-5`, `gpt-4o`, `gpt-4.1` | minimal / low / medium / high |
| `o3`, `o3-mini`, `o1`, `o4` | minimal / medium / high |
| `claude-*` (3.5+) | low / medium / high |
| `deepseek-r1`, `deepseek-v3.1`, `deepseek-v4` | high / max |
| `gemini-2.5-*` | low / medium / high |
| `grok-3` | low / medium / high |
| `qwq`, `qwen3` | low / medium / high |
| anything else | (left empty — set by hand) |

The inference table lives in [`src/client/model-efforts.ts`](src/client/model-efforts.ts) — extend it for new families.

## 4. Composer thinking-level slider

A capsule + popup **slider** in the composer tool row (Claude / Codex style): a horizontal track with one tick per available effort, a draggable handle, and a per-level glow whose intensity scales with the level position — `off` has none, `max` is fully lit.

```
  (thinking)  ●————————————————◉——————○   low  [high]  max
              trigger               popup slider
```

- Reads and writes the **same per-session ModelDirectory** as the official effort panel — the two always agree.
- Hidden entirely when the current model advertises no reasoning levels.
- Collapsible: a small badge + current-level label when closed.

## 5. Per-model visibility control

Each model row has a **Show in picker** switch. Toggling it persists to `localStorage` (`dsh.modelManager.visibility`) and new models show by default (opt-out model).

> **Why localStorage and not a settings namespace?** The official settings proxy only exposes model-provider namespaces plus a hard-coded allowlist to configuration clients; a third-party namespace is refused with `settings namespace "…" is not exposed to configuration clients`. Visibility is a UI preference, so browser-local storage is the right home — no host-side registration needed.

## Configuration source

| Data | Where |
|---|---|
| Providers (incl. multi-instance), model catalogs, `reasoningEfforts`, `reasoning` default | `llm-pi-ai` / `llm-deepseek` namespaces (official, shared with the Models page) |
| API keys | `credentials` (official, write-only) |
| Per-model visibility | `localStorage` → `dsh.modelManager.visibility` |

## Development

```sh
pnpm install
pnpm typecheck
pnpm build        # tsc types + tsdown host ESM + browser client bundle (__ModuleLoader__)
```

The client bundle is built with the official DSH client-bundle preset (`window.__ModuleLoader__.load`), so per-plugin scripts install cleanly through the module table.

## Known Limitations and Deferred Work

- **Official picker filtering.** The official composer model picker reads the host's `session.models` RPC, which has no injection point for filtering. The show/hide switch persists visibility into `localStorage` (consumable by this plugin's surfaces and later custom pickers), but the *official* picker still lists every model. Filtering the official seat means replacing that slot (a full picker rewrite) — deferred.
- **Detect needs a registered route.** Name inference works for any typed id; the `llm.models` probe only enriches routes the adapter already registers, so a not-yet-saved custom gateway relies on name inference or a hand-picked set.
- **Wire spelling.** A hand-declared pi-ai route's thinking levels use the level id as the wire value (`reasoningEfforts: { high: "high", max: "max" }`). Gateways using a different spelling should be edited in `settings.yaml`; a UI for custom wire values is planned.

## License

MIT — see [LICENSE](LICENSE).

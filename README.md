# dsh-model-manager

DSH web plugin:模型增强 — a Models settings page that fully replicates the
official「模型」page and adds same-family multi-gateway providers, per-model
thinking-level (reasoning effort) configuration with auto-detection, a
Claude/Codex-style thinking-level slider in the composer, and per-model
visibility control.

## Install

Requires the DSH web profile (`dsh web`). Install from this repository:

```bash
dsh plugin --profile web add dsh-model-manager
```

or, in your profile's `package.json`:

```json
{
  "dependencies": {
    "dsh-model-manager": "github:zmjza/dsh-model-manager"
  }
}
```

then `pnpm install` and restart `dsh web`. The bundle patch (`cordis.patch.yml`)
mounts the plugin automatically; no profile edits needed.

## What you get

A new **模型增强 (Models Enhanced)** settings page, beside the official Models
page. It shares the **same configuration source** (`llm-pi-ai` / `llm-deepseek`
namespaces + credentials), so the two pages read and write one document and
stay in sync — the enhanced page is a strict superset of the official one.

### 1. Same-family multi-gateway providers

The「添加提供方」picker no longer hides a family once it is configured.
Choosing an already-configured family creates a *same-family instance* under an
incremental route (`openai-2`, `openai-3`, …) with its own relay endpoint
(base URL), credentials, and model catalog — so you can point several
OpenAI/Anthropic-compatible gateways into one harness. First-time adoption
keeps the official editor (route = family id).

### 2. Per-model thinking levels (思考程度)

Each model row's disclosure gains a **Thinking levels** multi-select
(off / minimal / low / medium / high / xhigh / max minus off) written to the
model's `reasoningEfforts`. A **Default thinking level** select on pi-ai
provider editors writes the route-level `reasoning` default. The composer's
model picker then shows exactly the levels the model declares.

### 3. Auto-detection

A **Detect** action on each model row reads the registered route's advertised
efforts from `llm.models` and prefills the selection — so common models are
configured without manual entry. Unadvertised models keep their manual choice.

### 4. Composer thinking-level slider

A capsule + popup slider in the composer tool row (Claude / Codex style):
a horizontal track with one tick per available effort, a draggable handle, and
a per-level glow whose intensity scales with the level position. It reads and
writes the same per-session ModelDirectory as the official effort panel, so the
two always agree. Hidden entirely when the current model advertises no
reasoning levels.

### 5. Per-model visibility control

Each model row has a **Show in picker** switch persisting to the plugin-owned
`model-manager` namespace (`visibility.<provider>.<model>`, opt-out: a missing
entry means shown). New models show by default.

## Configuration source

| Data | Namespace |
|---|---|
| Providers (incl. multi-instance), model catalogs, `reasoningEfforts`, `reasoning` default | `llm-pi-ai` / `llm-deepseek` (official, shared) |
| API keys | `credentials` (official, write-only) |
| Visibility preferences | `model-manager` (plugin-owned) |

## Known limitations

- The official composer model picker reads its model catalog from the host's
  `session.models` RPC, which has no injection point for filtering. The
  **show/hide** switch therefore persists visibility into the plugin namespace
  (consumable by this plugin's own surfaces and by later custom pickers), but
  the *official* picker still lists all models. Filtering the official seat
  would require replacing that slot (a full picker rewrite), which is deferred.
- The auto-detect button reads `llm.models`, so it enriches models of
  registered routes; a not-yet-saved custom gateway has nothing to advertise
  yet and is typed by hand.
- A hand-declared pi-ai route's thinking levels use the level id as the wire
  spelling (`reasoningEfforts: { high: "high", max: "max" }`), the OpenAI
  Compatible convention; gateways using a different spelling can be edited
  directly in `settings.yaml`.

## Development

```bash
pnpm install
pnpm typecheck
pnpm build        # tsc types + tsdown host ESM + browser client bundle
```

The client bundle is built with the official DSH client-bundle preset
(`window.__ModuleLoader__.load`), so per-plugin scripts install cleanly through
the module table.

## License

MIT — see [LICENSE](LICENSE).

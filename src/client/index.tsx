/**
 * @module dsh-model-manager/client
 *
 * Models enhancement settings page (M1 skeleton): registers the
 * 「模型增强」section beside the official Models page. Full provider
 * management lands in later milestones.
 */

const NS = "model-manager";

const zh = {
  nav: "模型增强",
  title: "模型增强",
  intro: "完整复刻官方「模型」页并提供增强能力：同族多中转、思考程度（推理档位）配置与自动检测、模型显隐。",
  placeholder: "功能建设中 — 下一里程碑将提供完整提供方管理。",
  sharedHint: "本页与官方「模型」页共享同一份配置。",
};

const en = {
  nav: "Models Enhanced",
  title: "Models Enhanced",
  intro: "A full replica of the official Models page plus enhancements: same-family multi-gateway providers, per-model reasoning effort configuration with auto-detection, and model visibility control.",
  placeholder: "Under construction — full provider management arrives in the next milestone.",
  sharedHint: "This page shares the same configuration as the official Models page.",
};

export const inject = ["slots", "locale"];

/** Render the enhanced models section content column. */
function ModelsEnhancedSection(props: { t: (key: string) => string }): React.ReactElement {
  const { t } = props;
  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 720 }}>
      <h2 style={{ margin: 0, fontSize: 16, fontWeight: 500, lineHeight: "24px" }}>{t("title")}</h2>
      <p style={{ margin: 0, fontSize: 14, lineHeight: "22px", color: "var(--dsw-alias-label-tertiary)" }}>
        {t("intro")}
      </p>
      <p style={{ margin: 0, fontSize: 12, lineHeight: "18px", color: "var(--dsw-alias-state-warn-label)" }}>
        {t("sharedHint")}
      </p>
      <p style={{ margin: 0, fontSize: 14, lineHeight: "22px" }}>{t("placeholder")}</p>
    </section>
  );
}

export function apply(ctx: {
  locale: {
    register(ns: string, dicts: Record<string, unknown>): () => void;
    bind(ns: string): (key: string) => string;
  };
  slots: {
    inject(name: string, callback: () => unknown): void;
    register(options: unknown, component: unknown): unknown;
  };
  effect(fn: () => void | (() => void), label?: string): void;
}): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), "model-manager: copy dictionaries");
  const t = ctx.locale.bind(NS);
  ctx.slots.inject("settings.section", () =>
    ctx.slots.register(
      {
        name: "settings.section",
        id: "models-enhanced",
        order: 11,
        label: () => t("nav"),
      },
      (props: { close: () => void; t: (key: string) => string }) => ModelsEnhancedSection(props),
    ),
  );
}

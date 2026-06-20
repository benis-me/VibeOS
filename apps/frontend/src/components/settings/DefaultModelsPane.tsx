import type { AgentRole, Effort, ThinkingMode, RoleConfig } from "@vibeos/shared";
import { AI_PROVIDERS } from "@vibeos/shared";
import { useConnectionStore } from "@/stores/connectionStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { wsClient } from "@/lib/ws";
import { useT } from "@/lib/i18n";
import {
  Pane,
  GroupLabel,
  Group,
  Row,
  Select,
  Combobox,
  type ComboOption,
  mergeModels,
  ROLES,
  EFFORTS,
  THINKING_MODES,
} from "./primitives";

/** 默认模型 — pick provider+model per task, plus the image-generation model. */
export function DefaultModelsPane() {
  const t = useT();
  const settings = useSettingsStore((s) => s.settings)!;
  const available = useConnectionStore((s) => s.availableProviders);
  const providerModels = useConnectionStore((s) => s.providerModels);

  // A provider is shown only when actually set up — so unconfigured providers
  // don't clutter the picker: CLIs need their binary installed; API providers
  // need a key (UI or env-detected) and not be explicitly disabled.
  const isEnabled = (p: (typeof AI_PROVIDERS)[number]) => {
    if (settings.apiProviders[p.id]?.enabled === false) return false;
    if (p.kind === "cli") return available.includes(p.id);
    return available.includes(p.id) || !!settings.apiProviders[p.id]?.apiKey;
  };
  const providerLabel = (id?: string) => AI_PROVIDERS.find((p) => p.id === id)?.label ?? id ?? "";

  // Every model across all enabled providers (seed + discovered + custom),
  // grouped by provider. The option value encodes provider+model.
  const buildOptions = (imageOnly: boolean): ComboOption[] => {
    const out: ComboOption[] = [];
    for (const p of AI_PROVIDERS) {
      if (imageOnly ? !p.imageCapable : p.textCapable === false) continue;
      if (!isEnabled(p)) continue;
      const merged = mergeModels(
        p.seedModels,
        providerModels[p.id],
        settings.apiProviders[p.id]?.models,
      );
      for (const m of merged) {
        const isImg = m.capabilities?.includes("image");
        if (imageOnly ? !isImg : isImg) continue;
        out.push({ value: `${p.id}::${m.id}`, label: m.name, sub: m.id, group: p.label });
      }
    }
    return out;
  };

  // Build a picker's options, keeping the current selection visible even if its
  // provider/model isn't in the live list. `emptyLabel` names the cleared state
  // (roles: "auto"; image: "off — no image generation").
  const withCurrent = (
    opts: ComboOption[],
    provider?: string,
    model?: string,
    emptyLabel?: string,
  ) => {
    const value = provider && model ? `${provider}::${model}` : "";
    const options: ComboOption[] = [
      { value: "", label: emptyLabel ?? t("settings.model.auto") },
      ...opts,
    ];
    if (value && !opts.some((o) => o.value === value)) {
      options.push({ value, label: model!, sub: model, group: providerLabel(provider) });
    }
    return { value, options };
  };

  const parse = (v: string): { provider?: string; model?: string } => {
    if (!v) return { provider: undefined, model: undefined };
    const i = v.indexOf("::");
    return { provider: v.slice(0, i), model: v.slice(i + 2) };
  };

  const patchRole = (role: AgentRole, cfg: Partial<RoleConfig>) =>
    wsClient.send("c2s.settings.update", { partial: { modelOverrides: { [role]: cfg } } });

  const textOptions = buildOptions(false);
  const imageOptions = buildOptions(true);
  const img = settings.prefs.imageModel ?? {};
  const setImage = (partial: { provider?: string; model?: string }) =>
    wsClient.send("c2s.settings.update", {
      partial: { prefs: { imageModel: { ...img, ...partial } } },
    });
  const imgPick = withCurrent(imageOptions, img.provider, img.model, t("settings.models.imageOff"));

  return (
    <Pane title={t("settings.cat.models")}>
      {ROLES.map((role) => {
        const cfg: RoleConfig = settings.modelOverrides[role] ?? {};
        const pick = withCurrent(textOptions, cfg.provider, cfg.model);
        return (
          <Group key={role} className="mb-2.5">
            <div className="px-3.5 py-2.5">
              <div className="text-[13px] font-medium">{t(`settings.role.${role}.label`)}</div>
            </div>
            <Row label={t("settings.role.model")}>
              <Combobox
                value={pick.value}
                options={pick.options}
                onChange={(v) => patchRole(role, parse(v))}
                searchPlaceholder={t("settings.model.search")}
                emptyLabel={t("settings.model.none")}
              />
            </Row>
            <Row label={t("settings.role.effort")}>
              <Select
                value={cfg.effort ?? ""}
                onChange={(v) =>
                  patchRole(role, { effort: (v || undefined) as Effort | undefined })
                }
              >
                <option value="">{t("settings.effort.default")}</option>
                {EFFORTS.map((ef) => (
                  <option key={ef} value={ef}>
                    {ef}
                  </option>
                ))}
              </Select>
            </Row>
            <Row label={t("settings.role.thinking")}>
              <Select
                value={cfg.thinking ?? ""}
                onChange={(v) =>
                  patchRole(role, { thinking: (v || undefined) as ThinkingMode | undefined })
                }
              >
                <option value="">{t("settings.thinking.default")}</option>
                {THINKING_MODES.map((tm) => (
                  <option key={tm} value={tm}>
                    {t(`settings.thinking.${tm}`)}
                  </option>
                ))}
              </Select>
            </Row>
          </Group>
        );
      })}

      <GroupLabel>{t("settings.models.image")}</GroupLabel>
      <Group>
        <div className="px-3.5 pt-2.5 text-[11px] leading-relaxed text-muted-foreground">
          {t("settings.models.imageHint")}
        </div>
        <Row label={t("settings.role.model")}>
          {imageOptions.length === 0 ? (
            <span className="text-[12px] text-muted-foreground">
              {t("settings.models.noImageProvider")}
            </span>
          ) : (
            <Combobox
              value={imgPick.value}
              options={imgPick.options}
              onChange={(v) => setImage(parse(v))}
              searchPlaceholder={t("settings.model.search")}
              emptyLabel={t("settings.model.none")}
            />
          )}
        </Row>
      </Group>
    </Pane>
  );
}

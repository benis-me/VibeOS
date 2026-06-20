import { useConnectionStore } from "@/stores/connectionStore";
import { useT } from "@/lib/i18n";
import { Pane, Group, Row } from "./primitives";

export function AboutPane() {
  const t = useT();
  const bootCount = useConnectionStore((s) => s.bootCount);
  const version = useConnectionStore((s) => s.version);

  return (
    <Pane title={t("settings.cat.about")}>
      <Group>
        <Row label={t("settings.about.system")}>
          <span className="text-[13px] font-medium">
            {version ? `VibeOS ${version}` : "VibeOS"}
          </span>
        </Row>
        <Row label={t("settings.about.boots")}>
          <span className="text-[13px] font-medium">{bootCount}</span>
        </Row>
      </Group>
    </Pane>
  );
}

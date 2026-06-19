import { useEffect, useState } from "react";
import { useLocale } from "@/lib/i18n";

export function Clock() {
  const [now, setNow] = useState(() => new Date());
  const locale = useLocale();
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000 * 20);
    return () => clearInterval(t);
  }, []);
  const bcp = locale === "en" ? "en-US" : "zh-CN";
  const time = now.toLocaleTimeString(bcp, { hour: "2-digit", minute: "2-digit" });
  const date = now.toLocaleDateString(bcp, { month: "short", day: "numeric" });
  return (
    <div className="vibe-clock flex flex-col items-end px-3 text-right leading-tight">
      <span className="text-xs font-medium">{time}</span>
      <span className="text-[10px] text-muted-foreground">{date}</span>
    </div>
  );
}

import Link from "next/link";
import clsx from "clsx";
import { FARM_LABELS, FARM_ORDER } from "@/lib/constants";
import RememberFarm from "./RememberFarm";

/**
 * Переключатель компании в шапке страниц «Зарплаты»: Rose Farm / Есентай Агро Хим, без «обе» (владелец, 28.10.2026:
 * зарплата по компаниям раздельно). Ссылки — страница открывается заново на той же вкладке и месяце (`href`).
 */
export default function FarmSwitch({ farm, href }: { farm: string; href: (farm: string) => string }) {
  return (
    <div className="flex rounded-lg border border-line-hairline overflow-hidden text-sm">
      <RememberFarm farm={farm} />
      {FARM_ORDER.map((f) => (
        <Link key={f} href={href(f)} className={clsx("px-3 py-1.5 whitespace-nowrap", f === farm ? "bg-ink-primary text-white" : "hover:bg-surface-sunk")}>
          {FARM_LABELS[f] ?? f}
        </Link>
      ))}
    </div>
  );
}

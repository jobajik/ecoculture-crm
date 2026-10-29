import Link from "next/link";
import clsx from "clsx";
import { FARM_LABELS, FARM_ORDER } from "@/lib/constants";
import RememberGhFarm from "./RememberGhFarm";

/**
 * Компания в шапке «Теплицы». У агронома и зав. складом производство закреплено — вместо переключателя подпись.
 * Без "use client": ссылки, страница открывается заново.
 */
export default function GhFarmSwitch({ farm, href, locked }: { farm: string; href: (farm: string) => string; locked: boolean }) {
  if (locked) return <span className="text-sm text-ink-secondary">{FARM_LABELS[farm] ?? farm}</span>;
  return (
    <div className="flex rounded-lg border border-line-hairline overflow-hidden text-sm">
      <RememberGhFarm farm={farm} />
      {FARM_ORDER.map((f) => (
        <Link key={f} href={href(f)} className={clsx("px-3 py-1.5 whitespace-nowrap", f === farm ? "bg-ink-primary text-white" : "hover:bg-surface-sunk")}>
          {FARM_LABELS[f] ?? f}
        </Link>
      ))}
    </div>
  );
}

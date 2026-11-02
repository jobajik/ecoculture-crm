import { DEFAULT_VARIETIES, isMiniMixVariety } from "../constants";
import { GH_VARIETIES } from "./production";
import { INTAKE_FLOWERS, type IntakeFlower, type IntakeRow } from "./intake";

/**
 * Сорта для приёмки: роза и эустома — из справочника склада (вкладка Varieties, без «Мини-микс …»: на приёмке мини-микс —
 * это длина, а не сорт), хризантема — из книги агронома; плюс всё, что уже принимали. Одинаковые без учёта регистра —
 * одной строкой.
 */
export function intakeVarietyList(rows: IntakeRow[], byType: Record<string, string[]>): { byFlower: Record<IntakeFlower, string[]>; all: string[] } {
  const byFlower = {} as Record<IntakeFlower, string[]>;
  for (const f of INTAKE_FLOWERS) {
    const base = f === "chrysanthemum" ? GH_VARIETIES : byType[f]?.length ? byType[f] : DEFAULT_VARIETIES[f] ?? [];
    const seen = new Map<string, string>();
    for (const v of [...base, ...rows.filter((r) => r.flower === f).map((r) => r.variety)]) {
      const name = String(v ?? "").trim();
      if (!name || isMiniMixVariety(name) || name.toLowerCase() === "mix") continue;
      const k = name.toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ");
      if (!seen.has(k)) seen.set(k, name);
    }
    byFlower[f] = Array.from(seen.values()).sort((a, b) => a.localeCompare(b, "ru"));
  }
  return { byFlower, all: Array.from(new Set(INTAKE_FLOWERS.flatMap((f) => byFlower[f]))) };
}

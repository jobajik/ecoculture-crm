import { greenhouseSession } from "./session";
import { loadGreenhouse, type GhData } from "../repo/greenhouse";
import { summarizeCycles, type CycleRow } from "./production";
import { cycleCard, type CycleCard } from "./views";
import { localDayKey } from "../timezone";
import type { GreenhouseScope } from "./access";

/** Общее начало страниц «Теплицы»: кто открыл, компания, все журналы одним пакетным чтением и сводки по циклам. */
export interface GreenhousePage {
  scope: GreenhouseScope | null;
  email: string;
  farm: string;
  today: string;
  data: GhData;
  rows: CycleRow[];
  cycles: CycleCard[];
}

export async function loadGreenhousePage(searchParams?: { farm?: string }): Promise<GreenhousePage> {
  const { scope, email, farm } = await greenhouseSession(searchParams);
  const today = localDayKey();
  const empty: GhData = { cycles: [], harvest: [], cuttings: [], waste: [] };
  if (!scope) return { scope, email, farm, today, data: empty, rows: [], cycles: [] };
  const data = await loadGreenhouse(farm);
  const rows = summarizeCycles(data, today);
  return { scope, email, farm, today, data, rows, cycles: rows.map((r) => cycleCard(r, today)) };
}

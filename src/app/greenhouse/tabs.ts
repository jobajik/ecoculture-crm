import type { GreenhouseScope } from "@/lib/greenhouse/access";

/**
 * Вкладки «Теплицы» (29.10.2026, владелец: «не нравятся эти вкладки — переделать и визуально, и по логике ведения»).
 * Было шесть пунктов — по пункту на журнал (срезка, черенкование, брак, выработка), и каждый вносился отдельно. Стало
 * четыре, по тому, ЧТО человек делает:
 *   Обзор — что сейчас в теплице и как идёт цикл (сюда же карточки блоков);
 *   Внести день — всё за день одной записью (только тем, кто ведёт записи);
 *   Записи — всё внесённое: найти, проверить, поправить, загрузить книгу;
 *   Аналитика — блоки, сорта, циклы, срезка, люди и оплата труда.
 * Компания едет параметром; `match` — без него.
 */
export function greenhouseTabsFor(scope: GreenhouseScope | null, farm = ""): { href: string; label: string; match?: string[] }[] {
  if (!scope) return [];
  const q = farm ? `?farm=${farm}` : "";
  const tabs: { href: string; label: string; match?: string[] }[] = [{ href: `/greenhouse${q}`, label: "Обзор", match: ["/greenhouse"] }];
  if (scope.editsLogs || (scope.payroll && scope.editsWork)) tabs.push({ href: `/greenhouse/day${q}`, label: "Внести день", match: ["/greenhouse/day"] });
  tabs.push({ href: `/greenhouse/records${q}`, label: "Записи", match: ["/greenhouse/records"] });
  tabs.push({ href: `/greenhouse/analytics${q}`, label: "Аналитика", match: ["/greenhouse/analytics"] });
  return tabs;
}

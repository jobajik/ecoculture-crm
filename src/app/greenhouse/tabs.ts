import { FARMS } from "@/lib/constants";
import type { GreenhouseScope } from "@/lib/greenhouse/access";
import { tabOfViews, type SectionTab } from "@/lib/sectionViews";

/**
 * Вкладки «Теплицы» (29.10.2026, владелец: «не нравятся эти вкладки — переделать и визуально, и по логике ведения»).
 * Было шесть пунктов — по пункту на журнал (срезка, черенкование, брак, выработка), и каждый вносился отдельно. Стало
 * четыре, по тому, ЧТО человек делает:
 *   Обзор — что сейчас в теплице и как идёт цикл (сюда же карточки блоков);
 *   Внести день — всё за день одной записью (только тем, кто ведёт записи);
 *   Записи — всё внесённое: найти, проверить, поправить, загрузить книгу;
 *   Аналитика — блоки, сорта, циклы, срезка, план, потери, люди и оплата труда;
 *   Отчёты — сводка за день, неделю, месяц, квартал, год или свой период; Excel и печать в PDF.
 * Компания едет параметром; `match` — без него.
 */
export function greenhouseTabsFor(scope: GreenhouseScope | null, farm = ""): SectionTab[] {
  if (!scope) return [];
  const q = farm ? `?farm=${farm}` : "";
  // Rose Farm (02.11.2026): приёмка цветка по характеристикам — те же адреса, другое содержимое (`_intake/`).
  if (farm === FARMS.ROSE_FARM) {
    const rose: { href: string; label: string; match?: string[] }[] = [{ href: `/greenhouse${q}`, label: "Обзор", match: ["/greenhouse"] }];
    if (scope.editsLogs) rose.push({ href: `/greenhouse/day${q}`, label: "Приёмка", match: ["/greenhouse/day"] });
    rose.push({ href: `/greenhouse/records${q}`, label: "Записи", match: ["/greenhouse/records"] });
    rose.push({ href: `/greenhouse/analytics${q}`, label: "Аналитика", match: ["/greenhouse/analytics", "/greenhouse/report"] });
    return rose;
  }
  const tabs: SectionTab[] = [{ href: `/greenhouse${q}`, label: "Обзор", match: ["/greenhouse"] }];
  if (scope.editsLogs || (scope.payroll && scope.editsWork)) tabs.push({ href: `/greenhouse/day${q}`, label: "Внести день", match: ["/greenhouse/day"] });
  tabs.push({ href: `/greenhouse/records${q}`, label: "Записи", match: ["/greenhouse/records"] });
  // Аналитика и отчёты (30.10.2026, ТЗ: «ежедневный, недельный, месячный отчёт… экспорт в Excel и PDF») — два вида одной
  // вкладки (12.11.2026): оба отвечают на «как идёт срезка», один — картинкой, другой — документом.
  tabs.push(
    ...tabOfViews("Аналитика", [
      { href: `/greenhouse/analytics${q}`, label: "Аналитика", match: ["/greenhouse/analytics"] },
      { href: `/greenhouse/report${q}`, label: "Отчёты", match: ["/greenhouse/report"] },
    ])
  );
  return tabs;
}

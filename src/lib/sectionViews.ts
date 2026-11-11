// ---------------------------------------------------------------------------
// «Виды» внутри вкладки раздела (12.11.2026, владелец: «CRM перегружена данными — переосмысли и уменьши шум… за всё
// берись»). В меню у владельца было 65 ссылок: «Клиенты» — 11 вкладок, «Склад» — 11, «Деньги» — 10, и половина из них —
// разные взгляды на одно и то же («Оплаты» и «Статус оплат», «Долги» и «Напоминания», четыре вкладки про лидов).
// Теперь такая пара — ОДНА вкладка меню, а взгляды — переключатель вверху страницы (`SectionViews`). Страницы, адреса
// и права прежние: вид — это ссылка на ту же страницу, что раньше открывала отдельная вкладка.
// Чистый модуль без «use client» (грабли 1.8): его читают и меню, и страницы, и проверки.
// ---------------------------------------------------------------------------

export interface SectionView {
  href: string;
  label: string;
  /** Адреса, на которых вид выбран (без него — его `href`). */
  match?: string[];
}

export interface SectionTab {
  href: string;
  label: string;
  /** Адреса, на которых вкладка горит. У вкладки с видами — адреса всех её видов. */
  match?: string[];
  /** Взгляды внутри вкладки — переключатель вверху страницы. Один вид — переключателя нет. */
  views?: SectionView[];
}

const pathOf = (href: string) => href.split("?")[0];

/**
 * Собирает вкладку из видов: без видов вкладки нет; один вид — обычная вкладка с его адресом и названием (у роли, которой
 * остальные виды закрыты, не должно быть переключателя из одной кнопки); несколько — вкладка с переключателем, которая
 * ведёт на первый вид и горит на любом из них.
 */
export function tabOfViews(label: string, views: (SectionView | null | false | undefined)[]): SectionTab[] {
  const list = views.filter((v): v is SectionView => !!v);
  if (!list.length) return [];
  if (list.length === 1) return [{ href: list[0].href, label: list[0].label, match: list[0].match ?? [pathOf(list[0].href)] }];
  return [{ href: list[0].href, label, match: list.flatMap((v) => v.match ?? [pathOf(v.href)]), views: list }];
}

/** Выбран ли вид на этом адресе. */
export function isViewActive(view: SectionView, pathname: string): boolean {
  return view.match ? view.match.includes(pathname) : pathOf(view.href) === pathname;
}

/** Виды вкладки, открытой на этом адресе: только если адрес — ровно один из видов (на карточке лида переключатель не нужен). */
export function viewsFor(tabs: SectionTab[] | undefined, pathname: string): SectionView[] {
  for (const t of tabs ?? []) {
    if (t.views && t.views.length > 1 && t.views.some((v) => isViewActive(v, pathname))) return t.views;
  }
  return [];
}

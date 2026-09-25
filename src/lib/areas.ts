// ---------------------------------------------------------------------------
// Разделы сайта и их цвет — одна таблица на шапки страниц (`PageHeader`),
// активный пункт меню и вкладки (`SectionTabs`).
//
// Владелец, посмотрев новые заявку и оплату: «очень крутой стиль — примени на
// весь сайт». Смысл цвета тот же, что у разделов карточки (`Section`): человек
// с первого взгляда понимает, ГДЕ он — в деньгах, на складе или в клиентах.
// Цвета приглушённые и далёкие от статусных зелёного/жёлтого/красного: те
// по-прежнему означают только «хорошо / ждём / плохо».
//
// Классы Tailwind записаны целиком, а не собираются из кусков: иначе сборка их
// не увидит и не включит в стили. Без "use client" — модуль общий.
// ---------------------------------------------------------------------------
import type { IconName } from "@/components/Icon";

export type AreaKey =
  | "home"
  | "orders"
  | "clients"
  | "leads"
  | "retail"
  | "stock"
  | "sales"
  | "money"
  | "plans"
  | "forecast"
  | "analytics"
  | "admin";

export interface Area {
  key: AreaKey;
  label: string;
  icon: IconName;
  /** Цвет текста и значков. */
  text: string;
  /** Сплошная заливка (полоска, подчёркивание). */
  solid: string;
  /** Мягкая подложка (значок, активный пункт меню). */
  soft: string;
  /** Рамка шапки страницы. */
  border: string;
  /** Градиент шапки страницы. */
  gradient: string;
  /** Подчёркивание активной вкладки. */
  tabBorder: string;
}

export const AREAS: Record<AreaKey, Area> = {
  home: {
    key: "home",
    label: "Главная",
    icon: "home",
    text: "text-accent",
    solid: "bg-accent",
    soft: "bg-accent-soft",
    border: "border-accent/15",
    gradient: "from-accent-soft",
    tabBorder: "border-accent",
  },
  orders: {
    key: "orders",
    label: "Заявки",
    icon: "order",
    text: "text-accent",
    solid: "bg-accent",
    soft: "bg-accent-soft",
    border: "border-accent/15",
    gradient: "from-accent-soft",
    tabBorder: "border-accent",
  },
  clients: {
    key: "clients",
    label: "Клиенты",
    icon: "client",
    text: "text-section-client",
    solid: "bg-section-client",
    soft: "bg-section-client-soft",
    border: "border-section-client/15",
    gradient: "from-section-client-soft",
    tabBorder: "border-section-client",
  },
  leads: {
    key: "leads",
    label: "Лиды",
    icon: "phone",
    text: "text-section-leads",
    solid: "bg-section-leads",
    soft: "bg-section-leads-soft",
    border: "border-section-leads/15",
    gradient: "from-section-leads-soft",
    tabBorder: "border-section-leads",
  },
  retail: {
    key: "retail",
    label: "Розница",
    icon: "route",
    text: "text-section-retail",
    solid: "bg-section-retail",
    soft: "bg-section-retail-soft",
    border: "border-section-retail/15",
    gradient: "from-section-retail-soft",
    tabBorder: "border-section-retail",
  },
  stock: {
    key: "stock",
    label: "Склад",
    icon: "box",
    text: "text-section-stock",
    solid: "bg-section-stock",
    soft: "bg-section-stock-soft",
    border: "border-section-stock/15",
    gradient: "from-section-stock-soft",
    tabBorder: "border-section-stock",
  },
  sales: {
    key: "sales",
    label: "Продажи",
    icon: "chart",
    text: "text-section-sales",
    solid: "bg-section-sales",
    soft: "bg-section-sales-soft",
    border: "border-section-sales/15",
    gradient: "from-section-sales-soft",
    tabBorder: "border-section-sales",
  },
  money: {
    key: "money",
    label: "Оплаты",
    icon: "wallet",
    text: "text-section-money",
    solid: "bg-section-money",
    soft: "bg-section-money-soft",
    border: "border-section-money/15",
    gradient: "from-section-money-soft",
    tabBorder: "border-section-money",
  },
  plans: {
    key: "plans",
    label: "Планы",
    icon: "calendar",
    text: "text-section-plans",
    solid: "bg-section-plans",
    soft: "bg-section-plans-soft",
    border: "border-section-plans/15",
    gradient: "from-section-plans-soft",
    tabBorder: "border-section-plans",
  },
  forecast: {
    key: "forecast",
    label: "Прогноз срезки",
    icon: "clock",
    text: "text-section-forecast",
    solid: "bg-section-forecast",
    soft: "bg-section-forecast-soft",
    border: "border-section-forecast/15",
    gradient: "from-section-forecast-soft",
    tabBorder: "border-section-forecast",
  },
  analytics: {
    key: "analytics",
    label: "Аналитика",
    icon: "chart",
    text: "text-section-analytics",
    solid: "bg-section-analytics",
    soft: "bg-section-analytics-soft",
    border: "border-section-analytics/15",
    gradient: "from-section-analytics-soft",
    tabBorder: "border-section-analytics",
  },
  admin: {
    key: "admin",
    label: "Настройки",
    icon: "note",
    text: "text-section-admin",
    solid: "bg-section-admin",
    soft: "bg-section-admin-soft",
    border: "border-section-admin/15",
    gradient: "from-section-admin-soft",
    tabBorder: "border-section-admin",
  },
};

/** Раздел по адресу страницы — для меню и вкладок. Лиды живут внутри клиентов. */
export function areaForPath(pathname: string): Area {
  const p = pathname || "/";
  if (p === "/") return AREAS.home;
  if (p.startsWith("/clients/leads")) return AREAS.leads;
  if (p.startsWith("/orders")) return AREAS.orders;
  if (p.startsWith("/clients")) return AREAS.clients;
  if (p.startsWith("/retail")) return AREAS.retail;
  if (p.startsWith("/warehouse")) return AREAS.stock;
  if (p.startsWith("/sales")) return AREAS.sales;
  if (p.startsWith("/finance")) return AREAS.money;
  if (p.startsWith("/plans") || p.startsWith("/prices")) return AREAS.plans;
  if (p.startsWith("/forecast")) return AREAS.forecast;
  if (p.startsWith("/analytics")) return AREAS.analytics;
  if (p.startsWith("/admin")) return AREAS.admin;
  return AREAS.home;
}

import { clientsTabsFor } from "@/app/clients/tabs";
import { financeTabsFor } from "@/app/finance/tabs";
import { WAREHOUSE_TABS } from "@/app/warehouse/tabs";
import { plansTabsFor } from "@/app/plans/tabs";
import { salesTabsFor } from "@/app/sales/tabs";
import { officeTabsFor } from "@/app/office/tabs";
import { retailTabsFor } from "@/app/retail/tabs";
import { analyticsTabsFor } from "@/app/analytics/tabs";
import { payrollTabsFor } from "@/app/payroll/tabs";
import { payrollScope } from "@/lib/payroll/access";
import { greenhouseTabsFor } from "@/app/greenhouse/tabs";
import { greenhouseScope } from "@/lib/greenhouse/access";

/**
 * Разделы бокового меню — ПЯТЬ-ШЕСТЬ на роль, под активным разделом его вкладки.
 *
 * 19.10.2026, владелец принял макет: «у каждой роли свой экран „Мой день“, разделов пять, всё остальное — вкладки
 * внутри». До этого в меню было до одиннадцати пунктов (Клиенты, Лиды, Переписки, Рассылки — четыре входа в одно и то
 * же; Склад и Офис — два входа в «где лежит цветок»), а вкладки раздела показывала сама страница. Теперь раздел знает
 * свои вкладки заранее (`subs`): меню показывает их под активным пунктом, не дожидаясь страницы, и на любой странице
 * раздела (карточка клиента, страница заявки) видно, где ты и куда ещё можно.
 *
 * Списки вкладок по-прежнему живут рядом со страницами (`tabs.ts` разделов) — здесь они только собираются по ролям,
 * второй копии правил нет. Файл без «use client»: его читают оба меню (грабли 1.8).
 */
export interface NavSub {
  href: string;
  label: string;
  /** Адреса, на которых вкладка горит (без него — её `href` и всё, что начинается с него). */
  match?: string[];
}

export interface NavLink {
  href: string;
  label: string;
  /** Короткая подпись для узких мест. */
  short?: string;
  /**
   * Начала адресов, на которых раздел считается активным. Нужны, потому что в один раздел теперь входят страницы с
   * разными адресами: «Планы и цифры» — это /plans, /prices, /sales, /forecast и /analytics.
   */
  match: string[];
  subs: NavSub[];
  /** Пункт из группы «Прочее» (Настройки). */
  other?: boolean;
}

const path = (href: string) => href.split("?")[0];

/** Раздел из вкладок: активен на адресах всех своих вкладок (и на всём, что начинается с них). */
function section(href: string, label: string, subs: NavSub[], extraMatch: string[] = [], other = false): NavLink {
  const match = Array.from(new Set([path(href), ...subs.map((s) => path(s.href)), ...extraMatch]));
  return { href, label, match, subs: subs.length > 1 ? subs : [], other };
}

const DAY: NavLink = { href: "/", label: "Мой день", match: ["/"], subs: [] };
const ORDERS: NavLink = { href: "/orders", label: "Заявки", match: ["/orders"], subs: [] };
const ANALYTICS = (role: string): NavSub[] => {
  const tabs = analyticsTabsFor(role);
  return tabs.length > 0 ? tabs : [{ href: "/analytics", label: "Аналитика хозяйства" }];
};

/**
 * Раздел «Зарплата» — у администратора и у всех, кому дана роль в модуле (PayrollRole в Users). Роль CRM `payroll`
 * («только зарплата») видит один этот раздел: главной у неё нет, та и уводит в табель.
 */
function payrollSection(role: string, payrollRole: string | undefined, departments: string[] | undefined, crowded: boolean): NavLink | null {
  const scope = payrollScope({ role, payrollRole: payrollRole ?? "", payrollDepartments: departments ?? [] });
  if (!scope) return null;
  // У владельца и РОПа рабочих разделов и так шесть-семь («разделов пять, остальное — вкладки»), поэтому у них
  // «Зарплата» живёт в группе «Прочее» рядом с «Настройками»; у остальных — обычный рабочий раздел.
  return section("/payroll", "Зарплата", payrollTabsFor(scope), ["/payroll"], crowded);
}

/**
 * Раздел «Теплица» (29.10.2026, владелец: «выдели это в отдельную вкладку»): циклы и блоки, журналы срезки,
 * черенкования и брака, аналитика и выработка цветоводов. Это рабочий раздел у всех, кому он открыт, — у владельца тоже.
 */
function greenhouseSection(role: string, farm: string | undefined, payrollRole: string | undefined, departments: string[] | undefined): NavLink | null {
  const scope = greenhouseScope({ role, farm, payrollRole: payrollRole ?? "", payrollDepartments: departments ?? [] });
  if (!scope) return null;
  return section("/greenhouse", "Теплица", greenhouseTabsFor(scope), ["/greenhouse"]);
}

/** Разделы роли — в порядке, в котором их открывают каждый день. */
export function navLinksFor(role: string, payrollRole?: string, payrollDepartments?: string[], farm?: string): NavLink[] {
  const links = baseLinksFor(role);
  const work = links.filter((l) => !l.other);
  const other = links.filter((l) => l.other);
  const greenhouse = greenhouseSection(role, farm, payrollRole, payrollDepartments);
  if (greenhouse) work.push(greenhouse);
  const payroll = payrollSection(role, payrollRole, payrollDepartments, work.length >= 7);
  if (!payroll) return [...work, ...other];
  return payroll.other ? [...work, ...other, payroll] : [...work, payroll, ...other];
}

function baseLinksFor(role: string): NavLink[] {
  switch (role) {
    case "manager":
      return [
        DAY,
        ORDERS,
        section("/clients", "Клиенты", clientsTabsFor(undefined, role)),
        section("/sales", "Продажи", [...salesTabsFor(role), ...ANALYTICS(role)], ["/analytics", "/prices"]),
      ];
    case "accountant":
      return [
        DAY,
        section("/finance", "Оплаты", financeTabsFor(role)),
        ORDERS,
        section("/clients", "Клиенты", clientsTabsFor(undefined, role)),
        section("/analytics", "Аналитика", ANALYTICS(role), ["/sales"]),
      ];
    case "warehouse":
      return [
        DAY,
        section("/warehouse", "Склад", WAREHOUSE_TABS),
        ORDERS,
        // Зав. складом производства в «Рознице» ведёт только регионы — пункт ведёт сразу туда.
        section("/retail/regions", "Розница", retailTabsFor(role), ["/retail"]),
        section("/analytics", "Аналитика", ANALYTICS(role)),
      ];
    case "office":
      return [DAY, section("/office/ship", "Офис", officeTabsFor(role), ["/office", "/warehouse/ship"])];
    case "office_retail":
      return [
        DAY,
        section("/office/ship", "Офис", officeTabsFor(role), ["/office", "/warehouse/ship"]),
        section("/retail", "Розница", retailTabsFor(role)),
        ORDERS,
      ];
    case "retail_almaty":
    case "retail_regions":
      return [DAY, section("/retail", "Розница", retailTabsFor(role)), ORDERS];
    case "sales_head":
      return [
        DAY,
        ORDERS,
        section("/clients", "Клиенты", [...clientsTabsFor(undefined, role), { href: "/retail", label: "Наши магазины" }], ["/retail"]),
        section("/office", "Склад", officeTabsFor(role), ["/warehouse"]),
        section("/finance", "Деньги", financeTabsFor(role)),
        section(
          "/plans",
          "Планы и цифры",
          [...plansTabsFor(role), ...salesTabsFor(role), ...ANALYTICS(role)],
          ["/sales", "/prices", "/analytics", "/forecast"]
        ),
      ];
    case "agronomist":
      return [DAY, section("/forecast", "Прогноз срезки", [], ["/forecast"])];
    case "leadgen":
      // Земфира: её работа целиком в лидах, главной у неё нет — та и уводит в лиды.
      return [section("/clients/leads", "Лиды", clientsTabsFor(undefined, role), ["/clients"])];
    case "payroll":
      // Только зарплата: сам раздел добавит `navLinksFor` по роли модуля; без неё — пусто, и главная это объяснит.
      return [];
    case "admin":
      return [
        DAY,
        ORDERS,
        section("/clients", "Клиенты", [...clientsTabsFor(undefined, role), { href: "/retail", label: "Наши магазины" }], ["/retail"]),
        section("/warehouse", "Склад", [...WAREHOUSE_TABS, { href: "/office", label: "Офис" }], ["/office"]),
        section("/finance", "Деньги", financeTabsFor(role)),
        section(
          "/plans",
          "Планы и цифры",
          [...plansTabsFor(role), ...salesTabsFor(role), ...ANALYTICS(role)],
          ["/sales", "/prices", "/analytics", "/forecast"]
        ),
        { href: "/admin", label: "Настройки", match: ["/admin"], subs: [], other: true },
      ];
    default:
      return [DAY, ORDERS];
  }
}

/**
 * Активен ли раздел на этом адресе. Одна функция на оба меню (компьютер и телефон): разъедься она по двум
 * компонентам — подсветка начнёт вести себя по-разному. Побеждает раздел с САМЫМ ДЛИННЫМ подходящим началом адреса:
 * у РОПа «/clients/leads» входит и в «Клиенты», и — у Земфиры — в «Лиды», а «/warehouse/ship» у склада офиса —
 * в «Офис», а не в «Склад».
 */
export function isActive(link: NavLink, pathname: string, all?: NavLink[]): boolean {
  const score = (l: NavLink) =>
    l.match.reduce((best, m) => {
      const hit = m === "/" ? pathname === "/" : pathname === m || pathname.startsWith(m + "/") || pathname.startsWith(m + "?");
      return hit && m.length > best ? m.length : best;
    }, 0);
  const mine = score(link);
  if (mine === 0) return false;
  if (!all) return true;
  return all.every((l) => l === link || score(l) <= mine);
}

/** Какая вкладка раздела открыта: точное совпадение из `match`, иначе самое длинное подходящее начало адреса. */
export function activeSub(subs: NavSub[], pathname: string): NavSub | undefined {
  const exact = subs.find((s) => (s.match ? s.match.includes(pathname) : path(s.href) === pathname));
  if (exact) return exact;
  let best: NavSub | undefined;
  let bestLen = 0;
  for (const s of subs) {
    const p = path(s.href);
    if ((pathname.startsWith(p + "/") || pathname === p) && p.length > bestLen) {
      best = s;
      bestLen = p.length;
    }
  }
  return best;
}

import { ROLES } from "@/lib/constants";
import { canSeeRegions, territoriesFor } from "@/lib/retail";

/**
 * Вкладки раздела «Розница».
 *
 * Порядок — как идёт день менеджера розницы: сначала собрать заявку на день по
 * своим магазинам (это его основная работа), потом справочник точек, «Регионы»
 * и только по поводу — сводка за период.
 *
 * Набор зависит от роли, и это не украшательство: зав. складом производства
 * заполняет ТОЛЬКО регионы, и три чужие вкладки рядом означали бы для неё три
 * шанса открыть не то. У кого остаётся одна вкладка, ряд не показывается вовсе
 * (`SectionTabs` прячет его при одной).
 */
export function retailTabsFor(role: string | null | undefined) {
  const tabs: { href: string; label: string }[] = [];
  // Алматинская розница — только тем, у кого это направление есть.
  if (territoriesFor(role).length > 0) {
    tabs.push({ href: "/retail", label: "Заявка на день" });
    tabs.push({ href: "/retail/shops", label: "Магазины" });
  }
  if (canSeeRegions(role)) tabs.push({ href: "/retail/regions", label: "Регионы" });
  // Сводка — цифры по всей рознице, зав. складом производства они ни к чему.
  if (territoriesFor(role).length > 0 || role === ROLES.ADMIN) {
    tabs.push({ href: "/retail/summary", label: "Сводка" });
  }
  return tabs;
}

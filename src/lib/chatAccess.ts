import { ROLES } from "./constants";
import { canManageLeads } from "./leads";
import { listWaLines } from "./repo/waLines";
import { isManagerLine, type WaLine } from "./waLines";

/**
 * Кто какие номера видит в «Переписках» (16.10.2026): владелец и РОП — все (основной, Земфиру,
 * менеджеров), менеджер — свой номер, Земфира — свой. Проверяют страница и действия.
 */
export async function visibleLines(role: string | null | undefined, email: string): Promise<{ code: string; label: string; line?: WaLine }[]> {
  const lines = await listWaLines();
  const me = email.toLowerCase();
  if (canManageLeads(role)) {
    return [
      ...lines.map((l) => ({ code: l.code, label: l.label, line: l })),
      { code: "leads", label: "Земфира (реклама)" },
      { code: "", label: "Основной номер (бот)" },
    ];
  }
  if (role === ROLES.LEADGEN) return [{ code: "leads", label: "Мой номер" }];
  return lines.filter((l) => l.managerEmail === me).map((l) => ({ code: l.code, label: "Мой номер", line: l }));
}

export async function canSeeLine(role: string | null | undefined, email: string, line: string): Promise<boolean> {
  if (canManageLeads(role)) return true;
  if (line === "leads") return role === ROLES.LEADGEN;
  if (!isManagerLine(line)) return false;
  return (await listWaLines()).some((l) => l.code === line && l.managerEmail === email.toLowerCase());
}

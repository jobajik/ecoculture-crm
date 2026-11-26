import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();
/**
 * Общий пул «Базы» (26.11.2026, решения владельца): нетронутых людей из базы обзвона снять с менеджеров — им пишет
 * автопилот «Знакомство», ответивший уходит менеджеру; сотрудника, который с клиентами не работает, отметить —
 * его люди попадут в «Раздать».
 *   npx tsx scripts/base-pool.ts <файл.json> [--yes]
 *   файл: { "idle": ["Нина"], "undo": "C:\\…\\_private\\base-pool-undo.json" }
 * Без --yes только показывает. С --yes: копия таблицы, файл отката (номер лида → прежний менеджер), запись.
 */
import { readFileSync, writeFileSync } from "fs";
import { createBackup } from "../src/lib/backup";
import { saveSettings } from "../src/lib/repo/settings";
import { setOwners } from "../src/lib/repo/baseOwners";
import { BASE_IDLE_SETTING, loadBase, parseList } from "../src/lib/baseRunner";
import { BASE_CLASS_LABELS, type BaseEntry } from "../src/lib/baseClass";

const count = <T,>(list: T[], key: (x: T) => string) => {
  const m = new Map<string, number>();
  for (const x of list) m.set(key(x), (m.get(key(x)) ?? 0) + 1);
  return Array.from(m.entries()).sort((a, b) => b[1] - a[1]);
};

async function main() {
  const file = process.argv[2];
  const yes = process.argv.includes("--yes");
  if (!file) throw new Error("Укажите файл с настройками");
  const input = JSON.parse(readFileSync(file, "utf-8").replace(/^\uFEFF/, "")) as { idle?: string[]; undo?: string };
  const base = await loadBase({ fresh: true });

  // Кто не работает с клиентами: по имени, как оно записано в «Сотрудниках».
  const idleEmails: string[] = [];
  for (const name of input.idle ?? []) {
    const found = base.users.filter((u) => (u.name || "").trim().split(/\s+/)[0].toLowerCase() === name.trim().toLowerCase());
    if (found.length !== 1) throw new Error(`Сотрудник «${name}»: найдено ${found.length} — нужен ровно один`);
    idleEmails.push(found[0].email.trim().toLowerCase());
  }
  const idle = new Set([...parseList(base.map[BASE_IDLE_SETTING]).map((x) => x.toLowerCase()), ...idleEmails]);

  // В пул: лид без карточки, с которым никто не работал, записанный за менеджером, — из базы обзвона или у неработающего.
  const toPool = base.entries.filter((e: BaseEntry) => e.kind === "lead" && e.cls === "untouched" && e.ownerFrom === "lead" && (e.callBase || idle.has(e.owner)));
  console.log(`Людей в базе: ${base.entries.length}. Уже в общем пуле: ${base.entries.filter((e) => e.pool).length}`);
  console.log(`В общий пул уйдёт: ${toPool.length} — ${count(toPool, (e) => base.nameOf(e.owner)).map(([k, c]) => `${k} ${c}`).join(", ")}`);
  for (const email of idleEmails) {
    const rest = base.entries.filter((e) => e.owner === email && !toPool.includes(e));
    console.log(`${base.nameOf(email)} — не работает с клиентами. Кроме пула за ней останется ${rest.length}: ${count(rest, (e) => BASE_CLASS_LABELS[e.cls]).map(([k, c]) => `${k} ${c}`).join(", ")} — они появятся в «Раздать».`);
  }
  if (!yes) {
    console.log("\nЭто показ. Чтобы записать — добавьте --yes.");
    return;
  }
  const backup = await createBackup(new Date(), () => undefined);
  console.log(`\nКопия таблицы: ${backup.url ?? backup.spreadsheetId ?? "сделана"}`);
  const leads = toPool.flatMap((e) => e.leadIds.map((leadId) => ({ leadId, managerEmail: "", was: e.owner })));
  if (input.undo) {
    writeFileSync(input.undo, JSON.stringify({ at: new Date().toISOString(), leads: leads.map((l) => ({ leadId: l.leadId, managerEmail: l.was })) }), "utf-8");
    console.log(`Файл отката записан: лидов ${leads.length}`);
  }
  if (idleEmails.length) await saveSettings({ [BASE_IDLE_SETTING]: JSON.stringify(Array.from(idle)) });
  const res = await setOwners({ clients: [], leads });
  console.log(`Снято с менеджеров лидов: ${res.leads}`);

  const after = await loadBase({ fresh: true });
  console.log(`\nПосле: в общем пуле ${after.entries.filter((e) => e.pool).length}`);
  console.log(`За кем сколько людей: ${count(after.entries.filter((e) => !e.pool), (e) => (e.ownerState === "none" ? "ничьи" : `${after.nameOf(e.owner)}${e.ownerState === "gone" ? " (не работает)" : ""}`)).map(([k, c]) => `${k} ${c}`).join(", ")}`);
  console.log(`Переносов на подтверждение: ${after.entries.filter((e) => e.moveTo).length}`);
  console.log(`«Раздать» (живые люди без работающего хозяина): ${after.entries.filter((e) => e.ownerState !== "ok" && !e.pool && !e.moveTo && ["active", "cooling", "sleeping", "talking", "warm"].includes(e.cls) && (e.clientIds.length || e.leadIds.length)).length}`);
}

main().catch((e) => {
  console.error("ОШИБКА:", e instanceof Error ? e.message : e);
  process.exit(1);
});

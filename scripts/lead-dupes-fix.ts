import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

/**
 * Убрать авто-лиды-двойники: на один телефон несколько лидов, лишние заведены АВТОМАТИЧЕСКИ и без единого касания.
 * Остаётся самый ранний; если у него имя-заглушка («Клиент WhatsApp 0574») или короче, чем у двойника, — берёт имя
 * подробнее («Маргарита» → «Маргарита Пожарка»). Лиды с касаниями, с карточкой клиента и заведённые человеком не
 * трогаются — их печатает, решает человек. Без --yes — показ; с --yes — копия таблицы, потом удаление.
 *
 *   npx tsx scripts/lead-dupes-fix.ts [--yes]
 *
 * 21.10.2026: Google не ответил на чтение, и вебхук завёл лид заново (у Маргариты на номере Эмиля — три лида).
 */
import { listLeadsStrict, listLeadTouches, updateLead } from "../src/lib/repo/leads";
import { phoneKey } from "../src/lib/leads";
import { createBackup } from "../src/lib/backup";
import { deleteWhere, SHEET_TABS } from "../src/lib/sheets";

const isAuto = (note: string) => /Заведён автоматически/.test(note || "");
const isPlaceholder = (name: string) => /^Клиент WhatsApp/i.test(name.trim());

async function main() {
  const apply = process.argv.includes("--yes");
  const [leads, touches] = await Promise.all([listLeadsStrict(), listLeadTouches({ fresh: true })]);
  const touched = new Set(touches.map((t) => t.leadId));
  const groups = new Map<string, typeof leads>();
  for (const l of leads) {
    const k = phoneKey(l.phone);
    if (k) groups.set(k, [...(groups.get(k) ?? []), l]);
  }
  const drop: string[] = [];
  const rename: { leadId: string; name: string }[] = [];
  for (const g of Array.from(groups.values()).filter((x) => x.length > 1)) {
    const sorted = [...g].sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.leadId < b.leadId ? -1 : 1));
    const keeper = sorted[0];
    const extra = sorted.slice(1);
    const safe = extra.filter((l) => isAuto(l.note) && !touched.has(l.leadId) && !l.clientId);
    const left = extra.filter((l) => !safe.includes(l));
    console.log(`\n${keeper.phone}: остаётся ${keeper.leadId} «${keeper.name}»`);
    for (const l of safe) console.log(`  удалить ${l.leadId} «${l.name}» (${l.createdAt.slice(0, 16)}, авто, без касаний)`);
    for (const l of left) console.log(`  НЕ трогаю ${l.leadId} «${l.name}» — есть касания, карточка или завёл человек`);
    const names = [keeper.name, ...safe.map((l) => l.name)].filter((n) => !isPlaceholder(n));
    const best = names.sort((a, b) => b.length - a.length)[0];
    if (best && best !== keeper.name && (isPlaceholder(keeper.name) || best.toLowerCase().startsWith(keeper.name.toLowerCase()))) {
      console.log(`  имя: «${keeper.name}» → «${best}»`);
      rename.push({ leadId: keeper.leadId, name: best });
    }
    drop.push(...safe.map((l) => l.leadId));
  }
  console.log(`\nУдалить: ${drop.length}, переименовать: ${rename.length}.`);
  if (!apply || (!drop.length && !rename.length)) return console.log(apply ? "Нечего делать." : "Только показ. Выполнить: --yes");
  const backup = await createBackup(new Date(), (m) => console.log(`  копия: ${m}`));
  console.log(`Копия таблицы: ${backup.url}`);
  for (const r of rename) await updateLead(r.leadId, { Name: r.name });
  const ids = new Set(drop);
  const n = await deleteWhere(SHEET_TABS.LEADS, (r) => ids.has(r.LeadID));
  console.log(`Удалено строк: ${n}. Готово.`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});

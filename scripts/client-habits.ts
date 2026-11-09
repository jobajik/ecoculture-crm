import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

/**
 * Постоянники менеджеров (09.11.2026, владелец: «определить привычку и периодичность клиентов по Ильясу (Эмилю), чтобы
 * каждую неделю делать рассылку ботом по его постоянникам от имени Ильяса»). Печатает привычки (как часто, в какой день,
 * что берёт) и кому пора писать сегодня, пишет вкладку ClientHabits. С --send — заводит сегодняшние рассылки с номеров
 * менеджеров (то же делает утренняя сводка в 9:00). С --excel <файл> — таблица привычек в Excel.
 *
 *   npx tsx scripts/client-habits.ts [почта менеджера | имя] [--send] [--excel <файл>] [--date ГГГГ-ММ-ДД]
 */
import ExcelJS from "exceljs";
import { runClientHabits } from "../src/lib/clientHabitsRunner";
import { WEEKDAYS, usualLabel } from "../src/lib/clientHabits";
import { listUsers } from "../src/lib/repo/users";
import { localDayKey } from "../src/lib/timezone";

const money = (n: number) => `${Math.round(n).toLocaleString("ru-RU")} ₸`;

async function main() {
  const args = process.argv.slice(2);
  const send = args.includes("--send");
  const excel = args.includes("--excel") ? args[args.indexOf("--excel") + 1] : "";
  const date = args.includes("--date") ? args[args.indexOf("--date") + 1] : localDayKey();
  const who = args.find((a) => !a.startsWith("--") && a !== excel && a !== date);
  const users = await listUsers();
  const nameOf = new Map(users.map((u) => [u.email, u.name || u.email]));
  const { habits, results } = await runClientHabits({ send, today: date, byEmail: "y.sadakbayev@gmail.com" });
  const pick = (email: string) => !who || email === who || (nameOf.get(email) || "").toLowerCase().startsWith(who.toLowerCase());
  const mine = habits.filter((h) => pick(h.managerEmail));
  const regular = mine.filter((h) => h.regular);
  console.log(`На ${date}: клиентов с заявками за 90 дней ${mine.length}, постоянников ${regular.length}`);
  const byM = new Map<string, typeof regular>();
  for (const h of regular) byM.set(h.managerEmail, [...(byM.get(h.managerEmail) ?? []), h]);
  for (const [email, list] of byM) {
    console.log(`\n=== ${nameOf.get(email) || email}: постоянников ${list.length} ===`);
    for (const h of list) {
      const items = h.usual.map((u) => `${usualLabel(u)} ×${u.qty}`).join("; ");
      console.log(`  ${h.name.padEnd(28)} …${h.phone.slice(-4)} · заявок ${h.orders} · раз в ${h.medianGapDays} дн. · ${WEEKDAYS[h.weekday]} (${Math.round(h.weekdayShare * 100)} %) · ср. ${money(h.avgAmount)} · посл. ${h.lastAt} · ждём ${h.nextExpectedAt}${h.lastSentAt ? ` · писали ${h.lastSentAt.slice(0, 10)}` : ""}${h.active ? "" : " · ВЫКЛ"}`);
      console.log(`      обычно: ${items}`);
    }
  }
  console.log(`\n=== Сегодня (${date}, ${WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()]}) ===`);
  for (const r of results) {
    if (who && !pick(users.find((u) => u.name === r.manager || u.name?.startsWith(r.manager))?.email || "")) continue;
    console.log(`${r.manager} (${r.line || "основной номер"}): пора ${r.sent.length}, пропущено ${r.skipped.length}${r.broadcastId ? ` → рассылка ${r.broadcastId}` : send ? "" : " (показ)"}`);
    for (const s of r.sent) console.log(`  → ${s.name} …${s.phone.slice(-4)}\n     ${s.text.replace(/\n/g, "\n     ")}`);
    const why = new Map<string, number>();
    for (const s of r.skipped) why.set(s.why, (why.get(s.why) ?? 0) + 1);
    if (why.size) console.log("  не сегодня: " + Array.from(why).map(([w, n]) => `${w} ${n}`).join(" · "));
  }
  if (excel) {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Постоянники");
    ws.columns = [
      { header: "Менеджер", key: "m", width: 14 }, { header: "Клиент", key: "n", width: 28 }, { header: "Телефон", key: "p", width: 16 },
      { header: "Заявок за 90 дн.", key: "o", width: 10 }, { header: "Раз в N дней", key: "g", width: 10 }, { header: "День недели", key: "w", width: 10 },
      { header: "Доля дня", key: "ws", width: 9 }, { header: "Обычно берёт", key: "u", width: 60 }, { header: "Средний чек", key: "a", width: 12 },
      { header: "Последняя заявка", key: "l", width: 14 }, { header: "Ждём", key: "e", width: 12 }, { header: "Писали", key: "s", width: 12 }, { header: "Постоянник", key: "r", width: 10 },
    ];
    ws.getRow(1).font = { bold: true };
    for (const h of mine) ws.addRow({ m: nameOf.get(h.managerEmail) || h.managerEmail, n: h.name, p: h.phone, o: h.orders, g: h.medianGapDays, w: WEEKDAYS[h.weekday], ws: Math.round(h.weekdayShare * 100) / 100, u: h.usual.map((u) => `${usualLabel(u)} ×${u.qty}`).join("; "), a: h.avgAmount, l: h.lastAt, e: h.nextExpectedAt, s: h.lastSentAt.slice(0, 10), r: h.regular ? "да" : "" });
    ws.getColumn("ws").numFmt = "0%";
    ws.autoFilter = "A1:M1";
    await wb.xlsx.writeFile(excel);
    console.log(`\nExcel: ${excel}`);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});

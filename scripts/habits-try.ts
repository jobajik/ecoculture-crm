import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

/**
 * Что написал бы бот постоянникам менеджера — словами менеджера, без отправки (09.11.2026). Режимы: weekly — его
 * день, overdue — молчит дольше обычного (берутся те, кто правда молчит), command — по просьбе менеджера (с --focus).
 *
 *   npx tsx scripts/habits-try.ts <имя, почта или код линии менеджера> [--mode weekly|overdue|command] [--focus "хризантема 3 кат"] [--n 5]
 * Из .bat русские буквы в аргументах портятся кодировкой консоли — там указывать код линии (m-…) или почту.
 */
import { loadHabitContext, habitRecipientsFor, overdueVerdict, type HabitMode } from "../src/lib/clientHabitsRunner";
import { listUsers } from "../src/lib/repo/users";

async function main() {
  const args = process.argv.slice(2);
  const opt = (k: string) => (args.includes(k) ? args[args.indexOf(k) + 1] : "");
  const mode = (opt("--mode") || "weekly") as HabitMode;
  const focus = opt("--focus");
  const n = Number(opt("--n")) || 5;
  const who = args.find((a, i) => !a.startsWith("--") && (i === 0 || !args[i - 1].startsWith("--")));
  if (!who) throw new Error("Укажите менеджера");
  const users = await listUsers();
  const ctx = await loadHabitContext();
  const byLine = ctx.lines.find((l) => l.code === who)?.managerEmail;
  const user = users.find((u) => u.email === who || u.email === byLine || (u.name || "").toLowerCase().startsWith(who.toLowerCase()));
  if (!user) throw new Error(`Менеджер «${who}» не найден`);
  let list = ctx.habits.filter((h) => h.regular && h.active && h.managerEmail === user.email);
  if (mode === "overdue") list = list.filter((h) => !overdueVerdict(h, ctx));
  list = list.sort((a, b) => b.avgAmount / Math.max(1, b.medianGapDays) - a.avgAmount / Math.max(1, a.medianGapDays)).slice(0, n);
  const style = ctx.styles.get(ctx.lines.find((l) => l.managerEmail === user.email)?.code || "");
  console.log(`${user.name}: режим ${mode}, постоянников взято ${list.length}; профиль почерка: ${style ? `${style.messages} сообщений, обновлён ${style.updatedAt.slice(0, 10)}` : "НЕТ (пойдёт шаблон)"}`);
  const { recipients, skipped, line } = await habitRecipientsFor(ctx, user.email, list, mode, { focus: focus || undefined, budgetMs: 120000 });
  console.log(`номер: ${line || "основной"}; пропущено: ${skipped.map((s) => `${s.name} — ${s.why}`).join("; ") || "никого"}\n`);
  for (const r of recipients) {
    const h = r.habit;
    console.log(`— ${h.name} …${r.phone.slice(-4)} · раз в ${h.medianGapDays} дн. · ждём ${h.nextExpectedAt} · ${r.source === "style" ? "словами менеджера" : "ШАБЛОН"}`);
    console.log(r.text.split("\n").map((l) => `    ${l}`).join("\n"));
    console.log("");
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});

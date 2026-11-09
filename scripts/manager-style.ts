import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

/**
 * Почерк менеджеров (09.11.2026, `managerStyle.ts`): пересчитать профили по переписке с их номеров и показать, что
 * получилось. Профиль живёт неделю; --force — пересчитать сейчас; --show — только показать сохранённое.
 *
 *   npx tsx scripts/manager-style.ts [--force] [--show]
 */
import { refreshManagerStyles, stylesFrom } from "../src/lib/managerStyleRunner";
import { stylePromptBlock, styleUsable } from "../src/lib/managerStyle";
import { settingsMap } from "../src/lib/repo/broadcasts";
import { listWaLines } from "../src/lib/repo/waLines";
import { listUsers } from "../src/lib/repo/users";

async function main() {
  const force = process.argv.includes("--force");
  const show = process.argv.includes("--show");
  if (!show) {
    const res = await refreshManagerStyles({ force });
    for (const r of res) console.log(`${r.code}: ${r.refreshed ? "пересчитан" : "свежий, оставлен"} · своих сообщений ${r.messages}`);
  }
  const [map, lines, users] = await Promise.all([settingsMap(true), listWaLines(), listUsers()]);
  const styles = stylesFrom(map);
  for (const l of lines.filter((x) => x.active && x.managerEmail)) {
    const p = styles.get(l.code);
    const name = (users.find((u) => u.email === l.managerEmail)?.name || l.managerEmail).split(/\s+/)[0];
    console.log(`\n=== ${name} (${l.code}) ===`);
    if (!p) {
      console.log("  профиля нет");
      continue;
    }
    console.log(`  обновлён ${p.updatedAt.slice(0, 16)} · сообщений ${p.messages} · ${styleUsable(p) ? "надёжный" : "мало сообщений — общий стиль"}`);
    for (const line of stylePromptBlock(p, name).slice(0, 5)) console.log(`  ${line}`);
    console.log(`  примеров: ${p.samples.length}; первые: ${p.samples.slice(0, 5).map((s) => `«${s.replace(/\n/g, " / ")}»`).join(", ")}`);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});

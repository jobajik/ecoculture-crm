import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();
/**
 * Что копирайтер рассылок написал бы сегодня — без отправки и без записи. Собирает план автопилота на названные дни
 * (ничего не создавая), берёт по нескольку получателей каждого правила и печатает черновик программы и текст ИИ:
 * кто написал, с какой попытки, что было не так. Соседние получатели идут подряд — видно, повторяется ли он.
 *   npx tsx scripts/broadcast-copy-try.ts [сколько на правило=2] [день ГГГГ-ММ-ДД …]
 * Без дней — сегодня; «2026-12-09» и «2026-12-13» покажут сценарии к 16 декабря, понедельник — «свежий срез».
 */
import { buildAutoPlan } from "../src/lib/autoBroadcastRunner";
import { AUTO_RULE_LABELS } from "../src/lib/autoBroadcast";
import { OPT_OUT_LINE } from "../src/lib/broadcast";
import { copyGist, parseCopySpec } from "../src/lib/broadcastCopy";
import { writeCopy } from "../src/lib/broadcastCopyRunner";

const indent = (s: string) => s.split("\n").map((l) => `    ${l}`).join("\n");

async function main() {
  const args = process.argv.slice(2);
  const per = Number(args.find((a) => /^\d{1,2}$/.test(a))) || 2;
  const days = args.filter((a) => /^\d{4}-\d{2}-\d{2}$/.test(a));
  const moments = days.length ? days.map((d) => new Date(`${d}T10:30:00+05:00`)) : [new Date()];
  let ai = 0;
  let program = 0;
  for (const now of moments) {
    const built = await buildAutoPlan(now);
    console.log(`\n================ План на ${now.toISOString().slice(0, 10)} · рассылок ${built.specs.length} · ждут живого ответа ${built.waiting} ================`);
    for (const [rule, why] of Object.entries(built.skipped)) {
      const top = Object.entries(why ?? {}).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([w, n]) => `${w} — ${n}`).join("; ");
      if (top) console.log(`не берём (${AUTO_RULE_LABELS[rule as keyof typeof AUTO_RULE_LABELS] ?? rule}): ${top}`);
    }
    for (const s of built.specs) {
      console.log(`\n--- ${AUTO_RULE_LABELS[s.rule]} · ${s.line ? s.lineLabel : "рабочий номер"} · получателей ${s.recipients.length}${s.fileId ? " · с фото" : ""}`);
      const avoid: string[] = [];
      for (const r of s.recipients.slice(0, per)) {
        const spec = parseCopySpec(r.copy);
        console.log(`\n  ${r.name || "(без имени)"} …${r.phone.slice(-4)} · ${r.copy || "без копирайтера"}`);
        console.log("  ЧЕРНОВИК ПРОГРАММЫ:");
        console.log(indent(r.text.replace(`\n\n${OPT_OUT_LINE}`, "")));
        if (!spec) continue;
        const t0 = Date.now();
        const out = await writeCopy({ spec, name: r.name, template: r.text, avoid, now });
        if (out.by === "ai") ai += 1;
        else program += 1;
        console.log(`  ${out.by === "ai" ? "ТЕКСТ ИИ" : "УШЁЛ БЫ ЧЕРНОВИК"} (${out.model || "без модели"}, попыток ${out.attempts}, ${((Date.now() - t0) / 1000).toFixed(1)} с, ${out.text.length} зн.)${out.problems.length ? ` — ${out.problems.join("; ")}` : ""}:`);
        console.log(indent(out.text));
        avoid.push(copyGist(out.text, OPT_OUT_LINE));
      }
    }
  }
  console.log(`\nИтого: текст ИИ — ${ai}, черновик программы — ${program}`);
}

main().catch((e) => {
  console.error("ОШИБКА:", e instanceof Error ? e.message : e);
  process.exit(1);
});

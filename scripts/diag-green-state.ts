import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

/**
 * Отвечает ли Green API на проверку номера (`getStateInstance`) — несколько раз подряд,
 * с кодом ответа и временем. Ничего не меняет. 12.10.2026: на странице «Рассылки» висело
 * «Green API не ответил», хотя рассылка в это время отправлялась.
 *
 *   npx tsx scripts/diag-green-state.ts [раз] [пауза, с]
 */
import { getInstanceState, greenConfig, GreenError } from "../src/lib/greenApi";

async function main() {
  const cfg = greenConfig();
  if (!cfg) throw new Error("Нет ключей Green API");
  const times = Number(process.argv[2]) || 6;
  const gap = Number(process.argv[3]) || 3;
  for (let i = 1; i <= times; i++) {
    const t0 = Date.now();
    try {
      const state = await getInstanceState(cfg);
      console.log(`${i}: ${state} · ${Date.now() - t0} мс`);
    } catch (e) {
      const code = e instanceof GreenError ? e.status : "?";
      const body = e instanceof GreenError ? e.body.slice(0, 120) : "";
      console.log(`${i}: ОТКАЗ ${code} · ${Date.now() - t0} мс · ${e instanceof Error ? e.message.slice(0, 160) : e} ${body}`);
    }
    if (i < times) await new Promise((r) => setTimeout(r, gap * 1000));
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});

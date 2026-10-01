/**
 * Только чтение: как выглядит блок {цены …} по живому прайсу и скольким клиентам
 * уйдёт рассылка «брали хризантему». Запуск: npx tsx scripts/diag-broadcast-prices.ts [chrysanthemum]
 */
import "../src/lib/timezone";
import { getCurrentPrices } from "../src/lib/repo/prices";
import { priceMapForClient } from "../src/lib/priceList";
import { priceBlock } from "../src/lib/broadcastPrices";
import { loadAudience } from "../src/lib/broadcastAudience";
import { localDayKey } from "../src/lib/timezone";

const flower = process.argv[2] || "chrysanthemum";

async function main() {
  const prices = priceMapForClient(await getCurrentPrices(localDayKey()));
  for (const f of ["chrysanthemum", "rose", "eustoma"]) {
    console.log(`--- {цены ${f}}`);
    console.log(priceBlock(f, prices) || "(в прайсе нет цен)");
  }
  const audience = await loadAudience({ withOrders: true });
  const clients = audience.filter((a) => a.kind === "client");
  const bought = clients.filter((a) => a.flowers.includes(flower));
  console.log(`\nКлиентов в базе: ${clients.length}; брали ${flower}: ${bought.length}; из них можно написать: ${bought.filter((a) => !a.excluded).length}`);
  const why = new Map<string, number>();
  for (const a of bought) if (a.excluded) why.set(a.excluded, (why.get(a.excluded) ?? 0) + 1);
  for (const [k, v] of why) console.log(`  не уйдёт — ${k}: ${v}`);
}

main().catch((err) => {
  console.error("ОШИБКА:", err instanceof Error ? err.message : err);
  process.exit(1);
});

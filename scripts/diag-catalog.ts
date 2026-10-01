import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

/**
 * Каталог JPEG по живым данным — без отправки. Рисует страницы здесь же и (с
 * `--live`) скачивает их с сайта: так видно, что боевая ссылка работает.
 * Файлы — в папку `../_private/catalog/` (вне репозитория).
 *
 *   npx tsx scripts/diag-catalog.ts [--live]
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { prefetchTables, SHEET_TABS } from "../src/lib/sheets";
import { getCurrentPrices } from "../src/lib/repo/prices";
import { listBatches } from "../src/lib/repo/batches";
import { getSettings } from "../src/lib/repo/settings";
import { listBotPhotos } from "../src/lib/repo/botPhotos";
import { stockMap } from "../src/lib/botKnowledge";
import { catalogFlowers, catalogPage } from "../src/lib/catalog";
import { loadCatalogFonts, renderCatalogJpeg } from "../src/lib/catalogImage";
import { catalogFileName, siteUrl } from "../src/lib/catalogFiles";
import { publicCatalogUrl } from "../src/lib/waFileSign";
import { localDayKey } from "../src/lib/timezone";

async function main() {
  const out = path.join(process.cwd(), "..", "_private", "catalog");
  await mkdir(out, { recursive: true });
  await prefetchTables([
    SHEET_TABS.PRICE_HISTORY,
    SHEET_TABS.BATCHES,
    SHEET_TABS.SETTINGS,
    SHEET_TABS.BOT_PHOTOS,
  ]);
  const now = new Date();
  const [prices, batches, settings, photos] = await Promise.all([
    getCurrentPrices(localDayKey(now)),
    listBatches(),
    getSettings(),
    listBotPhotos(),
  ]);
  const stock = Array.from(stockMap(batches, settings, now).values());
  console.log(`Фото в ротации: ${photos.filter((p) => p.active).length}`);
  const fonts =
    process.platform === "win32"
      ? []
      : await loadCatalogFonts((p) => readFile(p));
  const logo = `data:image/png;base64,${(await readFile("public/logo.png")).toString("base64")}`;
  for (const f of catalogFlowers(prices)) {
    const page = catalogPage({ flowerType: f, prices, stock })!;
    console.log(`\n${page.title}: карточек ${page.groups.length}`);
    for (const g of page.groups)
      console.log(
        `   ${g.inStock ? "есть" : "    "}  ${g.varieties.join(", ")} — ${g.prices.map((p) => `${p.label} ${p.price}`).join(" · ")}`,
      );
    const day = localDayKey(now);
    // next/og на Windows не рисует (не находит свой шрифт по пути) — здесь только живая ссылка с сайта.
    if (process.platform !== "win32") {
      const jpg = await renderCatalogJpeg({
        page,
        dateText: `на ${day.slice(8, 10)}.${day.slice(5, 7)}.${day.slice(0, 4)}`,
        logo,
        hero: null,
        gallery: [],
        fonts,
      });
      await writeFile(path.join(out, `local-${catalogFileName(f)}`), jpg);
      console.log(`   нарисовано здесь: ${Math.round(jpg.length / 1024)} КБ`);
    }
    if (process.argv.includes("--live")) {
      const url = publicCatalogUrl(siteUrl(), f, now);
      const t = Date.now();
      const res = await fetch(url, { signal: AbortSignal.timeout(60000) });
      const body = Buffer.from(await res.arrayBuffer());
      console.log(
        `   с сайта: ${res.status} ${res.headers.get("content-type")} ${Math.round(body.length / 1024)} КБ за ${Date.now() - t} мс`,
      );
      if (res.ok)
        await writeFile(path.join(out, `live-${catalogFileName(f)}`), body);
      else console.log(`   ответ: ${body.toString("utf8").slice(0, 300)}`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

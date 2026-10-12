import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

/**
 * Какие фото есть у бота: цветок, сорт, категория, вид (живое / инфографика), сколько раз ушло,
 * начало подписи. Ничего не меняет.
 *
 *   npx tsx scripts/diag-bot-photos.ts
 */
import { listBotPhotos } from "../src/lib/repo/botPhotos";
import { photoLabel } from "../src/lib/botPhotos";

async function main() {
  const photos = await listBotPhotos(true);
  console.log(`фото: ${photos.length}, включено: ${photos.filter((p) => p.active).length}`);
  for (const p of photos) {
    const kind = (p as { kind?: string }).kind || "живое";
    console.log(
      `${p.photoId} · ${p.active ? "вкл" : "выкл"} · ${kind} · ${photoLabel(p)} · ушло ${p.sentCount} (посл. ${p.lastSentAt.slice(0, 16) || "—"}) · ${p.fileName} · «${p.caption.slice(0, 70)}»`
    );
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});

import { prefetchTables, SHEET_TABS, type WriteOp } from "./sheets";
import { listBotPhotos, botPhotoSentWrite } from "./repo/botPhotos";
import { getCurrentPrices } from "./repo/prices";
import { listBatches } from "./repo/batches";
import { getSettings } from "./repo/settings";
import { stockMap } from "./botKnowledge";
import { priceFor, type PriceRow } from "./priceList";
import { compareGrades, isLiquidGrade } from "./constants";
import { localDayKey } from "./timezone";
import { photoLabel, photoMessage, pickRotationPhoto, type BotPhoto } from "./botPhotos";
import { photoFileUrl } from "./catalogFiles";

// ---------------------------------------------------------------------------
// Отправка фото из ротации (`botPhotos.ts`): что приложить и какие цены
// дописать к подписи. Цены — из действующего прайса и склада в момент отправки.
// ---------------------------------------------------------------------------

type Photo = BotPhoto & { rowNumber: number };

export interface PhotoContext {
  photos: Photo[];
  prices: Map<string, PriceRow>;
  stock: { flower: string; variety: string; grade: string; qty: number }[];
}

export async function loadPhotoContext(): Promise<PhotoContext> {
  await prefetchTables([SHEET_TABS.BOT_PHOTOS, SHEET_TABS.PRICE_HISTORY, SHEET_TABS.BATCHES, SHEET_TABS.SETTINGS]);
  const now = new Date();
  const [photos, prices, batches, settings] = await Promise.all([listBotPhotos(true), getCurrentPrices(localDayKey(now)), listBatches(), getSettings()]);
  return { photos, prices, stock: Array.from(stockMap(batches, settings, now).values()) };
}

/**
 * Цены под фото: сорт и категория указаны — одна строка; только сорт — его
 * категории, что есть на складе (до трёх); только цветок — две ходовые позиции
 * с самым большим остатком. Без цены — строки нет.
 */
export function photoPrices(photo: Pick<BotPhoto, "flowerType" | "variety" | "grade">, ctx: Pick<PhotoContext, "prices" | "stock">): { label: string; price: number }[] {
  const f = photo.flowerType;
  if (photo.variety && photo.grade) {
    const price = priceFor(ctx.prices, f, photo.variety, photo.grade);
    return price > 0 ? [{ label: photoLabel(photo), price }] : [];
  }
  const rows = ctx.stock
    .filter((s) => s.flower === f && s.qty >= 50 && (!photo.variety || s.variety === photo.variety) && (photo.variety || isLiquidGrade(f, s.grade)))
    .map((s) => ({ ...s, price: priceFor(ctx.prices, f, s.variety, s.grade) }))
    .filter((s) => s.price > 0);
  if (photo.variety) {
    return rows
      .sort((a, b) => compareGrades(f, a.grade, b.grade))
      .slice(0, 3)
      .map((s) => ({ label: photoLabel({ flowerType: f, variety: s.variety, grade: s.grade }), price: s.price }));
  }
  const out: { label: string; price: number }[] = [];
  for (const s of rows.sort((a, b) => b.qty - a.qty)) {
    if (out.length >= 2) break;
    if (out.some((o) => o.label.startsWith(photoLabel({ flowerType: f, variety: s.variety, grade: "" })))) continue;
    out.push({ label: photoLabel({ flowerType: f, variety: s.variety, grade: s.grade }), price: s.price });
  }
  return out;
}

/**
 * Фото из ротации для одного человека: ссылка, подпись (продающий текст + цены
 * + вопрос) и запись «отправлено» для ротации. Нет фото — null.
 */
export function rotationPhoto(ctx: PhotoContext, opts: { flowers?: string[]; question: string; caption?: string }): { url: string; name: string; caption: string; after: WriteOp; photo: Photo } | null {
  const photo = pickRotationPhoto(ctx.photos, { flowers: opts.flowers }) as Photo | null;
  if (!photo) return null;
  const caption = opts.caption ?? photoMessage({ caption: photo.caption, prices: photoPrices(photo, ctx), question: opts.question });
  // В памяти тоже отметить: следующий получатель в этом же запуске получит другое фото.
  const after = botPhotoSentWrite(photo);
  photo.sentCount += 1;
  photo.lastSentAt = new Date().toISOString();
  return { url: photoFileUrl(photo), name: photo.fileName || "photo.jpg", caption, after, photo };
}

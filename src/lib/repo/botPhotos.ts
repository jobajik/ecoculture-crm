import { commitAtomic, readTable, rowToRecord, SHEET_TABS, type WriteOp } from "../sheets";
import { generateId } from "../id";
import type { BotPhoto } from "../botPhotos";

/** Фото для рассылок и бота (`botPhotos.ts`). Файл — во вкладке WaFiles. */

type Row = BotPhoto & { rowNumber: number };

function toPhoto(r: Record<string, string>, rowNumber: number): Row {
  return {
    photoId: r.PhotoID || "",
    createdAt: r.CreatedAt || "",
    createdByEmail: r.CreatedByEmail || "",
    flowerType: r.FlowerType || "",
    variety: r.Variety || "",
    grade: r.Grade || "",
    caption: r.Caption || "",
    fileId: r.FileID || "",
    fileName: r.FileName || "",
    // Пусто — включено (новая строка); выключают явно.
    active: !/^(false|нет|no|0)$/i.test((r.Active || "").trim()),
    sentCount: Number(r.SentCount) || 0,
    lastSentAt: r.LastSentAt || "",
    rowNumber,
  };
}

export async function listBotPhotos(fresh = false): Promise<Row[]> {
  try {
    const t = await readTable(SHEET_TABS.BOT_PHOTOS, { fresh });
    return t.rows.map((row, i) => toPhoto(rowToRecord(SHEET_TABS.BOT_PHOTOS, row), t.rowNumbers[i])).filter((p) => p.photoId);
  } catch {
    return [];
  }
}

export async function createBotPhoto(input: Omit<BotPhoto, "photoId" | "createdAt" | "active" | "sentCount" | "lastSentAt">): Promise<string> {
  const photoId = generateId("PH");
  await commitAtomic([
    {
      kind: "append",
      tab: SHEET_TABS.BOT_PHOTOS,
      records: [
        {
          PhotoID: photoId,
          CreatedAt: new Date().toISOString(),
          CreatedByEmail: input.createdByEmail,
          FlowerType: input.flowerType,
          Variety: input.variety,
          Grade: input.grade,
          Caption: input.caption,
          FileID: input.fileId,
          FileName: input.fileName,
          Active: "TRUE",
          SentCount: 0,
          LastSentAt: "",
        },
      ],
    },
  ]);
  return photoId;
}

export function botPhotoUpdate(rowNumber: number, changes: Record<string, unknown>): WriteOp {
  return { kind: "update", tab: SHEET_TABS.BOT_PHOTOS, rowNumber, changes };
}

/** Фото отправлено: счётчик и время — для ротации. */
export function botPhotoSentWrite(photo: Row, at = new Date()): WriteOp {
  return botPhotoUpdate(photo.rowNumber, { SentCount: photo.sentCount + 1, LastSentAt: at.toISOString() });
}

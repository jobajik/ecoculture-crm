"use server";

import { getServerSession } from "next-auth";
import { revalidatePath } from "next/cache";
import { authOptions } from "@/lib/auth";
import { createBatch, createBatches, type NewBatchInput } from "@/lib/repo/batches";
import { parseBatchesWorkbook, type ParsedBatchRow, type ParseResult } from "@/lib/excel";
import { listVarietiesByType } from "@/lib/repo/varieties";
import { getBatchById } from "@/lib/repo/batches";
import { FLOWER_TYPE_LABELS, farmLabel, getFarmFor } from "@/lib/constants";
import { getOrderById } from "@/lib/repo/orders";
import { isReadyToShip, notReadyReason } from "@/lib/orderReady";
import { createShipment, type NewShipmentInput } from "@/lib/repo/shipments";
import { createWriteoff, type NewWriteoffInput } from "@/lib/repo/writeoffs";
import { createStaffTakeout, type NewStaffTakeoutInput } from "@/lib/repo/staffTakeouts";
import { cleanStaffName, takeoutRefusal } from "@/lib/staffTakeout";

async function requireWarehouse() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) throw new Error("Не авторизован");
  if (session.user.role !== "warehouse" && session.user.role !== "admin") {
    throw new Error("Недостаточно прав: действие доступно только зав. складом");
  }
  const isAdmin = session.user.role === "admin";
  const farm = isAdmin ? null : session.user.farm ?? null;
  // Пустая колонка Farm у зав. складом раньше означала «все производства»:
  // `assertOwnFlowerType` выходил на `if (!farm) return`. То есть строка в
  // Users, где Farm просто забыли дописать, открывала человеку чужой склад —
  // принимать, отгружать и СПИСЫВАТЬ чужой цветок. Забыть последнюю колонку
  // легко, и заметить это по поведению нельзя. Теперь такой доступ закрыт.
  if (!isAdmin && !farm) {
    throw new Error(
      "У вас не указано производство. Попросите администратора заполнить колонку Farm " +
        "на вкладке Users — без неё работать со складом нельзя."
    );
  }
  return { email: session.user.email, farm };
}

/** Зав. складом не может принимать, отгружать и списывать чужой цветок. */
function assertOwnFlowerType(farm: string | null, flowerType: string) {
  if (!farm) return;
  if (getFarmFor(flowerType) !== farm) {
    throw new Error(
      `${FLOWER_TYPE_LABELS[flowerType] ?? flowerType} относится к производству ` +
        `«${farmLabel(getFarmFor(flowerType))}», а вы отвечаете за «${farmLabel(farm)}»`
    );
  }
}

export async function createBatchAction(input: Omit<NewBatchInput, "receivedByEmail">) {
  const { email, farm } = await requireWarehouse();
  assertOwnFlowerType(farm, input.flowerType);
  if (!input.variety.trim()) throw new Error("Укажите сорт");
  if (!input.quantityIn || input.quantityIn <= 0) throw new Error("Укажите количество");
  if (!input.harvestDate) throw new Error("Укажите дату сбора/срезки");

  const batchId = await createBatch({ ...input, receivedByEmail: email });
  revalidatePath("/warehouse");
  revalidatePath("/warehouse/batches");
  revalidatePath("/analytics");
  return batchId;
}

/**
 * Читает загруженный Excel-файл приёмки и возвращает разобранные строки
 * с пометками об ошибках. Ничего не записывает — сначала кладовщик смотрит,
 * что распозналось, и только потом подтверждает загрузку.
 */
export async function parseBatchesFileAction(formData: FormData): Promise<ParseResult> {
  const { farm } = await requireWarehouse();

  const file = formData.get("file");
  if (!file || typeof file === "string") {
    return { rows: [], validCount: 0, errorCount: 0, fatalError: "Файл не получен" };
  }

  const [buffer, varieties] = await Promise.all([
    (file as File).arrayBuffer(),
    listVarietiesByType(),
  ]);
  const parsed = await parseBatchesWorkbook(buffer, varieties);

  // Строки чужого производства помечаем ошибкой — загрузить их нельзя.
  if (farm) {
    for (const row of parsed.rows) {
      if (!row.error && getFarmFor(row.flowerType) !== farm) {
        row.error =
          `${FLOWER_TYPE_LABELS[row.flowerType] ?? row.flowerType} — это производство ` +
          `«${farmLabel(getFarmFor(row.flowerType))}», а вы принимаете «${farmLabel(farm)}»`;
      }
    }
    parsed.validCount = parsed.rows.filter((r) => !r.error).length;
    parsed.errorCount = parsed.rows.filter((r) => r.error).length;
  }

  return parsed;
}

/** Записывает на склад строки, которые кладовщик подтвердил после проверки файла. */
export async function importBatchesAction(rows: ParsedBatchRow[]) {
  const { email, farm } = await requireWarehouse();

  const valid = rows.filter((r) => !r.error && r.quantity > 0 && r.variety && r.grade && r.harvestDate);
  if (valid.length === 0) throw new Error("Нет ни одной корректной строки для загрузки");
  for (const row of valid) assertOwnFlowerType(farm, row.flowerType);

  const batchIds = await createBatches(
    valid.map((r) => ({
      harvestDate: r.harvestDate,
      flowerType: r.flowerType,
      variety: r.variety.trim(),
      grade: r.grade,
      quantityIn: r.quantity,
      location: r.location?.trim() ?? "",
      receivedByEmail: email,
    }))
  );

  revalidatePath("/warehouse");
  revalidatePath("/warehouse/batches");
  revalidatePath("/analytics");

  return { created: batchIds.length, totalStems: valid.reduce((sum, r) => sum + r.quantity, 0) };
}

export async function createShipmentAction(input: Omit<NewShipmentInput, "warehouseEmail">) {
  const { email, farm } = await requireWarehouse();
  if (!input.quantity || input.quantity <= 0) throw new Error("Укажите количество к отгрузке");

  // Цветок не уезжает раньше денег. Проверка стоит именно здесь, а не только
  // в интерфейсе: кнопку можно не показать, а вот прямую ссылку на страницу
  // отгрузки никто не отменял.
  const order = await getOrderById(input.orderId);
  if (!order) throw new Error("Заявка не найдена");
  if (!isReadyToShip(order)) {
    throw new Error(
      `Отгружать пока нельзя: ${notReadyReason(order).toLowerCase()}. ` +
        "Менеджер ставит свою галочку на заявке, оплату проводит бухгалтер."
    );
  }

  const batch = await getBatchById(input.batchId);
  if (!batch) throw new Error("Партия не найдена");
  assertOwnFlowerType(farm, batch.flowerType);

  const shipmentId = await createShipment({ ...input, warehouseEmail: email });
  revalidatePath("/warehouse");
  revalidatePath("/warehouse/batches");
  revalidatePath(`/orders/${input.orderId}`);
  revalidatePath("/orders");
  revalidatePath("/analytics");
  return shipmentId;
}

export async function createWriteoffAction(input: Omit<NewWriteoffInput, "warehouseEmail">) {
  const { email, farm } = await requireWarehouse();
  if (!input.quantity || input.quantity <= 0) throw new Error("Укажите количество к списанию");

  const writeoffBatch = await getBatchById(input.batchId);
  if (!writeoffBatch) throw new Error("Партия не найдена");
  assertOwnFlowerType(farm, writeoffBatch.flowerType);
  if (!input.reason.trim()) throw new Error("Укажите причину списания");

  const writeoffId = await createWriteoff({ ...input, warehouseEmail: email });
  revalidatePath("/warehouse/batches");
  revalidatePath("/analytics");
  return writeoffId;
}

/**
 * Выдача цветка сотруднику в счёт зарплаты.
 *
 * Все правила — одной чистой функцией `takeoutRefusal()`: и роль, и своё
 * производство, и остаток партии, и дата не из будущего. Расписывать их здесь
 * вложенными `if` означало бы, что проверить их можно только на живой базе, —
 * ровно так до сентября жила отмена заявки.
 */
export async function createStaffTakeoutAction(
  input: Omit<NewStaffTakeoutInput, "warehouseEmail">
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) throw new Error("Не авторизован");
  const role = session.user.role ?? "";
  const farm = role === "warehouse" ? session.user.farm ?? null : null;

  const batch = await getBatchById(input.batchId);
  const refusal = takeoutRefusal({
    role,
    farm,
    staffName: input.staffName,
    quantity: input.quantity,
    unitPrice: input.unitPrice,
    date: input.date,
    today: todayKey(),
    batch: batch ? { flowerType: batch.flowerType, quantityRemaining: batch.quantityRemaining } : null,
  });
  if (refusal) throw new Error(refusal);

  const takeoutId = await createStaffTakeout({
    ...input,
    staffName: cleanStaffName(input.staffName),
    warehouseEmail: session.user.email,
  });

  revalidatePath("/warehouse/takeouts");
  revalidatePath("/warehouse/batches");
  revalidatePath("/finance/takeouts");
  revalidatePath("/analytics");
  return takeoutId;
}

/** Сегодняшний день по местному времени — «ГГГГ-ММ-ДД». */
function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

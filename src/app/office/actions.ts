"use server";

import { getServerSession } from "next-auth";
import { revalidatePath } from "next/cache";
import { authOptions } from "@/lib/auth";
import { guard } from "@/lib/actionResult";
import { canMoveToOffice, moveRefusal, type MoveDirection, type MoveLine } from "@/lib/officeStore";
import { flowerTypesForFarm } from "@/lib/constants";
import { moveStock, previewStockMove } from "@/lib/repo/stockMoves";
import type { WriteoffPlan } from "@/lib/writeoffPlan";

// Перемещение основной склад ⇄ офис (`officeStore.ts`). Перемещает РОП и админ — решение владельца; склад офиса только
// видит, что к нему пришло; зав. складом производства отдаёт свой цветок в офис (09.11.2026, `moveRefusal`).

async function requireMover(direction: MoveDirection, lines: MoveLine[]) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) throw new Error("Не авторизован");
  if (!canMoveToOffice(session.user.role)) throw new Error("Перемещает цветок между складами РОП или администратор");
  const why = moveRefusal(session.user.role, session.user.farm ?? null, direction, lines, flowerTypesForFarm);
  if (why) throw new Error(why);
  return { email: session.user.email };
}

function cleanDirection(raw: unknown): MoveDirection {
  if (raw === "to_office" || raw === "to_main") return raw;
  throw new Error("Не понятно, куда перемещать");
}

function cleanLines(lines: MoveLine[]): MoveLine[] {
  if (!Array.isArray(lines) || lines.length === 0) throw new Error("Впишите, сколько переместить, хотя бы в одну строку");
  if (lines.length > 300) throw new Error("Слишком много строк за раз — не больше 300");
  return lines.map((l) => ({
    flowerType: String(l.flowerType ?? ""),
    variety: String(l.variety ?? "").trim(),
    grade: String(l.grade ?? "").trim(),
    quantity: Number(l.quantity),
  }));
}

async function previewMoveActionInner(direction: MoveDirection, lines: MoveLine[]): Promise<WriteoffPlan> {
  const dir = cleanDirection(direction);
  const clean = cleanLines(lines);
  await requireMover(dir, clean);
  return previewStockMove(dir, clean);
}

async function moveStockActionInner(direction: MoveDirection, lines: MoveLine[], note: string) {
  const dir = cleanDirection(direction);
  const clean = cleanLines(lines);
  const { email } = await requireMover(dir, clean);
  const result = await moveStock({ direction: dir, lines: clean, byEmail: email, note });
  revalidatePath("/office");
  revalidatePath("/office/moves");
  revalidatePath("/warehouse");
  revalidatePath("/warehouse/batches");
  revalidatePath("/warehouse/to-office");
  revalidatePath("/");
  return result;
}

// Отказ ВОЗВРАЩАЕТСЯ, а не бросается — см. src/lib/actionResult.ts (грабли 1.13).
export async function previewMoveAction(...args: Parameters<typeof previewMoveActionInner>) {
  return guard(() => previewMoveActionInner(...args));
}

export async function moveStockAction(...args: Parameters<typeof moveStockActionInner>) {
  return guard(() => moveStockActionInner(...args));
}

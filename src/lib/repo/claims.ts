import { appendRow, readTable, rowToRecord, SHEET_TABS, updateWhere } from "../sheets";
import { generateId } from "../id";
import { CLAIM_STATUSES } from "../constants";
import { toIsoDate, toIsoDateTime } from "../sheetDate";
import type { Claim } from "../types";

/**
 * Рекламации во вкладке Claims.
 *
 * Разговор между менеджером и бухгалтером о том, что с заявкой не так. Менеджер
 * заводит (клиент пожаловался ему), бухгалтер решает: провести — то есть
 * пересчитать заявку — или отклонить с объяснением. Так решил владелец.
 *
 * Чтения обёрнуты в try/catch: пока вкладка не создана (`npm run setup-sheet`),
 * страница должна показывать пустой список, а не падать.
 */

function toClaim(record: Record<string, string>): Claim {
  return {
    claimId: record.ClaimID || "",
    createdAt: toIsoDateTime(record.CreatedAt),
    orderId: record.OrderID || "",
    managerEmail: (record.ManagerEmail || "").toLowerCase(),
    reason: record.Reason || "",
    comment: record.Comment || "",
    status: record.Status || CLAIM_STATUSES.NEW,
    decidedAt: toIsoDateTime(record.DecidedAt),
    accountantEmail: (record.AccountantEmail || "").toLowerCase(),
    decision: record.Decision || "",
  };
}

export async function listClaims(): Promise<Claim[]> {
  try {
    const table = await readTable(SHEET_TABS.CLAIMS);
    return table.rows
      .map((row) => toClaim(rowToRecord(SHEET_TABS.CLAIMS, row)))
      .filter((c) => c.claimId && c.orderId)
      // Свежие сверху: бухгалтер работает с новыми, а не листает историю.
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  } catch {
    return [];
  }
}

export async function createClaim(input: {
  orderId: string;
  managerEmail: string;
  reason: string;
  comment: string;
}): Promise<string> {
  const claimId = generateId("CLM");
  await appendRow(SHEET_TABS.CLAIMS, {
    ClaimID: claimId,
    CreatedAt: new Date().toISOString(),
    OrderID: input.orderId,
    ManagerEmail: input.managerEmail,
    Reason: input.reason,
    Comment: input.comment,
    Status: CLAIM_STATUSES.NEW,
    DecidedAt: "",
    AccountantEmail: "",
    Decision: "",
  });
  return claimId;
}

/** Решение бухгалтера. Отменить решение нельзя — можно завести новую рекламацию. */
export async function decideClaim(
  claimId: string,
  status: string,
  accountantEmail: string,
  decision: string
): Promise<boolean> {
  return updateWhere(
    SHEET_TABS.CLAIMS,
    (record) => record.ClaimID === claimId,
    () => ({
      Status: status,
      DecidedAt: new Date().toISOString(),
      AccountantEmail: accountantEmail,
      Decision: decision,
    })
  );
}

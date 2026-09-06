import { readTable, rowToRecord, SHEET_TABS } from "../sheets";
import type { AppUser } from "../types";
import type { Role } from "../constants";

function toUser(record: Record<string, string>): AppUser {
  return {
    email: (record.Email || "").trim().toLowerCase(),
    name: record.Name || "",
    role: (record.Role || "manager").trim() as Role,
    farm: (record.Farm || "").trim().toLowerCase() || null,
    active: (record.Active || "").toString().trim().toUpperCase() !== "FALSE",
  };
}

export async function listUsers(): Promise<AppUser[]> {
  const table = await readTable(SHEET_TABS.USERS);
  return table.rows.map((row) => toUser(rowToRecord(SHEET_TABS.USERS, row)));
}

export async function getUserByEmail(email: string): Promise<AppUser | null> {
  const normalized = email.trim().toLowerCase();
  const users = await listUsers();
  return users.find((u) => u.email === normalized) ?? null;
}

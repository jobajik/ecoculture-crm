import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

/**
 * Поменять роль сотрудника, не трогая имя, производство и активность.
 * Без --yes — только показ.
 *
 *   npx tsx scripts/set-staff-role.ts <почта> <роль> [--yes]
 */
import { ROLES, ROLE_LABELS, isFarmBoundRole } from "../src/lib/constants";
import { getUserByEmail, saveUser } from "../src/lib/repo/users";

async function main() {
  const [email, role] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  if (!email || !role) throw new Error("Укажите почту и роль");
  if (!(Object.values(ROLES) as string[]).includes(role)) throw new Error(`Нет такой роли: ${role}`);
  const user = await getUserByEmail(email);
  if (!user) throw new Error(`Сотрудник ${email} не найден`);
  console.log(`${user.name || user.email}: ${ROLE_LABELS[user.role] ?? user.role} → ${ROLE_LABELS[role]}`);
  if (!process.argv.includes("--yes")) return console.log("Только показ.");
  await saveUser({
    email: user.email,
    name: user.name || "",
    role,
    farm: isFarmBoundRole(role) ? user.farm || "" : "",
    active: user.active,
  });
  const after = await getUserByEmail(email);
  console.log(`Сохранено. Сейчас в таблице: ${after?.role}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});

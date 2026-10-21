import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

/**
 * Записать сотруднику номер WhatsApp (колонка Phone в Users — то же, что поле «WhatsApp» в «Настройки →
 * Сотрудники») и закрыть лиды, заведённые на этот номер по ошибке: авто-лид «Сам написал в WhatsApp Эмиля»
 * на номер РОПа или зав. склада — не клиент. Закрытие — стадия «Отказ» с причиной «Неверный контакт» и
 * пометкой в заметке; карточки клиентов не трогаются (сотрудник, который ещё и покупает, — редкость, и это
 * решает человек). Без --yes — показ. Номер в любом виде: «+7 701…», «8701…».
 *
 *   npx tsx scripts/set-staff-phone.ts <почта сотрудника> <номер | line:<код линии>> [--yes]
 *
 * 20.10.2026, владелец: «Разия Теплица у всех менеджеров — зав. склада, Диана тоже, Нина — РОП».
 */
import { listUsers, saveUser } from "../src/lib/repo/users";
import { listLeads, updateLead } from "../src/lib/repo/leads";
import { listClients } from "../src/lib/repo/clients";
import { CLOSED_STAGES, phoneKey } from "../src/lib/leads";
import { formatPhone, phoneComplete } from "../src/lib/phone";
import { listWaLines } from "../src/lib/repo/waLines";

async function main() {
  const [emailRaw, phoneRaw] = process.argv.slice(2);
  const apply = process.argv.includes("--yes");
  const email = (emailRaw || "").trim().toLowerCase();
  // «line:<код>» — номер, который Green API назвал у подключённой линии менеджера (полный номер в чат не пишем).
  const fromLine = (phoneRaw || "").startsWith("line:") ? (await listWaLines({ fresh: true })).find((l) => l.code === phoneRaw.slice(5)) : null;
  if ((phoneRaw || "").startsWith("line:") && !fromLine?.phone) throw new Error(`у линии ${phoneRaw.slice(5)} нет номера`);
  const phone = formatPhone(fromLine ? fromLine.phone : phoneRaw || "");
  if (!email || !phoneComplete(phone)) throw new Error("нужны почта сотрудника и полный номер");

  const users = await listUsers();
  const user = users.find((u) => u.email === email);
  if (!user) throw new Error(`сотрудника ${email} нет в Users`);
  const taken = users.find((u) => u.email !== email && phoneKey(u.phone) === phoneKey(phone));
  if (taken) throw new Error(`этот номер уже стоит у ${taken.name} (${taken.email})`);
  console.log(`${user.name} (${user.role}): WhatsApp ${user.phone || "—"} → ${phone}`);

  const key = phoneKey(phone);
  const leads = (await listLeads({ fresh: true })).filter((l) => phoneKey(l.phone) === key);
  const open = leads.filter((l) => !CLOSED_STAGES.includes(l.stage));
  for (const l of leads) console.log(`  лид «${l.name}» ${l.leadId}: ${l.stage}${open.includes(l) ? " — закрою как «Неверный контакт»" : " — уже закрыт"}`);
  const clients = (await listClients()).filter((c) => [c.phone, c.messenger, c.kaspiPay1, c.kaspiPay2].some((p) => phoneKey(p) === key));
  for (const c of clients) console.log(`  карточка клиента «${c.name}» ${c.clientId} — не трогаю, решите сами`);

  if (!apply) return console.log("Только показ. Записать: --yes");
  await saveUser({ email: user.email, name: user.name, role: user.role, farm: user.farm ?? "", active: user.active, phone });
  for (const l of open) {
    const note = [l.note, `Номер сотрудника (${user.name}), лид закрыт CRM ${new Date().toISOString().slice(0, 10)}.`].filter(Boolean).join(" ");
    await updateLead(l.leadId, { Stage: "lost", LostReason: "Неверный контакт", Note: note });
  }
  console.log(`Записано. Закрыто лидов: ${open.length}.`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});

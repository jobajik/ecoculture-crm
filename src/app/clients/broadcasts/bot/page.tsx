import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { ROLES } from "@/lib/constants";
import { prefetchTables, SHEET_TABS } from "@/lib/sheets";
import { formatMoment } from "@/lib/formatDate";
import { phoneKey } from "@/lib/leads";
import { botSettingsFrom, dailyLimitOf, effectiveDailyLimit, warmupDay } from "@/lib/broadcast";
import { localDayKey } from "@/lib/timezone";
import { listBotChats, settingsMap } from "@/lib/repo/broadcasts";
import { listClients } from "@/lib/repo/clients";
import { listLeads } from "@/lib/repo/leads";
import { listUsers } from "@/lib/repo/users";
import { openAiConfigured } from "@/lib/openai";
import { greenConfig } from "@/lib/greenApi";
import PageHeader from "@/components/PageHeader";
import Section from "@/components/Section";
import BotSettingsForm from "@/components/BotSettingsForm";
import HandoffRelease from "@/components/HandoffRelease";
import { clientsTabsFor } from "../../tabs";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const MODE_LABEL: Record<string, string> = { bot: "отвечает бот", handoff: "передано менеджеру", optout: "отписался" };

export default async function BotPage() {
  const session = await getServerSession(authOptions);
  const role = session?.user?.role;
  if (role !== ROLES.ADMIN && role !== ROLES.SALES_HEAD) redirect("/clients");

  await prefetchTables([SHEET_TABS.BOT_CHATS, SHEET_TABS.SETTINGS, SHEET_TABS.CLIENTS, SHEET_TABS.LEADS, SHEET_TABS.USERS]);
  const [chats, map, clients, leads, users] = await Promise.all([listBotChats(), settingsMap(), listClients(), listLeads(), listUsers()]);
  const settings = botSettingsFrom(map);
  const names = new Map(users.map((u) => [u.email.toLowerCase(), u.name || u.email]));
  const owner = new Map<string, { href: string; name: string; manager: string }>();
  for (const l of leads) {
    const k = phoneKey(l.phone);
    if (k) owner.set(k, { href: `/clients/leads/${l.leadId}`, name: l.name, manager: l.managerEmail });
  }
  for (const c of clients) {
    const k = phoneKey(c.phone);
    if (k) owner.set(k, { href: `/clients/${c.clientId}`, name: c.name, manager: c.managerEmail });
  }
  // Бот менеджеру не передаёт — он оставляет записку: собранный заказ или тревогу (за 3 дня).
  const since = Date.now() - 3 * 24 * 3600000;
  const handoffs = chats
    .filter((c) => c.mode !== "optout" && c.handoffReason && Date.parse(c.handoffAt || "") >= since)
    .sort((a, b) => (a.handoffAt < b.handoffAt ? 1 : -1));
  const recent = chats
    .filter((c) => c.botReplies > 0 || c.mode === "optout")
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
    .slice(0, 30);

  const who = (phone: string) => {
    const o = owner.get(phoneKey(phone));
    return o ? (
      <>
        <Link href={o.href} className="text-series-1">
          {o.name || "Без имени"}
        </Link>
        {o.manager && <span className="text-xs text-ink-muted"> · {names.get(o.manager.toLowerCase()) ?? o.manager}</span>}
      </>
    ) : (
      <span>+{phone}</span>
    );
  };

  return (
    <div className="space-y-6">
      <PageHeader
        area="leads"
        title="Бот WhatsApp"
        tabs={clientsTabsFor(undefined, role)}
        actions={
          <Link href="/clients/broadcasts" className="text-sm text-ink-secondary hover:underline">
            ← рассылки
          </Link>
        }
      />

      {(!greenConfig() || !openAiConfigured()) && (
        <div className="rounded-xl bg-status-warning/10 px-4 py-3 text-sm text-[#8a5a00]">
          {!greenConfig() && "WhatsApp (Green API) не подключён — ключи вводятся в whatsapp-key.bat. "}
          {!openAiConfigured() && "ИИ (OpenAI) не подключён — без него бот только передаёт чаты менеджеру."}
        </div>
      )}

      <Section tone="leads" icon="gear" title="Настройки">
        <BotSettingsForm initial={settings} dailyLimit={dailyLimitOf(map.BroadcastDailyLimit)} todayNote={todayLimitNote(map)} />
      </Section>

      <Section tone="warn" icon="alert" title={`Заказы и тревоги от бота: ${handoffs.length}`} flush>
        {handoffs.length === 0 ? (
          <p className="px-4 py-4 text-sm text-ink-muted">Сейчас ничего не ждёт.</p>
        ) : (
          <ul className="divide-y divide-line-hairline">
            {handoffs.map((c) => (
              <li key={c.phone} className="px-4 py-3 text-sm space-y-1">
                <div>
                  {who(c.phone)} <span className="text-xs text-ink-muted">· {formatMoment(c.handoffAt)}</span>
                </div>
                {c.handoffReason && <div className="text-ink-secondary">{c.handoffReason}</div>}
                {c.context.length > 0 && (
                  <div className="text-xs text-ink-muted line-clamp-2">
                    Последнее от клиента: {[...c.context].reverse().find((m) => m.role === "client")?.text ?? "—"}
                  </div>
                )}
                <HandoffRelease phone={c.phone} />
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section tone="leads" icon="list" title="Последние разговоры бота" flush>
        {recent.length === 0 ? (
          <p className="px-4 py-4 text-sm text-ink-muted">Бот ещё никому не отвечал.</p>
        ) : (
          <ul className="divide-y divide-line-hairline">
            {recent.map((c) => (
              <li key={c.phone} className="px-4 py-3 text-sm space-y-1">
                <div>
                  {who(c.phone)}{" "}
                  <span className="text-xs text-ink-muted">
                    · {MODE_LABEL[c.mode] ?? c.mode} · ответов бота: {c.botReplies} · {formatMoment(c.updatedAt)}
                  </span>
                </div>
                <details>
                  <summary className="cursor-pointer text-xs text-accent">переписка</summary>
                  <div className="mt-2 space-y-1">
                    {c.context.map((m, i) => (
                      <div key={i} className={m.role === "client" ? "" : "text-series-1"}>
                        <b>{m.role === "client" ? "Клиент" : "Мы"}:</b> {m.text}
                      </div>
                    ))}
                  </div>
                </details>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}

/** «Сегодня — 20 (разогрев номера, день 1 из 7)»: предел дня с учётом разогрева после блокировки. */
function todayLimitNote(map: Record<string, string>): string {
  const today = localDayKey();
  const limit = effectiveDailyLimit(map.BroadcastDailyLimit, map.BroadcastWarmupFrom, today);
  const day = warmupDay(map.BroadcastWarmupFrom, today);
  return day && day <= 7 ? `Сегодня — не больше ${limit}: разогрев номера, день ${day} из 7` : `Сегодня — не больше ${limit}`;
}

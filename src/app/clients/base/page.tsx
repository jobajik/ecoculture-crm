import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import clsx from "clsx";
import { authOptions } from "@/lib/auth";
import { ROLES } from "@/lib/constants";
import { loadBase, visibleEntries } from "@/lib/baseRunner";
import { BASE_CLASSES, BASE_CLASS_HINTS, BASE_CLASS_LABELS, BASE_KIND_LABELS, workLists, type BaseClass, type BaseEntry } from "@/lib/baseClass";
import { waPhone } from "@/lib/broadcast";
import { formatDay } from "@/lib/formatDate";
import PageHeader from "@/components/PageHeader";
import Section from "@/components/Section";
import KpiTile from "@/components/KpiTile";
import Pill from "@/components/Pill";
import PagedList from "@/components/PagedList";
import PaneTabs from "@/components/PaneTabs";
import BaseMoves, { type BaseMoveRow } from "@/components/BaseMoves";
import { clientsTabsFor } from "../tabs";
import { cityScopeOf } from "@/lib/cityScope";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 60;

const money = (v: number) => `${Math.round(v).toLocaleString("ru-RU")} ₸`;
const TONE: Record<BaseClass, "good" | "wait" | "bad" | "muted"> = {
  active: "good",
  cooling: "wait",
  sleeping: "wait",
  lost_client: "bad",
  talking: "good",
  warm: "muted",
  silent: "muted",
  untouched: "muted",
  refused: "bad",
  not_ours: "muted",
};
/** Сколько строк списка «Все люди» рисуем за раз: вся база — пять тысяч человек, страницу она бы утопила. */
const LIST_LIMIT = 300;

/**
 * «Клиенты → База» (26.11.2026). Владелец: «Всю клиентскую базу нужно классифицировать: определить, кто из них кто.
 * Принадлежность к менеджерам, незаинтересованных и прочее. И ещё раз мне нужно поменять работу с клиентской базой».
 * Его решения: один экран вместо доски лидов; состояние человека считается само, стадии руками не ведут; нетронутая
 * база обзвона — в общий пул; чей клиент — того, с чьим номером он переписывается, но с подтверждением.
 *
 * Здесь: кто в каком состоянии (`baseClass.ts`), что сделать сегодня (ответить, вернуть, дожать), чьи люди, переносы на
 * подтверждение и «раздать». Владелец и РОП видят всю базу, менеджер и Земфира — своих.
 */
export default async function BasePage({ searchParams }: { searchParams?: { m?: string; cls?: string } }) {
  const session = await getServerSession(authOptions);
  const role = session?.user?.role ?? "";
  const email = (session?.user?.email ?? "").toLowerCase();
  const manage = role === ROLES.ADMIN || role === ROLES.SALES_HEAD;
  if (!manage && role !== ROLES.MANAGER && role !== ROLES.LEADGEN) redirect("/clients");
  const city = cityScopeOf(session?.user) !== "";

  const base = await loadBase();
  const mine = visibleEntries(base.entries, { email, role });
  const NOBODY = "none";
  const POOL = "pool";
  const picked = manage ? (searchParams?.m || "").toLowerCase() : "";
  const inPick = (e: BaseEntry) => (!picked ? true : picked === POOL ? e.pool : picked === NOBODY ? e.ownerState === "none" && !e.pool : e.owner === picked);
  const scope = mine.filter(inPick);
  const cls = BASE_CLASSES.includes(searchParams?.cls as BaseClass) ? (searchParams?.cls as BaseClass) : "";
  const lists = workLists(scope, base.today);
  const countOf = (c: BaseClass) => scope.filter((e) => e.cls === c).length;
  const pool = mine.filter((e) => e.pool).length;

  const link = (next: { m?: string; cls?: string }) => {
    const q = new URLSearchParams();
    const m = next.m !== undefined ? next.m : picked;
    const c = next.cls !== undefined ? next.cls : cls;
    if (m) q.set("m", m);
    if (c) q.set("cls", c);
    const s = q.toString();
    return s ? `/clients/base?${s}` : "/clients/base";
  };
  const hrefOf = (e: BaseEntry) => (e.clientIds[0] ? `/clients/${e.clientIds[0]}` : e.leadIds[0] ? `/clients/leads/${e.leadIds[0]}` : "");
  const chatOf = (e: BaseEntry) => (e.lastAt && waPhone(e.phone) ? `/clients/chats?line=${encodeURIComponent(e.lastLine)}&phone=${waPhone(e.phone)}` : "");
  const title = (e: BaseEntry) => e.name || (e.phone ? `Номер …${e.phone.replace(/\D/g, "").slice(-4)}` : "Без имени");
  const ownerOf = (e: BaseEntry) => (e.pool ? "общий пул" : e.owner ? `${base.nameOf(e.owner)}${e.ownerState === "gone" ? " (не работает)" : ""}` : "ничей");
  const daysAgo = (iso: string) => Math.max(0, Math.round((Date.parse(`${base.today}T00:00:00Z`) - Date.parse(`${iso.slice(0, 10)}T00:00:00Z`)) / 86400000));
  const fact = (e: BaseEntry) =>
    e.orders
      ? `заказ ${formatDay(e.lastOrderDay)} · заявок ${e.orders} · ${money(e.revenue)}`
      : e.lastInAt
        ? `писал ${formatDay(e.lastInAt.slice(0, 10))}`
        : e.lastAt
          ? `мы писали ${formatDay(e.lastAt.slice(0, 10))}, ответа нет`
          : e.callBase
            ? "из базы обзвона, без переписки"
            : "без переписки";
  const flags = (e: BaseEntry) =>
    [e.optOut ? "просил не писать" : "", e.duplicates ? "заведён несколько раз" : "", e.moveTo ? `${e.moveWhy.replace(/\s*\(.*\)$/, "")}: ${base.nameOf(e.moveTo)}` : "", e.off ? "карточка выключена" : ""].filter(Boolean).join(" · ");

  const row = (e: BaseEntry, lead?: string) => {
    const href = hrefOf(e);
    const chat = chatOf(e);
    return (
      <li key={e.key} className="px-4 py-2.5 grid grid-cols-[minmax(0,1fr)] gap-x-4 gap-y-1 lg:grid-cols-[minmax(0,1.5fr)_120px_minmax(0,1.3fr)_110px_90px] lg:items-center text-sm">
        <div className="min-w-0">
          {href ? (
            <Link href={href} className="font-medium hover:underline break-words">
              {title(e)}
            </Link>
          ) : (
            <span className="font-medium break-words">{title(e)}</span>
          )}
          <div className="text-xs text-ink-muted">
            {[BASE_KIND_LABELS[e.kind], e.city, flags(e)].filter(Boolean).join(" · ")}
          </div>
        </div>
        <div>
          <Pill tone={TONE[e.cls]}>{BASE_CLASS_LABELS[e.cls]}</Pill>
        </div>
        <div className="min-w-0 text-ink-secondary">
          {lead && <span className="text-ink-primary font-medium">{lead} · </span>}
          {fact(e)}
        </div>
        <div className="text-ink-secondary truncate">{ownerOf(e)}</div>
        <div className="lg:text-right">
          {chat && (
            <Link href={chat} className="text-accent hover:underline">
              Переписка
            </Link>
          )}
        </div>
      </li>
    );
  };
  const wait = (e: BaseEntry) => {
    const d = daysAgo(e.lastInAt);
    return d === 0 ? "ждёт с сегодня" : d === 1 ? "ждёт со вчера" : `ждёт ${d} дн.`;
  };
  const silentFor = (e: BaseEntry) => `без заказа ${daysAgo(e.lastOrderDay)} дн.`;
  const empty = (text: string) => <div className="px-4 py-6 text-sm text-ink-muted">{text}</div>;

  const all = cls ? scope.filter((e) => e.cls === cls) : scope;
  const allSorted = [...all].sort((a, b) => BASE_CLASSES.indexOf(a.cls) - BASE_CLASSES.indexOf(b.cls) || b.revenue - a.revenue || (b.lastInAt || "").localeCompare(a.lastInAt || "") || a.name.localeCompare(b.name, "ru"));

  // Владелец и РОП: чьи люди, переносы и «раздать».
  const owners = manage
    ? Array.from(
        mine.reduce((m, e) => {
          const k = e.pool ? POOL : e.ownerState === "none" ? NOBODY : e.owner;
          m.set(k, [...(m.get(k) ?? []), e]);
          return m;
        }, new Map<string, BaseEntry[]>())
      ).sort((a, b) => b[1].filter((e) => e.kind === "client").length - a[1].filter((e) => e.kind === "client").length || b[1].length - a[1].length)
    : [];
  const ownerLabel = (k: string) => (k === POOL ? "Общий пул" : k === NOBODY ? "Ничьи" : `${base.nameOf(k)}${base.idle.has(k) || !base.users.some((u) => u.active && u.email.toLowerCase() === k) ? " (не работает)" : ""}`);
  const sub = (e: BaseEntry) => [BASE_CLASS_LABELS[e.cls], e.city, e.orders ? `${money(e.revenue)} за ${e.orders} заявок` : fact(e)].filter(Boolean).join(" · ");
  const moves: BaseMoveRow[] = manage
    ? mine
        .filter((e) => e.moveTo)
        .sort((a, b) => b.revenue - a.revenue || (b.lastInAt || "").localeCompare(a.lastInAt || ""))
        .map((e) => ({ key: e.key, name: title(e), sub: sub(e), from: e.owner ? base.nameOf(e.owner) : "ничей", to: base.nameOf(e.moveTo), why: e.moveWhy }))
    : [];
  // Раздать: хозяина нет или он не работает, а человек живой — покупает, разговаривает или тёплый. Кому предложен перенос — в списке выше.
  const VALUABLE: BaseClass[] = ["active", "cooling", "sleeping", "talking", "warm"];
  const toAssign: BaseMoveRow[] = manage
    ? mine
        .filter((e) => e.ownerState !== "ok" && !e.pool && !e.moveTo && VALUABLE.includes(e.cls) && (e.clientIds.length > 0 || e.leadIds.length > 0))
        .sort((a, b) => BASE_CLASSES.indexOf(a.cls) - BASE_CLASSES.indexOf(b.cls) || b.revenue - a.revenue)
        .map((e) => ({ key: e.key, name: title(e), sub: sub(e), from: e.owner ? `${base.nameOf(e.owner)} (не работает)` : "ничей" }))
    : [];
  const takers = base.takers.map((t) => ({ email: t, name: base.nameOf(t) })).sort((a, b) => a.name.localeCompare(b.name, "ru"));

  return (
    <div>
      <PageHeader area="clients" title="База" tabs={clientsTabsFor(undefined, role, city)} />

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 sm:gap-4 mb-5">
        <KpiTile icon="client" label={manage && !picked ? "Людей в базе" : "Людей"} value={scope.length.toLocaleString("ru-RU")} hint={`покупали у нас: ${scope.filter((e) => e.kind === "client").length}`} />
        <KpiTile icon="check" label="Покупают" value={countOf("active")} hint={`остывают ${countOf("cooling")} · спят ${countOf("sleeping")}`} tone={countOf("active") ? "good" : undefined} />
        <KpiTile icon="message" label="Идёт разговор" value={countOf("talking")} hint={`тёплых ещё ${countOf("warm")}`} />
        <KpiTile icon="clock" label="Ждут ответа" value={lists.reply.length} hint={lists.stale ? `и ещё ${lists.stale} ждут дольше двух недель` : "написали нам последними"} tone={lists.reply.length ? "warn" : undefined} />
        <KpiTile icon="list" label={manage ? "В общем пуле" : "Отказались"} value={manage ? pool.toLocaleString("ru-RU") : countOf("refused")} hint={manage ? "не тронуты; им пишет автопилот «Знакомство»" : "им рассылки не уходят"} />
      </div>

      {manage && (
        <div className="flex flex-wrap gap-2 mb-5">
          {["", ...owners.map(([k]) => k)].map((k) => (
            <Link
              key={k || "all"}
              href={link({ m: k })}
              className={clsx(
                "h-8 px-3 rounded-lg border text-[13px] whitespace-nowrap flex items-center gap-1.5",
                picked === k ? "bg-accent-soft text-accent border-accent/25 font-medium" : "bg-surface border-line-hairline text-ink-secondary hover:text-ink-primary hover:border-line-strong"
              )}
            >
              {k ? ownerLabel(k) : "Вся база"}
              <b className="font-medium tabular-nums text-ink-muted">{(k ? owners.find(([o]) => o === k)?.[1].length ?? 0 : mine.length).toLocaleString("ru-RU")}</b>
            </Link>
          ))}
        </div>
      )}

      <div className="card !p-0 overflow-hidden mb-5">
        <PaneTabs
          boxed
          initial={cls ? "all" : undefined}
          tabs={[
            {
              key: "reply",
              label: "Кому ответить",
              count: lists.reply.length,
              alert: lists.reply.length > 0,
              content: <PagedList items={lists.reply.map((e) => row(e, wait(e)))} size={15} empty={empty("Никто не ждёт ответа.")} />,
            },
            {
              key: "back",
              label: "Кого вернуть",
              count: lists.back.length,
              content: <PagedList items={lists.back.map((e) => row(e, silentFor(e)))} size={15} empty={empty("Все покупатели заказывали за последний месяц.")} />,
            },
            {
              key: "push",
              label: "Кого дожать",
              count: lists.push.length,
              content: <PagedList items={lists.push.map((e) => row(e))} size={15} empty={empty("Разговоров, где последнее слово за нами, нет.")} />,
            },
            {
              key: "all",
              label: "Все люди",
              count: scope.length,
              content: (
                <>
                  <div className="flex flex-wrap gap-2 px-4 py-3 border-b border-line-hairline">
                    {(["", ...BASE_CLASSES] as ("" | BaseClass)[]).map((c) => (
                      <Link
                        key={c || "all"}
                        href={link({ cls: c })}
                        title={c ? BASE_CLASS_HINTS[c] : undefined}
                        className={clsx(
                          "h-8 px-3 rounded-lg border text-[13px] whitespace-nowrap flex items-center gap-1.5",
                          cls === c ? "bg-accent-soft text-accent border-accent/25 font-medium" : "bg-surface border-line-hairline text-ink-secondary hover:text-ink-primary hover:border-line-strong"
                        )}
                      >
                        {c ? BASE_CLASS_LABELS[c] : "Все"}
                        <b className="font-medium tabular-nums text-ink-muted">{(c ? countOf(c) : scope.length).toLocaleString("ru-RU")}</b>
                      </Link>
                    ))}
                  </div>
                  {cls && <div className="px-4 py-2 text-xs text-ink-muted border-b border-line-hairline">{BASE_CLASS_LABELS[cls]} — {BASE_CLASS_HINTS[cls]}.</div>}
                  <PagedList items={allSorted.slice(0, LIST_LIMIT).map((e) => row(e))} size={20} resetKey={`${picked}|${cls}`} empty={empty("Никого.")} />
                  {allSorted.length > LIST_LIMIT && (
                    <div className="px-4 py-3 text-xs text-ink-muted border-t border-line-hairline">
                      Показаны первые {LIST_LIMIT} из {allSorted.length.toLocaleString("ru-RU")} — выберите состояние{manage ? " или менеджера" : ""}, чтобы сузить список.
                    </div>
                  )}
                </>
              ),
            },
          ]}
        />
      </div>

      {manage && (
        <>
          <Section tone="warn" icon="alert" title={`Переносы на подтверждение · ${moves.length}`} aside={<span className="text-xs text-ink-muted">записан за одним, а работает с другим</span>} flush>
            <BaseMoves mode="moves" rows={moves} />
          </Section>

          <Section tone="leads" icon="client" title={`Раздать · ${toAssign.length}`} aside={<span className="text-xs text-ink-muted">ничьи и люди тех, кто не работает с клиентами</span>} flush>
            <BaseMoves mode="assign" rows={toAssign} takers={takers} />
          </Section>

          <Section tone="analytics" icon="chart" title="Чьи люди" aside={<span className="text-xs text-ink-muted">менеджер × состояние</span>} flush>
            <div className="table-scroll overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-ink-secondary border-b border-line-hairline">
                    <th className="px-3 py-2.5 font-medium">Чьи</th>
                    {BASE_CLASSES.map((c) => (
                      <th key={c} className="px-2 py-2.5 font-medium text-right whitespace-nowrap" title={BASE_CLASS_HINTS[c]}>
                        {BASE_CLASS_LABELS[c]}
                      </th>
                    ))}
                    <th className="px-3 py-2.5 font-medium text-right">Всего</th>
                    <th className="px-3 py-2.5 font-medium text-right whitespace-nowrap">Куплено</th>
                  </tr>
                </thead>
                <tbody>
                  {owners.map(([k, list]) => (
                    <tr key={k} className="border-b border-line-hairline/70 last:border-0">
                      <td className="px-3 py-2">
                        <Link href={link({ m: k, cls: "" })} className="font-medium hover:underline">
                          {ownerLabel(k)}
                        </Link>
                      </td>
                      {BASE_CLASSES.map((c) => {
                        const n = list.filter((e) => e.cls === c).length;
                        return (
                          <td key={c} className="px-2 py-2 text-right tabular-nums">
                            {n ? (
                              <Link href={link({ m: k, cls: c })} className="hover:underline">
                                {n.toLocaleString("ru-RU")}
                              </Link>
                            ) : (
                              <span className="text-ink-muted">·</span>
                            )}
                          </td>
                        );
                      })}
                      <td className="px-3 py-2 text-right tabular-nums font-medium">{list.length.toLocaleString("ru-RU")}</td>
                      <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap text-ink-secondary">{money(list.reduce((s, e) => s + e.revenue, 0))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="px-4 py-3 text-xs text-ink-muted border-t border-line-hairline">
              Состояние считается само: по заявкам, сообщениям WhatsApp на всех номерах и касаниям. Хозяин — менеджер карточки клиента, иначе лида, иначе тот, на чей номер человек
              пишет. Общий пул — лиды без менеджера, с которыми никто не работал: им понемногу пишет автопилот «Знакомство».
            </div>
          </Section>
        </>
      )}
    </div>
  );
}

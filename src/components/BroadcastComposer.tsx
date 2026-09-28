"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { createBroadcastAction, sendTestAction, uploadFilePartAction } from "@/app/clients/broadcasts/actions";
import { unwrapValue } from "@/lib/actionResult";
import { OPT_OUT_LINE, greetingName, personalize, type AudienceRow } from "@/lib/broadcast";
import { LEAD_STAGES } from "@/lib/leads";

/**
 * Новая рассылка: кому (клиенты, лиды, фильтры, галочки), что (текст с {имя},
 * картинка или PDF), проверка на свой номер — и создание. Отправка начинается
 * на странице рассылки, отдельной кнопкой.
 */

type Row = Pick<
  AudienceRow,
  "kind" | "refId" | "name" | "contactPerson" | "city" | "managerEmail" | "clientType" | "stage" | "campaign" | "segment" | "daysSinceOrder" | "waPhone" | "excluded"
>;

const ORDER_FILTERS = [
  { key: "", label: "любые" },
  { key: "14", label: "не заказывали 2+ недели" },
  { key: "30", label: "не заказывали 30+ дней" },
  { key: "60", label: "не заказывали 60+ дней" },
  { key: "never", label: "ни разу не заказывали" },
];

const PART_CHARS = 600_000;

function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || ""));
    r.onerror = () => reject(new Error("Файл не прочитался"));
    r.readAsDataURL(file);
  });
}

/** Картинку ужимаем в браузере: WhatsApp всё равно пережмёт, а таблице лишний мегабайт ни к чему. */
async function shrinkImage(file: File): Promise<{ blob: Blob; name: string; mime: string }> {
  if (!file.type.startsWith("image/") || file.size < 700_000) return { blob: file, name: file.name, mime: file.type };
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("Картинка не открылась"));
      i.src = url;
    });
    const scale = Math.min(1, 1600 / Math.max(img.width, img.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    canvas.getContext("2d")?.drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Картинка не сжалась"))), "image/jpeg", 0.85)
    );
    return { blob, name: file.name.replace(/\.[^.]+$/, "") + ".jpg", mime: "image/jpeg" };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export default function BroadcastComposer({
  rows,
  managers,
  names,
  cities,
  campaigns,
  segments,
  clientTypes,
}: {
  rows: Row[];
  managers: { email: string; name: string }[];
  /** Имена всех сотрудников по почте — у клиента бывает менеджер, которого нет в списке выбора. */
  names: Record<string, string>;
  cities: string[];
  campaigns: string[];
  segments: string[];
  clientTypes: string[];
}) {
  const router = useRouter();
  const [useClients, setUseClients] = useState(true);
  const [useLeads, setUseLeads] = useState(false);
  const [city, setCity] = useState("");
  const [manager, setManager] = useState("");
  const [clientType, setClientType] = useState("");
  const [orders, setOrders] = useState("");
  const [stage, setStage] = useState("");
  const [campaign, setCampaign] = useState("");
  const [segment, setSegment] = useState("");
  const [search, setSearch] = useState("");
  const [unchecked, setUnchecked] = useState<Set<string>>(new Set());
  const [showAll, setShowAll] = useState(false);

  const [title, setTitle] = useState("");
  const [text, setText] = useState("Здравствуйте, {имя}! ");
  const [withOptOut, setWithOptOut] = useState(true);
  const [file, setFile] = useState<{ id: string; name: string; mime: string } | null>(null);
  const [uploading, setUploading] = useState("");
  const [testPhone, setTestPhone] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (r.kind === "client" && !useClients) return false;
      if (r.kind === "lead" && !useLeads) return false;
      if (city && r.city.trim().toLowerCase() !== city.toLowerCase()) return false;
      if (manager === "none" ? !!r.managerEmail : manager && r.managerEmail !== manager) return false;
      if (clientType && r.clientType !== clientType) return false;
      if (r.kind === "client" && orders) {
        if (orders === "never" ? r.daysSinceOrder !== null : r.daysSinceOrder === null || r.daysSinceOrder < Number(orders)) return false;
      }
      if (r.kind === "lead") {
        if (stage && r.stage !== stage) return false;
        if (campaign && r.campaign !== campaign) return false;
        if (segment && r.segment !== segment) return false;
      }
      if (q && !`${r.name} ${r.contactPerson} ${r.waPhone} ${r.city}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [rows, useClients, useLeads, city, manager, clientType, orders, stage, campaign, segment, search]);

  const key = (r: Row) => `${r.kind}:${r.refId}`;
  const sendable = filtered.filter((r) => !r.excluded);
  const chosen = sendable.filter((r) => !unchecked.has(key(r)));
  const excludedCount = filtered.length - sendable.length;
  // Сначала те, кому уйдёт, — исключённые (нет мобильного, повтор) ниже.
  const ordered = useMemo(() => [...filtered].sort((a, b) => Number(!!a.excluded) - Number(!!b.excluded)), [filtered]);
  const shown = showAll ? ordered : ordered.slice(0, 60);
  const managerName = new Map([...Object.entries(names), ...managers.map((m) => [m.email, m.name] as [string, string])]);

  function toggle(r: Row) {
    setUnchecked((prev) => {
      const next = new Set(prev);
      if (next.has(key(r))) next.delete(key(r));
      else next.add(key(r));
      return next;
    });
  }

  async function onFile(f: File | null) {
    setError(null);
    setFile(null);
    if (!f) return;
    if (!["image/jpeg", "image/png", "image/webp", "application/pdf"].includes(f.type)) {
      setError("Можно картинку (JPG, PNG) или PDF");
      return;
    }
    try {
      setUploading("Готовлю файл…");
      const prepared = await shrinkImage(f);
      if (prepared.blob.size > 5 * 1024 * 1024) throw new Error("Файл больше 5 МБ — уменьшите");
      const base64 = (await readAsDataUrl(prepared.blob)).split(",")[1] || "";
      let fileId = "";
      let offset = 0;
      const parts = Math.ceil(base64.length / PART_CHARS);
      for (let i = 0; i < parts; i++) {
        setUploading(`Загружаю ${Math.round((i / parts) * 100)} %…`);
        const r = unwrapValue(
          await uploadFilePartAction({
            fileId,
            name: prepared.name,
            mime: prepared.mime,
            size: prepared.blob.size,
            partOffset: offset,
            data: base64.slice(i * PART_CHARS, (i + 1) * PART_CHARS),
          })
        );
        fileId = r.fileId;
        offset = r.nextOffset;
      }
      setFile({ id: fileId, name: prepared.name, mime: prepared.mime });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Файл не загрузился");
    } finally {
      setUploading("");
    }
  }

  function sendTest() {
    setError(null);
    setNote(null);
    startTransition(async () => {
      try {
        unwrapValue(await sendTestAction({ text, fileId: file?.id ?? "", fileName: file?.name ?? "", phone: testPhone, withOptOut }));
        setNote("Проверочное сообщение ушло — посмотрите, как оно выглядит в WhatsApp.");
      } catch (e) {
        setError(e instanceof Error ? e.message : "Не отправилось");
      }
    });
  }

  function create() {
    setError(null);
    setNote(null);
    const audience = [
      useClients && "клиенты",
      useLeads && "лиды",
      city && city,
      manager && (manager === "none" ? "без менеджера" : managerName.get(manager) ?? manager),
      clientType,
      orders && ORDER_FILTERS.find((o) => o.key === orders)?.label,
      stage && LEAD_STAGES.find((s) => s.key === stage)?.label,
      campaign,
      segment,
    ]
      .filter(Boolean)
      .join(" · ");
    startTransition(async () => {
      try {
        const r = unwrapValue(
          await createBroadcastAction({
            title,
            text,
            fileId: file?.id ?? "",
            fileName: file?.name ?? "",
            withOptOut,
            audience,
            refs: chosen.map((c) => ({ kind: c.kind, refId: c.refId })),
          })
        );
        router.push(`/clients/broadcasts/${r.broadcastId}`);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Не получилось создать рассылку");
      }
    });
  }

  const sample = chosen[0] ?? sendable[0];
  const preview = personalize(text, sample ? greetingName(sample.contactPerson, sample.name) : "Айгуль", withOptOut);
  const select = "input !w-auto !py-1.5 text-sm";

  return (
    <div className="space-y-6">
      <section className="card space-y-4">
        <h2 className="font-display text-lg font-bold">1. Кому</h2>
        <div className="flex flex-wrap gap-4 text-sm">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={useClients} onChange={(e) => setUseClients(e.target.checked)} />
            Клиенты из базы
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={useLeads} onChange={(e) => setUseLeads(e.target.checked)} />
            Лиды
          </label>
        </div>
        <div className="flex flex-wrap gap-2">
          <select className={select} value={city} onChange={(e) => setCity(e.target.value)}>
            <option value="">Все города</option>
            {cities.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <select className={select} value={manager} onChange={(e) => setManager(e.target.value)}>
            <option value="">Все менеджеры</option>
            <option value="none">Без менеджера</option>
            {managers.map((m) => (
              <option key={m.email} value={m.email}>
                {m.name}
              </option>
            ))}
          </select>
          <select className={select} value={clientType} onChange={(e) => setClientType(e.target.value)}>
            <option value="">Любой тип точки</option>
            {clientTypes.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          {useClients && (
            <select className={select} value={orders} onChange={(e) => setOrders(e.target.value)}>
              {ORDER_FILTERS.map((o) => (
                <option key={o.key} value={o.key}>
                  Клиенты: {o.label}
                </option>
              ))}
            </select>
          )}
          {useLeads && (
            <>
              <select className={select} value={stage} onChange={(e) => setStage(e.target.value)}>
                <option value="">Лиды: любая стадия</option>
                {LEAD_STAGES.filter((s) => s.key !== "lost").map((s) => (
                  <option key={s.key} value={s.key}>
                    {s.label}
                  </option>
                ))}
              </select>
              {campaigns.length > 0 && (
                <select className={select} value={campaign} onChange={(e) => setCampaign(e.target.value)}>
                  <option value="">Любой обзвон</option>
                  {campaigns.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              )}
              {segments.length > 0 && (
                <select className={select} value={segment} onChange={(e) => setSegment(e.target.value)}>
                  <option value="">Любая группа</option>
                  {segments.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              )}
            </>
          )}
          <input className="input !w-56 !py-1.5 text-sm" placeholder="Поиск по имени, номеру" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>

        <div className="text-sm">
          <b className="text-lg font-display">{chosen.length}</b> получат сообщение
          {excludedCount > 0 && <span className="text-ink-muted"> · не пойдёт {excludedCount} (нет мобильного, отписались, повтор номера)</span>}
          {sendable.length > 0 && (
            <span className="ml-2 space-x-2">
              <button type="button" className="text-accent hover:underline" onClick={() => setUnchecked(new Set())}>
                отметить всех
              </button>
              <button
                type="button"
                className="text-accent hover:underline"
                onClick={() => setUnchecked(new Set(sendable.map(key)))}
              >
                снять всех
              </button>
            </span>
          )}
        </div>

        {filtered.length > 0 && (
          <div className="max-h-[420px] overflow-y-auto rounded-lg border border-line-hairline">
            <table className="w-full text-sm">
              <tbody>
                {shown.map((r) => (
                  <tr key={key(r)} className={clsx("border-b border-line-hairline last:border-0", r.excluded && "text-ink-muted")}>
                    <td className="w-8 px-2 py-1.5">
                      <input type="checkbox" disabled={!!r.excluded} checked={!r.excluded && !unchecked.has(key(r))} onChange={() => toggle(r)} />
                    </td>
                    <td className="px-2 py-1.5">
                      <div className="truncate max-w-[260px]">{r.name || "Без имени"}</div>
                      <div className="text-xs text-ink-muted">
                        {r.kind === "client" ? "клиент" : "лид"}
                        {r.city && ` · ${r.city}`}
                        {r.managerEmail && ` · ${managerName.get(r.managerEmail) ?? r.managerEmail}`}
                      </div>
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums whitespace-nowrap">
                      {r.excluded ? <span className="text-xs">{r.excluded}</span> : `+${r.waPhone}`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!showAll && filtered.length > shown.length && (
              <button type="button" className="w-full py-2 text-sm text-accent hover:underline" onClick={() => setShowAll(true)}>
                показать ещё {filtered.length - shown.length}
              </button>
            )}
          </div>
        )}
      </section>

      <section className="card space-y-4">
        <h2 className="font-display text-lg font-bold">2. Сообщение</h2>
        <input className="input" placeholder="Название для себя: «Прайс на неделю», «Акция хризантема»" value={title} onChange={(e) => setTitle(e.target.value)} />
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-2">
            <textarea className="input min-h-[180px]" value={text} onChange={(e) => setText(e.target.value)} />
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <button type="button" className="btn-secondary !py-1" onClick={() => setText((t) => `${t}{имя}`)}>
                + {"{имя}"}
              </button>
              <span className="text-ink-muted">подставится имя клиента; нет имени — слово уберётся</span>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={withOptOut} onChange={(e) => setWithOptOut(e.target.checked)} />
              Добавить в конце «{OPT_OUT_LINE}»
            </label>
            <div className="space-y-1 text-sm">
              <div className="label">Картинка или прайс (PDF), до 5 МБ</div>
              <input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={(e) => onFile(e.target.files?.[0] ?? null)} />
              {uploading && <div className="text-ink-muted">{uploading}</div>}
              {file && (
                <div className="text-status-good">
                  Прикреплено: {file.name}{" "}
                  <button type="button" className="text-ink-muted hover:underline" onClick={() => setFile(null)}>
                    убрать
                  </button>
                </div>
              )}
            </div>
          </div>
          <div>
            <div className="label">Так увидит клиент</div>
            <div className="rounded-xl bg-[#e5ddd5] p-4">
              {file && (
                <div className="mb-2 ml-auto w-fit max-w-[85%] rounded-lg bg-white px-3 py-2 text-sm shadow-sm">
                  {file.mime.startsWith("image/") ? "[фото] " : "[PDF] "}
                  {file.name}
                </div>
              )}
              <div className="ml-auto w-fit max-w-[85%] whitespace-pre-wrap rounded-lg bg-[#dcf8c6] px-3 py-2 text-sm shadow-sm">
                {preview || "…"}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="card space-y-3">
        <h2 className="font-display text-lg font-bold">3. Проверить и создать</h2>
        <div className="flex flex-wrap items-end gap-2">
          <label className="space-y-1">
            <span className="label">Отправить пробное на свой номер</span>
            <input className="input !w-56" inputMode="tel" placeholder="8 7XX XXX XX XX" value={testPhone} onChange={(e) => setTestPhone(e.target.value)} />
          </label>
          <button type="button" className="btn-secondary" disabled={pending || !testPhone.trim()} onClick={sendTest}>
            Отправить пробное
          </button>
        </div>
        <p className="text-sm text-ink-secondary">
          Сообщения уходят по одному, с паузой 25–50 секунд, и не больше дневного предела — так WhatsApp реже
          блокирует номер. Отправка идёт, пока открыта страница рассылки.
        </p>
        {error && <p className="text-sm text-status-critical bg-status-critical/10 rounded-lg px-3 py-2">{error}</p>}
        {note && <p className="text-sm text-status-good">{note}</p>}
        <button type="button" className="btn-primary" disabled={pending || !!uploading || chosen.length === 0} onClick={create}>
          {pending ? "Создаю…" : `Создать рассылку · ${chosen.length} получателей`}
        </button>
      </section>
    </div>
  );
}

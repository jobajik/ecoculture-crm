"use client";

import { useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FLOWER_TYPE_LABELS, formatGrade } from "@/lib/constants";
import { unwrapValue } from "@/lib/actionResult";
import { planReturn, type ReturnAccess, type ReturnLineInput, type ReturnOrder } from "@/lib/orderReturn";
import Hint from "./Hint";

export interface ReturnShopOption {
  clientId: string;
  name: string;
  /** «almaty» / «regions» — для группировки в списке. */
  retail: string;
}

interface ReturnResultView {
  outcome: "cancel" | "partial";
  describe: string[];
  shopOrderId: string;
  shopName: string;
  shippedNow: number;
  backToStock: number;
}

/**
 * «Возврат или в магазин» — на странице заявки.
 *
 * Две колонки на строку: «вернуть» (клиент не взял или привёз обратно) и «в
 * магазин» (стебли ушли в нашу точку). Что получится — отмена заявки, новая
 * сумма, возврат в партии, заявка магазину — видно ДО нажатия: считает та же
 * функция, что и сервер (`planReturn`), а запрещает всё равно сервер.
 */
export default function ReturnItems({
  order,
  access,
  shops,
  showMoney,
  save,
}: {
  /** Заявка целиком: без чужих строк не понять, опустеет ли она. */
  order: ReturnOrder;
  access: ReturnAccess;
  shops: ReturnShopOption[];
  /** Складу суммы не показываем: в смешанной заявке там и чужие деньги (грабли 1.1-ter). */
  showMoney: boolean;
  save: (
    orderId: string,
    input: { lines: ReturnLineInput[]; reason: string; shopClientId?: string; shipNow?: boolean }
  ) => Promise<unknown>;
}) {
  const router = useRouter();
  const mine = order.items.filter((i) => access.itemIds.includes(i.itemId));
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Record<string, { back: string; toShop: string }>>({});
  const [shopId, setShopId] = useState("");
  const [shipNow, setShipNow] = useState(true);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState<ReturnResultView | null>(null);

  const lines: ReturnLineInput[] = mine.map((i) => ({
    itemId: i.itemId,
    back: Number(draft[i.itemId]?.back || 0),
    toShop: Number(draft[i.itemId]?.toShop || 0),
  }));
  const moving = lines.some((l) => l.toShop > 0);
  const anything = lines.some((l) => l.back > 0 || l.toShop > 0);

  const plan = useMemo(
    () => planReturn({ order, lines, access, reason: reason.trim().length >= 5 ? reason : "xxxxx", shopChosen: true }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [order, access, JSON.stringify(lines), reason]
  );

  function set(itemId: string, patch: Partial<{ back: string; toShop: string }>) {
    setDraft((prev) => {
      const was = prev[itemId] ?? { back: "", toShop: "" };
      return { ...prev, [itemId]: { ...was, ...patch } };
    });
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    const check = planReturn({ order, lines, access, reason, shopChosen: !moving || !!shopId });
    if (typeof check === "string") {
      setError(check);
      return;
    }
    setBusy(true);
    try {
      const result = unwrapValue(
        await save(order.orderId, {
          lines: lines.filter((l) => l.back > 0 || l.toShop > 0),
          reason,
          shopClientId: moving ? shopId : undefined,
          shipNow: moving && access.canShipNow && shipNow,
        })
      ) as ReturnResultView;
      setDone(result);
      setOpen(false);
      setDraft({});
      setReason("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось сохранить");
    } finally {
      setBusy(false);
    }
  }

  const nf = (n: number) => Math.round(n).toLocaleString("ru-RU");

  // Заявка, в которой ничего не осталось, отменяется — и права на возврат у
  // неё больше нет. Компонент при этом остаётся на странице ради одного:
  // показать, что получилось, и ссылку на заявку магазину.
  if (access.refusal && !done) return null;

  if (!open || access.refusal) {
    return (
      <div className="mb-6">
        {done && (
          <div className="text-sm bg-status-good/10 text-status-good rounded-lg px-3 py-2 mb-2 space-y-0.5">
            <div>
              {done.outcome === "cancel" ? "Заявка отменена. " : "Сохранено. "}
              {done.describe.join("; ").replace(/\.$/, "")}.
            </div>
            {done.shopOrderId && (
              <div>
                В магазин «{done.shopName}» —{" "}
                <Link href={`/orders/${done.shopOrderId}`} className="underline">
                  заявка {done.shopOrderId}
                </Link>
                {done.shippedNow > 0
                  ? `, ${nf(done.shippedNow)} шт. списаны со склада.`
                  : ". Склад отгрузит её — тогда стебли спишутся со склада."}
              </div>
            )}
          </div>
        )}
        {!access.refusal && (
          <button type="button" className="btn-secondary" onClick={() => setOpen(true)}>
            Возврат или в магазин
          </button>
        )}
      </div>
    );
  }

  const almaty = shops.filter((s) => s.retail !== "regions");
  const regions = shops.filter((s) => s.retail === "regions");

  return (
    <form onSubmit={submit} noValidate className="card mb-6 space-y-4">
      <div className="font-medium">
        Возврат или в магазин
        <Hint>
          «Вернуть» — клиент не берёт или привёз обратно. Не отгруженное просто снимается с заявки:
          со склада оно и не списывалось. Отгруженное возвращается в те партии, из которых уехало.
          «В магазин» — стебли ушли в нашу точку: появится заявка магазину, а эта уменьшится. Если
          в заявке ничего не останется, она отменится.
        </Hint>
      </div>

      <div className="space-y-3">
        {mine.map((item) => {
          const unshipped = item.quantity - item.shippedQuantity;
          const maxBack = access.canTakeShipped ? item.quantity : unshipped;
          const d = draft[item.itemId] ?? { back: "", toShop: "" };
          return (
            <div key={item.itemId} className="grid grid-cols-2 sm:grid-cols-4 gap-2 items-end">
              <div className="col-span-2">
                <div className="text-sm font-medium">
                  {FLOWER_TYPE_LABELS[item.flowerType] ?? item.flowerType} {item.variety} · {formatGrade(item.grade)}
                </div>
                <div className="text-xs text-ink-muted">
                  заказано {nf(item.quantity)}
                  {item.shippedQuantity > 0 ? ` · отгружено ${nf(item.shippedQuantity)}` : " · не отгружено"}
                </div>
                <div className="flex gap-3 text-xs mt-0.5">
                  {maxBack > 0 && (
                    <button type="button" className="text-accent hover:underline" onClick={() => set(item.itemId, { back: String(maxBack), toShop: "" })}>
                      вернуть всё
                    </button>
                  )}
                  {access.canMove && unshipped > 0 && (
                    <button type="button" className="text-accent hover:underline" onClick={() => set(item.itemId, { back: "", toShop: String(unshipped) })}>
                      всё в магазин
                    </button>
                  )}
                </div>
              </div>
              <div>
                <label className="label">Вернуть, шт</label>
                <input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  className="input"
                  placeholder="0"
                  value={d.back}
                  onChange={(e) => set(item.itemId, { back: e.target.value })}
                />
              </div>
              {access.canMove ? (
                <div>
                  <label className="label">В магазин, шт</label>
                  <input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    className="input"
                    placeholder="0"
                    value={d.toShop}
                    onChange={(e) => set(item.itemId, { toShop: e.target.value })}
                  />
                </div>
              ) : (
                <div />
              )}
            </div>
          );
        })}
      </div>

      {moving && (
        <div className="grid sm:grid-cols-2 gap-3 items-end">
          <div>
            <label className="label">Какой магазин *</label>
            {shops.length > 0 ? (
              <select className="input" value={shopId} onChange={(e) => setShopId(e.target.value)}>
                <option value="">— выберите —</option>
                {almaty.length > 0 && (
                  <optgroup label="Алматы">
                    {almaty.map((s) => (
                      <option key={s.clientId} value={s.clientId}>
                        {s.name}
                      </option>
                    ))}
                  </optgroup>
                )}
                {regions.length > 0 && (
                  <optgroup label="Регионы">
                    {regions.map((s) => (
                      <option key={s.clientId} value={s.clientId}>
                        {s.name}
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
            ) : (
              <p className="text-sm text-[#8a5a00]">Наших магазинов в базе нет — их заводит РОП в «Клиентах».</p>
            )}
            <p className="text-xs text-ink-muted mt-1">Нет нужной точки — её заводит РОП или администратор в «Клиентах».</p>
          </div>
          {access.canShipNow && (
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-1" checked={shipNow} onChange={(e) => setShipNow(e.target.checked)} />
              <span>
                Цветок уже увезли — списать со склада сейчас
                <span className="block text-xs text-ink-muted">от старых срезок к свежим</span>
              </span>
            </label>
          )}
        </div>
      )}

      <div>
        <label className="label">Причина *</label>
        <input
          className="input"
          value={reason}
          placeholder="Клиент не оплатил"
          onChange={(e) => setReason(e.target.value)}
        />
      </div>

      {anything && typeof plan !== "string" && (
        <ul className="text-sm text-ink-secondary space-y-0.5">
          {plan.outcome === "cancel" ? (
            <li className="text-[#8a5a00]">В заявке ничего не останется — она будет отменена.</li>
          ) : (
            showMoney && (
              <li>
                Сумма заявки: {nf(plan.totalBefore)} → <b>{nf(plan.totalAfter)} ₸</b>
              </li>
            )
          )}
          {plan.backToStock > 0 ? (
            <li>{nf(plan.backToStock)} шт. вернутся в партии, из которых уехали.</li>
          ) : (
            lines.some((l) => l.back > 0) && <li>Возвращаемое не отгружалось — остаток склада не изменится.</li>
          )}
          {moving &&
            (access.canShipNow && shipNow ? (
              <li>Появится заявка магазину, стебли сразу спишутся со склада.</li>
            ) : (
              <li>Появится заявка магазину — склад отгрузит её, тогда стебли спишутся со склада.</li>
            ))}
          {showMoney && plan.outcome === "partial" && order.paidAmount - plan.totalAfter > 1 && (
            <li className="text-[#8a5a00]">
              По заявке появится переплата {nf(order.paidAmount - plan.totalAfter)} ₸ — её вернёт бухгалтер.
            </li>
          )}
        </ul>
      )}
      {anything && typeof plan === "string" && <p className="text-sm text-[#8a5a00]">{plan}</p>}

      {error && (
        <p className="text-sm text-status-critical bg-status-critical/10 rounded-lg px-3 py-2">{error}</p>
      )}

      <div className="flex gap-2">
        <button type="submit" className="btn-primary disabled:opacity-50" disabled={busy || !anything}>
          {busy ? "Сохраняю…" : "Оформить"}
        </button>
        <button type="button" className="btn" onClick={() => setOpen(false)}>
          Отмена
        </button>
      </div>
    </form>
  );
}

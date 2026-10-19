"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createWriteoffAction, fixBatchAction } from "@/app/warehouse/actions";
import { FLOWER_TYPE_LABELS, formatGrade, getGradesFor, gradeColumnLabel } from "@/lib/constants";
import { DEFAULT_WRITEOFF_REASON } from "@/lib/writeoffPlan";
import { WRITEOFF_REASONS } from "@/lib/writeoffReasons";
import { formatDay } from "@/lib/formatDate";
import type { BatchStorageInfo } from "@/lib/shelfLife";
import StorageStatusBadge from "./StorageStatusBadge";
import Pager, { pageSlice } from "./Pager";
import Chips, { type ChipItem } from "./Chips";
import { unwrap } from "@/lib/actionResult";

/**
 * `fix` — можно исправлять ошибочную приёмку (зав. складом и админ): справочник сортов по цветку.
 * `duplicates` — партии, похожие на повтор приёмки (`likelyDuplicates`).
 */
export default function BatchesList({
  infos,
  fix = null,
  duplicates = [],
}: {
  infos: BatchStorageInfo[];
  fix?: { varieties: Record<string, string[]> } | null;
  duplicates?: string[];
}) {
  const router = useRouter();
  const dupSet = useMemo(() => new Set(duplicates), [duplicates]);
  const [openBatchId, setOpenBatchId] = useState<string | null>(null);
  // Отбор кнопками вместо галочки «только с остатком» (новый вид, 19.10.2026): сразу видно, сколько просрочено.
  const [filter, setFilter] = useState("active");

  const [page, setPage] = useState(0);
  const [search, setSearch] = useState("");
  const query = search.trim().toLowerCase();

  const visible = useMemo(
    () =>
      infos
        .filter((i) => matchesFilter(i, filter, dupSet))
        .filter((i) => {
          if (!query) return true;
          const b = i.batch;
          return [FLOWER_TYPE_LABELS[b.flowerType] ?? "", b.variety, b.grade, formatGrade(b.grade), b.batchId]
            .join(" ")
            .toLowerCase()
            .includes(query);
        }),
    [infos, filter, query, dupSet]
  );
  const countOf = (f: string) => infos.filter((i) => matchesFilter(i, f, dupSet)).length;
  const chipItems: ChipItem[] = [
    { value: "active", label: "С остатком", count: countOf("active") },
    { value: "critical", label: "Дольше срока", count: countOf("critical"), alarm: true },
    { value: "warning", label: "Скоро срок", count: countOf("warning") },
    { value: "ok", label: "В сроке", count: countOf("ok") },
    ...(dupSet.size > 0 ? [{ value: "dup", label: "Похоже на повтор", count: countOf("dup"), alarm: true }] : []),
    { value: "all", label: "Все, с пустыми", count: infos.length },
  ];

  // Партий бывает под две сотни: показываем страницами, чтобы список помещался в экран (новый вид, 19.10.2026).
  // Список уже отсортирован — сверху то, что дольше лежит.
  useEffect(() => setPage(0), [filter, query]);
  const shown = pageSlice(visible, page);

  return (
    <div>
      <div className="card !p-0 overflow-hidden">
      <div className="flex flex-col xl:flex-row xl:items-center gap-3 px-4 py-3 border-b border-line-hairline">
        <Chips value={filter} onChange={setFilter} items={chipItems} />
        <input
          type="search"
          className="input !w-auto xl:ml-auto xl:w-[260px] min-w-0"
          placeholder="Сорт, длина, код партии"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      <datalist id="batch-writeoff-reasons">
        {WRITEOFF_REASONS.map((r) => (
          <option key={r} value={r} />
        ))}
      </datalist>

      <div className="table-scroll table-cards">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-ink-muted border-b border-line-hairline bg-surface-plane/60">
              <th className="px-4 py-3 font-medium">Тип / сорт</th>
              <th className="px-4 py-3 font-medium">Код партии</th>
              <th className="px-4 py-3 font-medium">Срезка</th>
              <th className="px-4 py-3 font-medium">Лежит</th>
              <th className="px-4 py-3 font-medium">Остаток</th>
              <th className="px-4 py-3 font-medium">Статус</th>
              <th className="px-4 py-3 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {shown.map((info) => (
              <BatchRow
                key={info.batch.batchId}
                info={info}
                fix={fix}
                duplicate={dupSet.has(info.batch.batchId)}
                openPanel={openBatchId?.startsWith(`${info.batch.batchId}|`) ? (openBatchId.split("|")[1] as Panel) : null}
                onToggle={(panel) =>
                  setOpenBatchId((cur) => {
                    const key = `${info.batch.batchId}|${panel}`;
                    return cur === key ? null : key;
                  })
                }
                onDone={() => {
                  setOpenBatchId(null);
                  router.refresh();
                }}
              />
            ))}
            {visible.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-ink-muted">
                  {query || filter !== "active" ? "Ничего не нашлось" : "Партий нет"}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <Pager total={visible.length} page={page} onPage={setPage} what="партий" />
      </div>
    </div>
  );
}

type Panel = "writeoff" | "fix";

function BatchRow({
  info,
  fix,
  duplicate,
  openPanel,
  onToggle,
  onDone,
}: {
  info: BatchStorageInfo;
  fix: { varieties: Record<string, string[]> } | null;
  duplicate: boolean;
  openPanel: Panel | null;
  onToggle: (panel: Panel) => void;
  onDone: () => void;
}) {
  const { batch } = info;
  const isOpen = openPanel === "writeoff";
  // Исправлять можно только нетронутую партию; журналы сервер проверит сам.
  const canFix = Boolean(fix) && !batch.store && batch.quantityIn > 0 && batch.quantityRemaining === batch.quantityIn;
  const [quantity, setQuantity] = useState("");
  const [reason, setReason] = useState(DEFAULT_WRITEOFF_REASON);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleWriteoff() {
    setError(null);
    const qty = Number(quantity);
    if (!qty || qty <= 0) return setError("Укажите количество");
    if (qty > batch.quantityRemaining) return setError("Больше, чем есть в остатке");

    setSubmitting(true);
    try {
      unwrap(await createWriteoffAction({ batchId: batch.batchId, quantity: qty, reason }));
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось списать");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <tr className="border-b border-line-hairline last:border-0 hover:bg-surface-plane">
        <td className="px-4 py-3">
          <div className="font-medium">
            {FLOWER_TYPE_LABELS[batch.flowerType]} {batch.variety}
          </div>
          <div className="text-xs text-ink-muted">{formatGrade(batch.grade)}</div>
          {duplicate && <div className="text-xs text-status-warning">похоже на повтор приёмки</div>}
        </td>
        {/* Код партии — служебный: он нужен, чтобы сверить строку с ярлыком на
            ведре, и не должен спорить глазами с сортом и сроком. */}
        <td data-label="Код" className="px-4 py-3 text-[11px] text-ink-muted font-mono whitespace-nowrap">
          {batch.batchId}
        </td>
        <td data-label="Срезка" className="px-4 py-3 text-ink-secondary">
          {batch.harvestDate ? formatDay(batch.harvestDate) : "—"}
        </td>
        <td data-label="Лежит" className="px-4 py-3 text-ink-secondary">
          {info.daysInStorage} из {info.maxDays} дн.
        </td>
        <td data-label="Остаток" className="px-4 py-3 tabular-nums">
          {batch.quantityRemaining.toLocaleString("ru-RU")} / {batch.quantityIn.toLocaleString("ru-RU")}
        </td>
        <td data-label="Статус" className="px-4 py-3">
          <StorageStatusBadge status={info.status} />
        </td>
        <td className="px-4 py-3 text-right whitespace-nowrap">
          {canFix && (
            <button onClick={() => onToggle("fix")} className="btn-secondary !py-1 mr-2">
              {openPanel === "fix" ? "Отмена" : "Исправить"}
            </button>
          )}
          {batch.quantityRemaining > 0 && (
            <button onClick={() => onToggle("writeoff")} className="btn-secondary !py-1">
              {isOpen ? "Отмена" : "Списать"}
            </button>
          )}
        </td>
      </tr>
      {isOpen && (
        <tr className="bg-surface-plane">
          <td colSpan={7} className="px-4 py-3">
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label className="label">Количество</label>
                <input
                  type="number"
                  min={1}
                  max={batch.quantityRemaining}
                  inputMode="numeric"
                  className="input !w-32"
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                />
              </div>
              <div className="flex-1 min-w-[200px]">
                <label className="label">Причина</label>
                <input
                  className="input"
                  list="batch-writeoff-reasons"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              </div>
              <button onClick={handleWriteoff} disabled={submitting} className="btn-primary">
                {submitting ? "Списание…" : "Списать"}
              </button>
            </div>
            {error && <div className="text-sm text-status-critical mt-2">{error}</div>}
          </td>
        </tr>
      )}
      {openPanel === "fix" && fix && (
        <tr className="bg-surface-plane">
          <td colSpan={7} className="px-4 py-3">
            <BatchFixForm info={info} varieties={fix.varieties[batch.flowerType] ?? []} onDone={onDone} />
          </td>
        </tr>
      )}
    </>
  );
}

/** Исправить ошибочную приёмку: поправить партию или удалить её совсем (`batchFix.ts`). */
function BatchFixForm({
  info,
  varieties,
  onDone,
}: {
  info: BatchStorageInfo;
  varieties: string[];
  onDone: () => void;
}) {
  const { batch } = info;
  const [variety, setVariety] = useState(batch.variety);
  const [grade, setGrade] = useState(batch.grade);
  const [quantity, setQuantity] = useState(String(batch.quantityIn));
  const [harvestDate, setHarvestDate] = useState(batch.harvestDate);
  const [reason, setReason] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const varietyOptions = varieties.includes(batch.variety) ? varieties : [batch.variety, ...varieties];

  async function run(mode: "edit" | "delete") {
    setError(null);
    if (!reason.trim()) return setError("Напишите, что не так с приёмкой");
    setBusy(true);
    try {
      unwrap(
        await fixBatchAction({
          batchId: batch.batchId,
          mode,
          reason: reason.trim(),
          variety,
          grade,
          quantity: Number(quantity),
          harvestDate,
        })
      );
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось исправить");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[180px]">
          <label className="label">Сорт</label>
          <select className="input" value={variety} onChange={(e) => setVariety(e.target.value)}>
            {varietyOptions.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">{gradeColumnLabel(batch.flowerType)}</label>
          <select className="input" value={grade} onChange={(e) => setGrade(e.target.value)}>
            {getGradesFor(batch.flowerType).map((g) => (
              <option key={g} value={g}>
                {formatGrade(g)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Количество</label>
          <input
            type="number"
            min={1}
            inputMode="numeric"
            className="input !w-28"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
          />
        </div>
        <div>
          <label className="label">Срезка</label>
          <input type="date" className="input" value={harvestDate} onChange={(e) => setHarvestDate(e.target.value)} />
        </div>
        <div className="flex-1 min-w-[200px]">
          <label className="label">Что не так</label>
          <input
            className="input"
            placeholder="например: внесли дважды"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3 mt-3">
        <button onClick={() => run("edit")} disabled={busy} className="btn-primary">
          {busy ? "Сохраняю…" : "Сохранить"}
        </button>
        {confirmDelete ? (
          <>
            <span className="text-sm">Удалить партию {batch.quantityIn} шт. совсем?</span>
            <button onClick={() => run("delete")} disabled={busy} className="btn-secondary !text-status-critical">
              Да, удалить
            </button>
            <button onClick={() => setConfirmDelete(false)} disabled={busy} className="btn-secondary">
              Нет
            </button>
          </>
        ) : (
          <button onClick={() => setConfirmDelete(true)} disabled={busy} className="btn-secondary">
            Удалить партию
          </button>
        )}
      </div>
      {error && <div className="text-sm text-status-critical mt-2">{error}</div>}
    </div>
  );
}

/** Отбор партий кнопкой: «С остатком» — всё, что лежит; статусы — только среди лежащего. */
function matchesFilter(i: BatchStorageInfo, filter: string, dup: Set<string>): boolean {
  const left = i.batch.quantityRemaining > 0;
  switch (filter) {
    case "all":
      return true;
    case "dup":
      return dup.has(i.batch.batchId);
    case "critical":
    case "warning":
    case "ok":
      return left && i.status === filter;
    default:
      return left;
  }
}

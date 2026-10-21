"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { unwrapValue } from "@/lib/actionResult";
import { LEAD_LOST_REASONS, LEAD_STAGES, stageLabel } from "@/lib/leads";
import { BULK_AI_MAX, BULK_MAX, BULK_MODE_LABELS, type BulkMode } from "@/lib/leadsBulk";
import { bulkAssignAction, bulkHandoverAction, bulkMessageAction, bulkStageAction } from "@/app/clients/leads/actions";

/**
 * Полоска массовых действий над выделенными лидами (доска и список) и её окна. Действия идут на сервере одной
 * записью; что не вышло у конкретного лида — в отчёте словами, остальное делается. «Написать» собирает рассылку
 * и даёт ссылку на неё — отправка идёт с паузами, как у любой рассылки.
 */

export type BulkDialog = { kind: "message" } | { kind: "stage"; stage?: string } | { kind: "assign" } | { kind: "handover" };

interface Report {
  title: string;
  lines: string[];
  links?: { href: string; label: string }[];
}

export default function LeadsBulkBar({
  selected,
  names,
  canManage,
  leadgen,
  managers,
  today,
  dialog,
  setDialog,
  onClear,
}: {
  selected: string[];
  /** Имя по номеру лида — для отчёта. */
  names: Map<string, string>;
  canManage: boolean;
  leadgen: boolean;
  managers: { email: string; name: string }[];
  today: string;
  dialog: BulkDialog | null;
  setDialog: (d: BulkDialog | null) => void;
  onClear: () => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [report, setReport] = useState<Report | null>(null);

  // Окно «написать»
  const [mode, setMode] = useState<BulkMode>("ai");
  const [text, setText] = useState("");
  const [withPhoto, setWithPhoto] = useState(true);
  // Окно «стадия»
  const [stage, setStage] = useState("contact");
  const [lostReason, setLostReason] = useState<string>(LEAD_LOST_REASONS[0]);
  const [nextTouchAt, setNextTouchAt] = useState("");
  const [comment, setComment] = useState("");
  // Окна «менеджер» / «передать»
  const [manager, setManager] = useState(managers[0]?.email ?? "");
  const [handComment, setHandComment] = useState("");

  useEffect(() => {
    if (dialog?.kind === "stage" && dialog.stage) setStage(dialog.stage);
    if (dialog) setError("");
  }, [dialog]);

  const count = selected.length;
  if (count === 0 && !report) return null;

  const run = async (fn: () => Promise<Report>) => {
    setBusy(true);
    setError("");
    try {
      const r = await fn();
      setReport(r);
      setDialog(null);
      onClear();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };
  const refusedLines = (refused: { name: string; why: string }[]) => refused.slice(0, 12).map((r) => `${r.name} — ${r.why}`).concat(refused.length > 12 ? [`и ещё ${refused.length - 12}`] : []);

  const doStage = () =>
    run(async () => {
      const r = unwrapValue(await bulkStageAction(selected, { stage, lostReason: stage === "lost" ? lostReason : "", nextTouchAt, comment }));
      return { title: `${stage === "lost" ? "Отказ" : `Стадия «${stageLabel(stage)}»`}: ${r.done} из ${count}`, lines: refusedLines(r.refused) };
    });
  const doAssign = () =>
    run(async () => {
      const r = unwrapValue(await bulkAssignAction(selected, manager));
      return { title: `${manager ? "Назначено" : "Сделано ничьими"}: ${r.done} из ${count}`, lines: refusedLines(r.refused) };
    });
  const doHandover = () =>
    run(async () => {
      const r = unwrapValue(await bulkHandoverAction(selected, { managerEmail: manager, comment: handComment }));
      return { title: `Передано: ${r.done} из ${count}`, lines: refusedLines(r.refused) };
    });
  const doMessage = () =>
    run(async () => {
      const r = unwrapValue(await bulkMessageAction(selected, { mode, text, withPhoto }));
      const total = r.created.reduce((n, c) => n + c.count, 0);
      return {
        title: total > 0 ? `В очередь на отправку: ${total} из ${count}${r.aiCount ? ` · ИИ написал ${r.aiCount}` : ""}` : "Отправлять некому",
        lines: [
          ...(total > 0 ? ["Уходит с паузами, как рассылка: по 40–120 секунд между сообщениями, в рабочие часы. На ответы отвечает ИИ-помощник."] : []),
          ...refusedLines(r.skipped),
        ],
        links: r.created.map((c) => ({ href: `/clients/broadcasts/${c.broadcastId}`, label: `${c.title} · ${c.count}` })),
      };
    });

  const selectedNames = selected.slice(0, 3).map((id) => names.get(id) || id);

  return (
    <>
      {count > 0 && (
        <div className="no-print fixed inset-x-0 lg:left-[248px] bottom-4 sm:bottom-5 z-30 flex justify-center px-3 pointer-events-none">
          <div className="pointer-events-auto flex flex-wrap items-center justify-center gap-2 rounded-xl border border-section-leads/40 bg-surface px-3 py-2 shadow-card-hover max-w-full">
            <span className="text-sm text-ink-secondary tabular-nums mr-1">
              Выделено <b className="text-ink-primary">{count}</b>
            </span>
            <button type="button" className="btn-primary !py-1.5 !px-3" onClick={() => setDialog({ kind: "message" })}>
              Написать
            </button>
            <button type="button" className="btn-secondary !py-1.5 !px-3" onClick={() => setDialog({ kind: "stage" })}>
              Стадия
            </button>
            {(canManage || leadgen) && (
              <button type="button" className="btn-secondary !py-1.5 !px-3" onClick={() => setDialog({ kind: "handover" })}>
                Передать
              </button>
            )}
            {canManage && (
              <button type="button" className="btn-secondary !py-1.5 !px-3" onClick={() => setDialog({ kind: "assign" })}>
                Менеджер
              </button>
            )}
            <button type="button" className="btn-secondary !py-1.5 !px-3 text-status-critical" onClick={() => setDialog({ kind: "stage", stage: "lost" })}>
              Отказ
            </button>
            <button type="button" className="text-sm text-ink-secondary hover:text-ink-primary px-2 py-1" onClick={onClear}>
              Снять
            </button>
          </div>
        </div>
      )}

      {dialog && (
        <Modal onClose={() => !busy && setDialog(null)} title={dialogTitle(dialog)}>
          <p className="text-xs text-ink-muted mb-3">
            {count} {plural(count)}: {selectedNames.join(", ")}
            {count > 3 ? ` и ещё ${count - 3}` : ""}
          </p>

          {dialog.kind === "message" && (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-1.5">
                {(Object.keys(BULK_MODE_LABELS) as BulkMode[]).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setMode(m)}
                    className={clsx("rounded-lg border px-3 py-1.5 text-sm", mode === m ? "border-section-leads bg-section-leads-soft text-section-leads font-semibold" : "border-line-hairline text-ink-secondary hover:bg-surface-plane")}
                  >
                    {BULK_MODE_LABELS[m]}
                  </button>
                ))}
              </div>
              <p className="text-xs text-ink-secondary">
                {mode === "ai" && `ИИ прочитает переписку каждого и напишет ему своё короткое сообщение с предложением (не больше ${BULK_AI_MAX} за раз). Без переписки — текст с ценами со склада.`}
                {mode === "offer" && "Приветствие, две ходовые позиции с ценами со склада (названная в переписке — первой) и вопрос."}
                {mode === "text" && "Ваш текст каждому; {имя} подставится из карточки."}
              </p>
              {mode === "text" && <textarea className="input min-h-[110px]" value={text} onChange={(e) => setText(e.target.value)} placeholder="Здравствуйте, {имя}! …" />}
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" className="w-4 h-4 accent-section-leads" checked={withPhoto} onChange={(e) => setWithPhoto(e.target.checked)} />
                С фото из ротации (сорт — по тексту)
              </label>
              <p className="text-xs text-ink-muted">С того номера, где шла переписка (Земфира, менеджер, рабочий). Уходит с паузами, как рассылка; на ответы отвечает ИИ-помощник. Не больше {BULK_MAX} за раз.</p>
              <Footer busy={busy} error={error} onCancel={() => setDialog(null)} onOk={doMessage} okLabel={busy ? "Готовлю…" : "Отправить"} />
            </div>
          )}

          {dialog.kind === "stage" && (
            <div className="space-y-3">
              <label className="block text-sm">
                <span className="text-xs text-ink-muted">Стадия</span>
                <select className="input mt-1" value={stage} onChange={(e) => setStage(e.target.value)}>
                  {LEAD_STAGES.map((s) => (
                    <option key={s.key} value={s.key}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </label>
              {stage === "lost" ? (
                <label className="block text-sm">
                  <span className="text-xs text-ink-muted">Причина отказа</span>
                  <select className="input mt-1" value={lostReason} onChange={(e) => setLostReason(e.target.value)}>
                    {LEAD_LOST_REASONS.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <label className="block text-sm">
                  <span className="text-xs text-ink-muted">Следующее касание (пусто — послезавтра)</span>
                  <input type="date" className="input mt-1" value={nextTouchAt} min={today} onChange={(e) => setNextTouchAt(e.target.value)} />
                </label>
              )}
              <label className="block text-sm">
                <span className="text-xs text-ink-muted">Комментарий к касанию (пусто — «Перенесён на доске лидов»)</span>
                <input className="input mt-1" value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Что сделали или о чём договорились" />
              </label>
              {(stage === "trial" || stage === "regular") && <p className="text-xs text-[#8a5a00]">На эти стадии встанут только лиды, заведённые клиентом.</p>}
              <Footer busy={busy} error={error} onCancel={() => setDialog(null)} onOk={doStage} okLabel={stage === "lost" ? "Закрыть отказом" : "Перенести"} danger={stage === "lost"} />
            </div>
          )}

          {(dialog.kind === "assign" || dialog.kind === "handover") && (
            <div className="space-y-3">
              <label className="block text-sm">
                <span className="text-xs text-ink-muted">Менеджер</span>
                <select className="input mt-1" value={manager} onChange={(e) => setManager(e.target.value)}>
                  {dialog.kind === "assign" && <option value="">— ничей —</option>}
                  {managers.map((m) => (
                    <option key={m.email} value={m.email}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </label>
              {dialog.kind === "handover" && (
                <label className="block text-sm">
                  <span className="text-xs text-ink-muted">Что клиентам нужно — менеджеру (обязательно)</span>
                  <input className="input mt-1" value={handComment} onChange={(e) => setHandComment(e.target.value)} placeholder="Хризантема 4 кат., по 200–500 шт., Алматы" />
                </label>
              )}
              <Footer busy={busy} error={error} onCancel={() => setDialog(null)} onOk={dialog.kind === "assign" ? doAssign : doHandover} okLabel={dialog.kind === "assign" ? "Назначить" : "Передать"} />
            </div>
          )}
        </Modal>
      )}

      {report && (
        <Modal onClose={() => setReport(null)} title={report.title}>
          <div className="space-y-2 text-sm">
            {report.lines.map((l, i) => (
              <p key={i} className="text-ink-secondary">
                {l}
              </p>
            ))}
            {report.links?.map((l) => (
              <p key={l.href}>
                <Link href={l.href} className="text-section-leads hover:underline">
                  {l.label} →
                </Link>
              </p>
            ))}
            {report.lines.length === 0 && !report.links?.length && <p className="text-ink-secondary">Готово.</p>}
          </div>
          <div className="flex justify-end mt-4">
            <button type="button" className="btn-primary !py-1.5" onClick={() => setReport(null)}>
              Понятно
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}

function dialogTitle(d: BulkDialog): string {
  if (d.kind === "message") return "Написать выделенным";
  if (d.kind === "stage") return d.stage === "lost" ? "Закрыть отказом" : "Сменить стадию";
  if (d.kind === "assign") return "Назначить менеджера";
  return "Передать менеджеру";
}

const plural = (n: number) => (n % 10 === 1 && n % 100 !== 11 ? "лид" : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? "лида" : "лидов");

function Footer({ busy, error, onCancel, onOk, okLabel, danger }: { busy: boolean; error: string; onCancel: () => void; onOk: () => void; okLabel: string; danger?: boolean }) {
  return (
    <div className="pt-1">
      {error && <p className="text-sm text-status-critical mb-2">{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" className="btn !py-1.5 text-ink-secondary" onClick={onCancel} disabled={busy}>
          Отмена
        </button>
        <button type="button" className={clsx("!py-1.5 disabled:opacity-50", danger ? "btn-secondary text-status-critical" : "btn-primary")} onClick={onOk} disabled={busy}>
          {busy ? "Делаю…" : okLabel}
        </button>
      </div>
    </div>
  );
}

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-40 flex items-end sm:items-center justify-center bg-black/30 p-3" onClick={onClose} role="dialog" aria-modal="true" aria-label={title}>
      <div className="card w-full max-w-md max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <h2 className="font-display text-[17px] font-bold mb-2">{title}</h2>
        {children}
      </div>
    </div>
  );
}

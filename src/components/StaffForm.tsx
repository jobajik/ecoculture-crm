"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { FARMS, FARM_LABELS, ROLES, ROLE_LABELS, isFarmBoundRole } from "@/lib/constants";
import { staffSaveRefusal, type StaffDraft } from "@/lib/staffRules";
import { unwrapValue } from "@/lib/actionResult";
import type { AppUser } from "@/lib/types";

/**
 * Сотрудники: завести, сменить роль, закрыть доступ.
 *
 * Форма открывается уже заполненной, когда нажали «Изменить» у строки, и
 * пустой, когда заводят нового. Отдельной страницы у неё нет намеренно: список
 * сотрудников короткий, и уходить с него ради двух полей — лишний шаг.
 *
 * Проверка здесь — ТА ЖЕ функция, что и на сервере (`staffSaveRefusal`), и
 * зовётся она ради скорости ответа, а не вместо серверной. Запрещает сервер
 * (грабли 1.11); одинаковый текст в обоих местах нужен, чтобы человек не гадал,
 * почему браузер сказал одно, а сервер другое.
 */
const ROLE_CODES: string[] = Object.values(ROLES);
const FARM_CODES: string[] = Object.values(FARMS);

const EMPTY: StaffDraft = { email: "", name: "", role: "", farm: "", active: true };

export default function StaffForm({
  users,
  actorEmail,
  save,
}: {
  users: AppUser[];
  actorEmail: string;
  save: (draft: StaffDraft) => Promise<unknown>;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<StaffDraft>(EMPTY);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");

  const me = (actorEmail || "").trim().toLowerCase();
  const existing = users.find((u) => u.email === draft.email.trim().toLowerCase()) ?? null;

  function edit(user: AppUser) {
    setDraft({
      email: user.email,
      name: user.name,
      role: user.role,
      farm: user.farm ?? "",
      active: user.active,
    });
    setOpen(true);
    setError("");
    setDone("");
  }

  function startNew() {
    setDraft(EMPTY);
    setOpen(true);
    setError("");
    setDone("");
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setDone("");

    // Ранняя подсказка теми же словами, что скажет сервер.
    const refusal = staffSaveRefusal({ actorRole: ROLES.ADMIN, actorEmail: me, users }, draft);
    if (refusal) {
      setError(refusal);
      return;
    }

    setBusy(true);
    try {
      const result = unwrapValue(await save(draft)) as { created: boolean; summary: string };
      setDone(
        result.created
          ? `Сотрудник заведён: ${draft.name}.`
          : `Сохранено: ${result.summary}.`
      );
      setOpen(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось сохранить");
    } finally {
      setBusy(false);
    }
  }

  const needsFarm = isFarmBoundRole(draft.role);
  const isMe = existing?.email === me;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-medium">Сотрудники</h3>
        <button type="button" className="btn-primary" onClick={startNew}>
          + Новый сотрудник
        </button>
      </div>

      {done && (
        <p className="text-sm bg-status-good/10 text-status-good rounded-lg px-3 py-2">{done}</p>
      )}

      <div className="card !p-0 table-scroll table-cards">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-ink-secondary border-b border-line-hairline">
              <th className="px-4 py-3 font-medium">Имя</th>
              <th className="px-4 py-3 font-medium">Почта</th>
              <th className="px-4 py-3 font-medium">Роль</th>
              <th className="px-4 py-3 font-medium">Производство</th>
              <th className="px-4 py-3 font-medium">Доступ</th>
              <th className="px-4 py-3 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.email} className="border-b border-line-hairline last:border-0">
                <td data-label="Имя" className="px-4 py-2.5 font-medium">
                  {u.name || <span className="text-status-critical">имя не заполнено</span>}
                  {u.email === me && <span className="text-xs text-ink-muted"> · вы</span>}
                </td>
                <td data-label="Почта" className="px-4 py-2.5 text-ink-secondary">{u.email}</td>
                <td data-label="Роль" className="px-4 py-2.5">{ROLE_LABELS[u.role] ?? u.role ?? "—"}</td>
                <td data-label="Производство" className="px-4 py-2.5 text-ink-secondary">
                  {u.farm ? FARM_LABELS[u.farm] ?? u.farm : "—"}
                </td>
                <td data-label="Доступ" className="px-4 py-2.5">
                  <span className={u.active ? "text-status-good" : "text-ink-muted"}>
                    {u.active ? "открыт" : "закрыт"}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-right">
                  <button
                    type="button"
                    className="text-series-1 hover:underline"
                    onClick={() => edit(u)}
                  >
                    изменить
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {open && (
        <form onSubmit={submit} className="card space-y-3">
          <div className="font-medium">
            {existing ? `Изменить: ${existing.name || existing.email}` : "Новый сотрудник"}
          </div>

          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <label className="label">Рабочая почта Google *</label>
              <input
                className="input"
                value={draft.email}
                disabled={Boolean(existing)}
                placeholder="имя@ecoculture.kz"
                onChange={(e) => setDraft({ ...draft, email: e.target.value })}
              />
              {/* Почта — ключ строки. Меняя её у существующего, мы завели бы
                  второго человека вместо переименования первого. */}
              <p className="text-xs text-ink-muted mt-1">
                {existing
                  ? "Почту менять нельзя."
                  : "Google-почта для входа."}
              </p>
            </div>
            <div>
              <label className="label">Имя и фамилия *</label>
              <input
                className="input"
                value={draft.name}
                placeholder="Разия Ахметова"
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
            </div>
          </div>

          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <label className="label">Роль *</label>
              <select
                className="input"
                value={draft.role}
                disabled={isMe}
                onChange={(e) => setDraft({ ...draft, role: e.target.value })}
              >
                <option value="">— выберите —</option>
                {ROLE_CODES.map((code) => (
                  <option key={code} value={code}>
                    {ROLE_LABELS[code] ?? code}
                  </option>
                ))}
              </select>
              {isMe && (
                <p className="text-xs text-ink-muted mt-1">
                  Свою роль изменить нельзя.
                </p>
              )}
            </div>
            <div>
              <label className="label">
                Производство {needsFarm ? "*" : <span className="font-normal">— этой роли не нужно</span>}
              </label>
              <select
                className="input"
                value={draft.farm}
                disabled={!needsFarm}
                onChange={(e) => setDraft({ ...draft, farm: e.target.value })}
              >
                <option value="">— не задано —</option>
                {FARM_CODES.map((code) => (
                  <option key={code} value={code}>
                    {FARM_LABELS[code] ?? code}
                  </option>
                ))}
              </select>
              {needsFarm && (
                <p className="text-xs text-ink-muted mt-1">
                  Без производства человек не увидит ни одной партии.
                </p>
              )}
            </div>
          </div>

          <label className={clsx("flex items-center gap-2 text-sm", isMe && "opacity-60")}>
            <input
              type="checkbox"
              checked={draft.active}
              disabled={isMe}
              onChange={(e) => setDraft({ ...draft, active: e.target.checked })}
            />
            Доступ открыт
            <span className="text-ink-muted">
              — снимите, если человек уволился
            </span>
          </label>

          {error && (
            <p className="text-sm text-status-critical bg-status-critical/10 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          <div className="flex gap-2">
            <button type="submit" className="btn-primary disabled:opacity-50" disabled={busy}>
              {busy ? "Сохраняю…" : "Сохранить"}
            </button>
            <button type="button" className="btn" onClick={() => setOpen(false)}>
              Отмена
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

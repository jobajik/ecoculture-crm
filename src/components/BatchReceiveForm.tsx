"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { createBatchAction } from "@/app/warehouse/actions";
import { FLOWER_TYPE_LABELS, GRADE_LABELS, formatGrade, getGradesFor } from "@/lib/constants";
import type { FlowerType } from "@/lib/constants";

type FlowerTypeKey = FlowerType;

export default function BatchReceiveForm({
  varieties,
  allowedTypes,
}: {
  varieties: Record<string, string[]>;
  /** Типы цветка своего производства — остальные зав. складом принимать не может. */
  allowedTypes: string[];
}) {
  const router = useRouter();
  const initialType = (allowedTypes[0] ?? "rose") as FlowerTypeKey;
  const [flowerType, setFlowerType] = useState<FlowerTypeKey>(initialType);
  const [variety, setVariety] = useState<string>(varieties[initialType]?.[0] ?? "");
  const [grade, setGrade] = useState<string>(getGradesFor(initialType)[0] ?? "");
  const [quantityIn, setQuantityIn] = useState("");
  const [harvestDate, setHarvestDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [location, setLocation] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setSubmitting(true);
    try {
      const batchId = await createBatchAction({
        flowerType,
        variety: variety.trim(),
        grade,
        quantityIn: Number(quantityIn),
        harvestDate,
        location: location.trim(),
      });
      // Код показываем, но отдельной мелкой строкой: подтверждение приёмки
      // важнее кода, а код нужен лишь чтобы подписать ведро.
      setSuccess(batchId);
      setQuantityIn("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось сохранить партию");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="card max-w-xl space-y-4">
      <div className="grid sm:grid-cols-2 gap-4">
        <div>
          <label className="label">Тип цветка</label>
          <select
            className="input"
            value={flowerType}
            onChange={(e) => {
              const next = e.target.value as FlowerTypeKey;
              setFlowerType(next);
              setGrade(getGradesFor(next)[0] ?? "");
              setVariety(varieties[next]?.[0] ?? "");
            }}
          >
            {allowedTypes.map((value) => (
              <option key={value} value={value}>
                {FLOWER_TYPE_LABELS[value] ?? value}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Сорт *</label>
          <select className="input" value={variety} onChange={(e) => setVariety(e.target.value)} required>
            {(varieties[flowerType] ?? []).map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">{GRADE_LABELS[flowerType]} *</label>
          <select className="input" value={grade} onChange={(e) => setGrade(e.target.value)} required>
            {getGradesFor(flowerType).map((g) => (
              <option key={g} value={g}>
                {formatGrade(g)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Количество, шт *</label>
          <input
            type="number"
            min={1}
            className="input"
            value={quantityIn}
            onChange={(e) => setQuantityIn(e.target.value)}
            required
          />
        </div>
        <div>
          <label className="label">Дата сбора/срезки *</label>
          <input
            type="date"
            className="input"
            value={harvestDate}
            onChange={(e) => setHarvestDate(e.target.value)}
            required
          />
        </div>
        <div>
          <label className="label">Место хранения</label>
          <input className="input" placeholder="например, Холодильник 1" value={location} onChange={(e) => setLocation(e.target.value)} />
        </div>
      </div>

      {error && <div className="text-sm text-status-critical bg-status-critical/10 rounded-lg px-3 py-2">{error}</div>}
      {success && (
        <div className="text-sm text-status-good bg-status-good/10 rounded-lg px-3 py-2">
          Партия принята на склад
          <span className="block text-[11px] text-ink-muted font-mono mt-0.5">{success}</span>
        </div>
      )}

      <button type="submit" disabled={submitting} className="btn-primary">
        {submitting ? "Сохранение…" : "Принять партию"}
      </button>
    </form>
  );
}

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { setTakeoutPriceAction } from "@/app/warehouse/actions";
import { unwrap } from "@/lib/actionResult";

/**
 * Цена записанной выдачи — поставить или поправить на месте.
 *
 * Зав. складом: «здесь цену нужно забить, разрешение дайте на изменение».
 * Выдачу пишут у холодильника, цену часто узнают позже; без цены строка не
 * попадает в удержание. Поле — прямо в строке, одно нажатие «✓».
 */
export default function TakeoutPriceCell({
  takeoutId,
  unitPrice,
  suggested = 0,
}: {
  takeoutId: string;
  unitPrice: number;
  /** Внутренняя цена из прайса — подсказка в пустом поле. */
  suggested?: number;
}) {
  const router = useRouter();
  const [value, setValue] = useState(unitPrice > 0 ? String(unitPrice) : "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const changed = (Number(value) || 0) !== (unitPrice || 0);

  async function save() {
    setError(null);
    setSaving(true);
    try {
      unwrap(await setTakeoutPriceAction(takeoutId, Number(value) || 0));
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось сохранить");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="inline-flex flex-col items-end">
      <div className="inline-flex items-center gap-1">
        <input
          className="input !w-24 !py-1 text-right"
          inputMode="decimal"
          value={value}
          placeholder={suggested > 0 ? String(suggested) : "цена"}
          onChange={(e) => setValue(e.target.value.replace(/[^\d.,]/g, "").replace(",", "."))}
          onKeyDown={(e) => {
            if (e.key === "Enter" && changed) save();
          }}
        />
        {changed && (
          <button type="button" className="btn-primary !py-1 !px-2" disabled={saving} onClick={save}>
            {saving ? "…" : "✓"}
          </button>
        )}
      </div>
      {error && <span className="text-xs text-status-critical mt-0.5">{error}</span>}
    </div>
  );
}

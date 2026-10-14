"use client";

import { useState, type ReactNode } from "react";

/**
 * Отгрузка без полной оплаты (14.10.2026, владелец: «если клиенту всё равно отгрузили — отними это со склада»).
 * Форма отгрузки открывается только после явной отметки: деньги вперёд остаются правилом, а отметка — фактом,
 * который уходит в журнал денег и в долги бухгалтеру. Правило — `canShipUnpaid` в `orderReady.ts`.
 */
export default function UnpaidShipGate({ rest, children }: { rest: number; children: ReactNode }) {
  const [ack, setAck] = useState(false);
  return (
    <div className="space-y-4">
      <div className="card space-y-2 border-l-4 border-[#8a5a00]">
        <p className="text-sm">
          Оплата не полная — остаток <b>{rest.toLocaleString("ru-RU")} ₸</b>.
        </p>
        <label className="flex items-start gap-2 text-sm cursor-pointer">
          <input type="checkbox" className="mt-1 h-4 w-4" checked={ack} onChange={(e) => setAck(e.target.checked)} />
          <span>
            Отгрузили без полной оплаты — снять со склада. Остаток уйдёт бухгалтеру в долги.
          </span>
        </label>
      </div>
      {ack && children}
    </div>
  );
}

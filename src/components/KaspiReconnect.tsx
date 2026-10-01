"use client";

import { PhoneInput } from "@/components/PhoneInput";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  kaspiReconnectOtpAction,
  kaspiReconnectPhoneAction,
  kaspiReconnectStartAction,
} from "@/app/finance/kaspi-actions";
import { unwrapValue } from "@/lib/actionResult";

/**
 * «Переподключить кассира» прямо из полосы «Kaspi-касса отключилась» — те же
 * три шага, что в кабинете ApiPay: начать → номер кассира (Kaspi пришлёт SMS)
 * → код из SMS. На всё у Kaspi около 10 минут.
 */
export default function KaspiReconnect({ farm }: { farm: string }) {
  const router = useRouter();
  const [step, setStep] = useState<"idle" | "phone" | "otp" | "done">("idle");
  const [connectionId, setConnectionId] = useState(0);
  const [phone, setPhone] = useState("");
  const [hint, setHint] = useState("");
  const [otp, setOtp] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function run(work: () => Promise<void>) {
    setError(null);
    startTransition(async () => {
      try {
        await work();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Не получилось — попробуйте ещё раз");
      }
    });
  }

  const start = () =>
    run(async () => {
      const r = unwrapValue(await kaspiReconnectStartAction(farm));
      setConnectionId(r.connectionId);
      if (r.phone && !phone) setPhone(r.phone);
      setHint(r.phoneHint && r.phoneHint !== r.phone ? r.phoneHint : "");
      setOtp("");
      setStep("phone");
    });

  const sendPhone = () =>
    run(async () => {
      unwrapValue(await kaspiReconnectPhoneAction({ farm, connectionId, phone }));
      setStep("otp");
    });

  const verify = () =>
    run(async () => {
      unwrapValue(await kaspiReconnectOtpAction({ farm, connectionId, otp }));
      setStep("done");
      router.refresh();
    });

  if (step === "done") {
    return <p className="text-sm font-medium text-status-good">Кассир подключён — счета в Kaspi снова уходят.</p>;
  }

  return (
    <div className="space-y-2">
      {step === "idle" && (
        <button type="button" onClick={start} disabled={pending} className="btn-primary !bg-status-critical">
          {pending ? "Начинаю…" : "Переподключить кассира"}
        </button>
      )}

      {step === "phone" && (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            sendPhone();
          }}
        >
          <label className="space-y-1">
            <span className="label">
              Номер кассира в Kaspi Pay{hint ? <span className="text-ink-muted font-normal"> · в ApiPay: {hint}</span> : null}
            </span>
            <PhoneInput
              className="input !w-56"
              autoFocus
              value={phone}
              onChange={setPhone}
            />
          </label>
          <button className="btn-primary" disabled={pending || !phone.trim()}>
            {pending ? "Отправляю…" : "Прислать SMS"}
          </button>
          <button type="button" className="btn-secondary" disabled={pending} onClick={() => setStep("idle")}>
            Отмена
          </button>
        </form>
      )}

      {step === "otp" && (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            verify();
          }}
        >
          <label className="space-y-1">
            <span className="label">Код из SMS на номер кассира</span>
            <input
              className="input !w-36 tabular-nums tracking-widest"
              inputMode="numeric"
              autoComplete="one-time-code"
              autoFocus
              maxLength={8}
              value={otp}
              onChange={(e) => setOtp(e.target.value)}
            />
          </label>
          <button className="btn-primary" disabled={pending || otp.replace(/\D/g, "").length < 4}>
            {pending ? "Проверяю…" : "Подключить"}
          </button>
          <button type="button" className="text-sm text-accent hover:underline" disabled={pending} onClick={start}>
            SMS не пришло — начать заново
          </button>
        </form>
      )}

      {error && <p className="text-sm text-status-critical bg-status-critical/10 rounded-lg px-3 py-2">{error}</p>}
    </div>
  );
}

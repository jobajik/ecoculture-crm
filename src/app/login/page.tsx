"use client";

import { signIn } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

function LoginContent() {
  const params = useSearchParams();
  const error = params.get("error");

  return (
    <div className="min-h-screen flex items-center justify-center bg-surface-plane px-4">
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-2.5 mb-6">
          <span className="grid place-content-center w-9 h-9 rounded-xl bg-accent text-white font-bold">
            E
          </span>
          <div className="leading-tight">
            <div className="font-semibold tracking-tight">Ecoculture-CRM</div>
            <div className="text-xs text-ink-muted">Заявки, склад и продажи</div>
          </div>
        </div>

        <div className="card">
          <h1 className="font-semibold mb-1">Вход для сотрудников</h1>
          <p className="text-sm text-ink-secondary mb-5">
            Используйте рабочий Google-аккаунт. Доступ выдаёт администратор.
          </p>

          {error === "AccessDenied" && (
            <p className="text-sm text-status-critical bg-status-critical/10 rounded-lg px-3 py-2 mb-4">
              Этот Google-аккаунт не найден среди сотрудников. Обратитесь к администратору, чтобы вас
              добавили в систему.
            </p>
          )}
          {error && error !== "AccessDenied" && (
            <p className="text-sm text-status-critical bg-status-critical/10 rounded-lg px-3 py-2 mb-4">
              Не удалось войти. Попробуйте ещё раз.
            </p>
          )}

          <button onClick={() => signIn("google", { callbackUrl: "/" })} className="btn-primary w-full">
            Войти через Google
          </button>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginContent />
    </Suspense>
  );
}

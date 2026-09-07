"use client";

import { signIn } from "next-auth/react";
import Image from "next/image";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

function LoginContent() {
  const params = useSearchParams();
  const error = params.get("error");

  return (
    <div className="min-h-screen flex items-center justify-center bg-surface-plane px-4">
      <div className="w-full max-w-sm">
        {/* На входе логотип показываем целиком — это первое, что видит сотрудник. */}
        <div className="text-center mb-6">
          <Image
            src="/logo.png"
            alt="Eco Culture"
            width={1020}
            height={593}
            priority
            className="w-44 h-auto mx-auto"
          />
          <div className="mt-3 font-semibold tracking-tight">Ecoculture-CRM</div>
          <div className="text-xs text-ink-muted">Заявки, склад и продажи</div>
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

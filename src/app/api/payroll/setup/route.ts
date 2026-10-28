import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { ROLES } from "@/lib/constants";
import { ensurePayrollSheet } from "@/lib/payrollSheet";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Подключение таблицы зарплаты — одной страницей для администратора, без компьютера и терминала.
 * Первый заход создаёт файл и показывает ID, второй (после того как ID вписан на Vercel) — подтверждает,
 * что вкладки на месте. Что именно делается — `src/lib/payrollSheet.ts`.
 */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (session?.user?.role !== ROLES.ADMIN) return new Response("Недостаточно прав", { status: 403 });

  try {
    const r = await ensurePayrollSheet();
    const body =
      r.state === "created"
        ? `<h1>Таблица зарплаты создана</h1>
<p>Файл <a href="${r.url}" target="_blank" rel="noopener">«Зарплата Rose Farm»</a> появился на вашем Google-диске, в нём ${r.createdTabs.length} вкладок с заголовками.</p>
<p>Осталось сказать сайту, где он лежит:</p>
<ol>
<li>Откройте Vercel → проект ecoculture-crm → Settings → Environment Variables.</li>
<li>Добавьте переменную <code>PAYROLL_SPREADSHEET_ID</code> со значением:<br><code style="font-size:18px;user-select:all">${r.spreadsheetId}</code></li>
<li>Сохраните и пересоберите сайт (Deployments → последний деплой → Redeploy).</li>
<li>Откройте эту страницу ещё раз — она подтвердит, что всё подключено.</li>
</ol>
<p>Пока переменная не вписана, раздел «Зарплата» пустой и ничего не записывает: в общую таблицу CRM зарплата не попадает.</p>`
        : `<h1>Таблица зарплаты подключена</h1>
<p>Сайт пишет зарплату в <a href="${r.url}" target="_blank" rel="noopener">отдельную таблицу</a>.</p>
<ul>
<li>Вкладки на месте${r.createdTabs.length ? ` (дописаны: ${r.createdTabs.join(", ")})` : ""}.</li>
<li>Заголовки общей таблицы (Users) ${r.usersHeadersUpdated ? "обновлены" : "не трогались"}.</li>
</ul>
<p>Дальше — <a href="/payroll">раздел «Зарплата»</a>.</p>`;
    return new Response(page(body), { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(page(`<h1>Не получилось</h1><p>${escape(message)}</p>`), {
      status: 500,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }
}

function escape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function page(body: string): string {
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Таблица зарплаты</title>
<style>body{font:16px/1.5 Arial,sans-serif;max-width:640px;margin:40px auto;padding:0 20px;color:#1a1d1b}code{background:#f0f1ef;padding:2px 6px;border-radius:6px}h1{font-size:22px}a{color:#8c4a1f}</style></head><body>${body}</body></html>`;
}

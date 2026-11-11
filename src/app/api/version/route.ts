export const dynamic = "force-dynamic";

/**
 * Какая версия кода сейчас на сайте: первые семь знаков коммита, из которого Vercel собрал сайт. Нужна проверке после
 * выкладки (12.11.2026): коммит ушёл в GitHub — это ещё не значит, что сборка прошла и сайт обновился, а со стороны
 * этого было не узнать. Репозиторий открытый, номер коммита не тайна; больше адрес ничего не отдаёт.
 */
export async function GET() {
  return Response.json({ commit: (process.env.VERCEL_GIT_COMMIT_SHA || "").slice(0, 7) }, { headers: { "Cache-Control": "no-store" } });
}

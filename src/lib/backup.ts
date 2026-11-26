import { google } from "googleapis";
import { SHEET_TABS } from "./constants";
import { isPayrollTab, isQuotaError, readTable } from "./sheets";

/**
 * Резервная копия таблицы.
 *
 * Вся база хозяйства — одна Google-таблица. История версий у Google есть, но она
 * не спасает от того, что файл удалят целиком или что кто-то с доступом снесёт
 * половину строк и это заметят через неделю. Поэтому раз в сутки данные
 * складываются в ОТДЕЛЬНЫЙ файл с датой в названии.
 *
 * Копия делается через Sheets API (`spreadsheets.create`), а не через Drive:
 * у приложения есть доступ только к таблицам, и просить ради копии доступ ко
 * всему диску было бы неоправданно широко.
 *
 * Копия — это снимок значений. Формулы, форматирование и примечания не
 * переносятся: в этой таблице их нет, она хранит данные, а не расчёты.
 */

function client() {
  const refreshToken = process.env.GOOGLE_OAUTH_REFRESH_TOKEN;
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!refreshToken || !clientId || !clientSecret) {
    throw new Error("Нет доступа к Google: проверьте переменные окружения");
  }
  const auth = new google.auth.OAuth2(clientId, clientSecret);
  auth.setCredentials({ refresh_token: refreshToken });
  return google.sheets({ version: "v4", auth });
}

export interface BackupResult {
  spreadsheetId: string;
  title: string;
  url: string;
  tabs: number;
  rows: number;
}

/**
 * Куда сообщать о ходе работы. Нужно скриптам, которые запускает человек:
 * копия боевой таблицы делается около минуты, и всё это время окно молчит —
 * выглядит как зависание, и его закрывают на середине. Так уже случилось.
 * В расписании Vercel обработчик не передаёт ничего, и вывода нет.
 */
export type BackupProgress = (message: string) => void;

/** Google отвечает так, когда листа с таким названием в таблице нет (а не когда чтение не удалось). */
export function isMissingTabError(err: unknown): boolean {
  return /unable to parse range/i.test(String((err as { message?: unknown })?.message ?? err ?? ""));
}

export async function createBackup(
  now: Date = new Date(),
  onProgress: BackupProgress = () => {},
  /** Сколько раз повторить чтение вкладки и сколько ждать между попытками (ночной запуск живёт минуту — ждёт меньше). */
  options: { retries?: number; retryPauseMs?: number } = {}
): Promise<BackupResult> {
  const sheets = client();
  // Зарплата лежит в отдельной таблице и в общую копию не идёт: владелец вынес её, чтобы оклады не было видно
  // рядом с данными CRM, — копия с ними этого смысла лишила бы. У Google есть своя история версий файла.
  const tabs = Object.values(SHEET_TABS).filter((t) => !isPayrollTab(t));

  // Сначала читаем всё, и только потом создаём файл: если чтение упадёт, лучше
  // не оставлять в диске пустую копию, которая выглядит как удачная.
  const data: { title: string; values: string[][] }[] = [];
  let rows = 0;
  let done = 0;
  for (const tab of tabs) {
    done++;
    // 26.11.2026: копия перед правкой, сделанная в рабочий час, написала «вкладки нет» про LeadTouches, KaspiInvoices,
    // WaFiles и BotChats — вкладки на месте, это Google ограничил чтения. Любой сбой чтения считался отсутствием
    // вкладки, и копия без четырёх вкладок выглядела удачной. Теперь «вкладки нет» — только когда Google сам сказал,
    // что такого листа нет; лимит пережидается и чтение повторяется; не вышло — копия НЕ делается, с объяснением.
    let attempt = 0;
    for (;;) {
      try {
        const table = await readTable(tab);
        const values = [table.headers, ...table.rows];
        rows += table.rows.length;
        data.push({ title: tab, values });
        onProgress(`  [${done}/${tabs.length}] ${tab} — ${table.rows.length} строк`);
        break;
      } catch (err) {
        const text = err instanceof Error ? err.message : String(err);
        if (isMissingTabError(err)) {
          onProgress(`  [${done}/${tabs.length}] ${tab} — вкладки нет, пропускаю`);
          break;
        }
        attempt += 1;
        if (attempt > (options.retries ?? 2)) throw new Error(`Копия не сделана: вкладка «${tab}» не прочиталась (${text.slice(0, 140)}). Повторите через минуту.`);
        onProgress(`  [${done}/${tabs.length}] ${tab} — не прочиталась (${isQuotaError(err) ? "лимит Google" : text.slice(0, 60)}), жду и повторяю…`);
        await new Promise((r) => setTimeout(r, options.retryPauseMs ?? 25000));
      }
    }
  }

  const stamp = now.toISOString().slice(0, 16).replace("T", " ");
  const title = `Ecoculture-CRM — копия ${stamp}`;

  onProgress(`  Создаю файл «${title}» (${rows} строк) — это самая долгая часть…`);

  const created = await sheets.spreadsheets.create({
    requestBody: {
      properties: { title },
      sheets: data.map((d) => ({
        properties: { title: d.title },
        data: [
          {
            startRow: 0,
            startColumn: 0,
            rowData: d.values.map((row) => ({
              values: row.map((cell) => ({
                userEnteredValue: { stringValue: String(cell ?? "") },
              })),
            })),
          },
        ],
      })),
    },
  });

  const spreadsheetId = created.data.spreadsheetId ?? "";
  return {
    spreadsheetId,
    title,
    url: `https://docs.google.com/spreadsheets/d/${spreadsheetId}`,
    tabs: data.length,
    rows,
  };
}

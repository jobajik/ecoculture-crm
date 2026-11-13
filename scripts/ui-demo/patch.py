"""Демо-копия: подменяет клиент Google-таблицы чтением тестовых данных из файла (DEMO_FIXTURE) и отключает проверки сборки.
Применяется ТОЛЬКО к копии во временной папке (run.sh), не к репозиторию."""
import sys, re
d = sys.argv[1]
p = d + "/src/lib/sheets.ts"
s = open(p, encoding="utf-8").read()
fake = '''
// ---- ДЕМО: подмена клиента Google тестовыми данными (только локальная копия) ----
let demoData: Record<string, string[][]> | null = null;
function demoClient(): sheets_v4.Sheets {
  if (!demoData) {
    // Одни данные на весь процесс: у страницы и у серверного действия свои копии этого модуля, и запись, сделанная
    // действием, иначе не была бы видна странице.
    const shared = globalThis as unknown as { __demoData?: Record<string, string[][]> };
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    if (!shared.__demoData) shared.__demoData = JSON.parse(require("fs").readFileSync(process.env.DEMO_FIXTURE as string, "utf-8"));
    demoData = shared.__demoData!;
  }
  const tabOf = (range: string) => range.split("!")[0].replace(/^'|'$/g, "");
  const ok = async () => ({ data: {} });
  return {
    spreadsheets: {
      get: async () => ({ data: { sheets: Object.keys(demoData!).map((t, i) => ({ properties: { title: t, sheetId: i, gridProperties: { rowCount: 1000, columnCount: 40 } } })) } }),
      // Записи пакетом (`commitAtomic`, `deleteWhere`) применяются В ПАМЯТИ копии: без этого действие «создать и тут
      // же прочитать» (заявка + отгрузка одним шагом, 13.11.2026) на копии не проверить. В файл и на сайт не попадают.
      batchUpdate: async ({ requestBody }: { requestBody: { requests: Record<string, any>[] } }) => {
        const names = Object.keys(demoData!);
        const text = (v: any) => {
          const u = v?.userEnteredValue ?? {};
          return u.stringValue !== undefined ? String(u.stringValue) : u.numberValue !== undefined ? String(u.numberValue) : u.boolValue !== undefined ? (u.boolValue ? "TRUE" : "FALSE") : "";
        };
        for (const r of requestBody.requests ?? []) {
          if (r.appendCells) {
            const rows = demoData![names[r.appendCells.sheetId]];
            for (const row of r.appendCells.rows ?? []) rows.push((row.values ?? []).map(text));
          } else if (r.updateCells) {
            const g = r.updateCells.range;
            const rows = demoData![names[g.sheetId]];
            (r.updateCells.rows ?? []).forEach((row: any, i: number) => {
              const target = (rows[g.startRowIndex + i] ??= []);
              (row.values ?? []).forEach((v: any, j: number) => {
                while (target.length < g.startColumnIndex + j) target.push("");
                target[g.startColumnIndex + j] = text(v);
              });
            });
          } else if (r.deleteDimension) {
            const g = r.deleteDimension.range;
            demoData![names[g.sheetId]].splice(g.startIndex, g.endIndex - g.startIndex);
          }
        }
        return { data: {} };
      },
      create: ok,
      values: {
        get: async ({ range }: { range: string }) => ({ data: { values: demoData![tabOf(range)] ?? [] } }),
        batchGet: async ({ ranges }: { ranges: string[] }) => ({ data: { valueRanges: ranges.map((r) => ({ values: demoData![tabOf(r)] ?? [] })) } }),
        append: ok, update: ok, batchUpdate: ok, clear: ok,
      },
    },
  } as unknown as sheets_v4.Sheets;
}
'''
assert "function getSheetsClient(): sheets_v4.Sheets {\n  if (cachedClient) return cachedClient;" in s
s = s.replace("function getSheetsClient(): sheets_v4.Sheets {\n  if (cachedClient) return cachedClient;", fake + "\nfunction getSheetsClient(): sheets_v4.Sheets {\n  if (cachedClient) return cachedClient;\n  if (process.env.DEMO_FIXTURE) { cachedClient = demoClient(); return cachedClient; }", 1)
open(p, "w", encoding="utf-8").write(s)
print("patched sheets.ts")
p = d + "/next.config.js"
s = open(p, encoding="utf-8").read()
s = s.replace("const nextConfig = {", "const nextConfig = {\n  typescript: { ignoreBuildErrors: true },\n  eslint: { ignoreDuringBuilds: true },", 1)
assert "ignoreBuildErrors" in s
open(p, "w", encoding="utf-8").write(s)
print("patched next.config.js")

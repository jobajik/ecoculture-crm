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
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    demoData = JSON.parse(require("fs").readFileSync(process.env.DEMO_FIXTURE as string, "utf-8"));
  }
  const tabOf = (range: string) => range.split("!")[0].replace(/^'|'$/g, "");
  const ok = async () => ({ data: {} });
  return {
    spreadsheets: {
      get: async () => ({ data: { sheets: Object.keys(demoData!).map((t, i) => ({ properties: { title: t, sheetId: i, gridProperties: { rowCount: 1000, columnCount: 40 } } })) } }),
      batchUpdate: ok,
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

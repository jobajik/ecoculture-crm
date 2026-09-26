import JSZip from "jszip";

// ---------------------------------------------------------------------------
// Быстрое чтение Excel-файла в браузере — только значения ячеек, без стилей.
//
// Зачем, если есть ExcelJS: выгрузка из прошлой CRM (10 листов, 14 000 строк,
// 1,7 МБ) читалась ExcelJS почти три минуты — сервер Vercel обрывает запрос
// гораздо раньше, и загрузка базы просто не доходила бы до предпросмотра.
// Файл .xlsx — это zip с XML внутри; значения лежат в двух местах: общий
// словарь строк (sharedStrings.xml) и сами листы. Этого хватает, чтобы собрать
// таблицу строк за секунду. Даты в ячейках — числа-серийники Excel; их понимает
// `toIsoDate()` (тот же счёт дней от 30.12.1899, что у Google).
//
// Модуль чистый и без DOM: его зовёт и браузер, и проверка в Node.
// ---------------------------------------------------------------------------

export interface SheetMatrix {
  name: string;
  matrix: string[][];
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

function decode(text: string): string {
  return text
    .replace(/&(amp|lt|gt|quot|apos);/g, (_, e: string) => ENTITIES[e])
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/_x000D_/g, "");
}

/** Текст из <si>/<is>: все <t> подряд (строка с форматированием бьётся на куски). */
function richText(xml: string): string {
  let out = "";
  const re = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) out += m[1];
  return decode(out);
}

/** «B12» → 1 (номер колонки с нуля). */
function columnIndex(ref: string): number {
  let n = 0;
  for (const ch of ref) {
    const code = ch.charCodeAt(0);
    if (code < 65 || code > 90) break;
    n = n * 26 + (code - 64);
  }
  return n - 1;
}

function parseSheet(xml: string, shared: string[]): string[][] {
  const matrix: string[][] = [];
  const rowRe = /<row\b([^>]*)>([\s\S]*?)<\/row>/g;
  let rm: RegExpExecArray | null;
  let nextRow = 0;
  while ((rm = rowRe.exec(xml))) {
    const rAttr = /\br="(\d+)"/.exec(rm[1]);
    const rowIndex = rAttr ? Number(rAttr[1]) - 1 : nextRow;
    nextRow = rowIndex + 1;
    const cells: string[] = [];
    const cellRe = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
    let cm: RegExpExecArray | null;
    let nextCol = 0;
    while ((cm = cellRe.exec(rm[2]))) {
      const attrs = cm[1];
      const body = cm[2] ?? "";
      const ref = /\br="([A-Z]+)\d+"/.exec(attrs);
      const col = ref ? columnIndex(ref[1]) : nextCol;
      nextCol = col + 1;
      const type = /\bt="([^"]+)"/.exec(attrs)?.[1] ?? "";
      let value = "";
      if (type === "inlineStr") value = richText(body);
      else {
        const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
        if (v !== undefined) {
          if (type === "s") value = shared[Number(v)] ?? "";
          else if (type === "b") value = v === "1" ? "TRUE" : "FALSE";
          else value = decode(v);
        }
      }
      while (cells.length < col) cells.push("");
      cells[col] = value.trim();
    }
    matrix[rowIndex] = cells;
  }
  return Array.from(matrix, (r) => r ?? []);
}

/** Все листы файла .xlsx по порядку, как их видит человек. */
export async function readXlsxSheets(data: ArrayBuffer | Uint8Array): Promise<SheetMatrix[]> {
  const zip = await JSZip.loadAsync(data);
  const file = (path: string) => zip.file(path)?.async("string") ?? Promise.resolve("");

  const sharedXml = await file("xl/sharedStrings.xml");
  const shared: string[] = [];
  const siRe = /<si>([\s\S]*?)<\/si>/g;
  let sm: RegExpExecArray | null;
  while ((sm = siRe.exec(sharedXml))) shared.push(richText(sm[1]));

  const workbook = await file("xl/workbook.xml");
  const rels = await file("xl/_rels/workbook.xml.rels");
  const target = new Map<string, string>();
  const relRe = /<Relationship\b[^>]*?Id="([^"]+)"[^>]*?Target="([^"]+)"/g;
  let rl: RegExpExecArray | null;
  while ((rl = relRe.exec(rels))) target.set(rl[1], rl[2]);
  // Атрибуты в <Relationship> бывают и в другом порядке.
  const relRe2 = /<Relationship\b[^>]*?Target="([^"]+)"[^>]*?Id="([^"]+)"/g;
  while ((rl = relRe2.exec(rels))) if (!target.has(rl[2])) target.set(rl[2], rl[1]);

  const out: SheetMatrix[] = [];
  const sheetRe = /<sheet\b([^>]*)\/?>/g;
  let sh: RegExpExecArray | null;
  while ((sh = sheetRe.exec(workbook))) {
    const name = decode(/\bname="([^"]*)"/.exec(sh[1])?.[1] ?? "");
    const rid = /\br:id="([^"]+)"/.exec(sh[1])?.[1] ?? "";
    let path = target.get(rid) ?? "";
    if (!path) continue;
    path = path.startsWith("/") ? path.slice(1) : `xl/${path.replace(/^\.\//, "")}`;
    const xml = await file(path);
    if (!xml) continue;
    out.push({ name, matrix: parseSheet(xml, shared) });
  }
  return out;
}

/** CSV из Excel: разделитель «;» или «,», кавычки с удвоением. */
export function parseCsv(text: string): string[][] {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/);
  const first = lines[0] ?? "";
  const sep = first.split(";").length > first.split(",").length ? ";" : ",";
  return lines.map((line) => {
    const out: string[] = [];
    let cur = "";
    let quoted = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (quoted) {
        if (ch === '"' && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else if (ch === '"') quoted = false;
        else cur += ch;
      } else if (ch === '"') quoted = true;
      else if (ch === sep) {
        out.push(cur.trim());
        cur = "";
      } else cur += ch;
    }
    out.push(cur.trim());
    return out;
  });
}

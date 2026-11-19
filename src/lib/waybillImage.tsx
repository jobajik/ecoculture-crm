import React from "react";
import { ImageResponse } from "next/og";
import { PNG } from "pngjs";
import jpeg from "jpeg-js";
import { waybillSections, type WaybillDoc } from "./waybill";

// ---------------------------------------------------------------------------
// Рисует накладную клиенту (`waybill.ts`) в JPEG — тем же способом, что страницу каталога (`catalogImage.tsx`):
// Satori (`next/og`) даёт PNG, `pngjs` + `jpeg-js` перекладывают в JPEG. Картинка, а не PDF: в WhatsApp она видна
// сразу в переписке, без скачивания, и читается с телефона.
//
// Высоту заранее точно не узнать (длинное название переносится на вторую строку), поэтому холст берётся с запасом,
// а пустой низ потом срезается по пикселям (`trimBottom`).
// ---------------------------------------------------------------------------

const W = 1080;
const PAD = 48;
const C = {
  bg: "#FFFFFF",
  line: "#E3E6E3",
  soft: "#F4F6F4",
  ink: "#1B2420",
  muted: "#6E7772",
  accent: "#0F7A52",
  accentSoft: "#E8F3EC",
  warn: "#B45309",
  warnSoft: "#FEF3C7",
};

const COL = { n: 52, qty: 128, price: 128, sum: 180 };

const nf = (n: number) => (Math.round(n * 100) / 100).toLocaleString("ru-RU", { maximumFractionDigits: 2 }).replace(/\s/g, " ");
/** «70 см» и «1 Pure» не рвутся по строкам: пробел после числа — неразрывный. */
const glue = (name: string) => name.replace(/(\d) (?=см\b|см$)/g, "$1\u00a0");
const day = (iso: string) => (/^\d{4}-\d{2}-\d{2}/.test(iso) ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}` : "");

export interface WaybillFont {
  name: string;
  data: ArrayBuffer;
  weight: 400 | 700 | 800;
}

/**
 * Шрифты для Satori. У @fontsource каждый набор знаков — отдельный файл, имена им даём разные (одинаковые Satori
 * склеивает и берёт первый): латиница, кириллица, расширенная кириллица — в ней казахские буквы (ә, ғ, қ, ң, ө, ұ, ү, һ, і),
 * а знак ₸ есть только в Arimo (latin-ext). Файлы кладёт в функцию `outputFileTracingIncludes` в `next.config.js`.
 */
export async function loadWaybillFonts(read: (path: string) => Promise<Buffer>): Promise<WaybillFont[]> {
  const base = "node_modules/@fontsource";
  const list: { name: string; file: string; weight: WaybillFont["weight"] }[] = [];
  for (const w of [400, 700, 800] as const) {
    list.push({ name: "Manrope Latin", file: `${base}/manrope/files/manrope-latin-${w}-normal.woff`, weight: w });
    list.push({ name: "Manrope Cyrillic", file: `${base}/manrope/files/manrope-cyrillic-${w}-normal.woff`, weight: w });
    list.push({ name: "Manrope CyrExt", file: `${base}/manrope/files/manrope-cyrillic-ext-${w}-normal.woff`, weight: w });
  }
  for (const w of [400, 700] as const) {
    list.push({ name: "Arimo Ext", file: `${base}/arimo/files/arimo-latin-ext-${w}-normal.woff`, weight: w });
    // В Manrope нет части заглавных казахских букв (Ә, Қ) — их добирает Arimo; без него Satori пошёл бы за шрифтом в интернет.
    list.push({ name: "Arimo CyrExt", file: `${base}/arimo/files/arimo-cyrillic-ext-${w}-normal.woff`, weight: w });
  }
  return Promise.all(
    list.map(async (f) => {
      const buf = await read(f.file);
      return { name: f.name, weight: f.weight, data: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer };
    })
  );
}

/** Высота холста с запасом: строка позиции считается двухстрочной, если название длинное. */
export function waybillCanvasHeight(doc: WaybillDoc): number {
  const sections = waybillSections(doc);
  const rows = doc.lines.reduce((s, l) => s + 64 + Math.floor(l.name.length / 24) * 36, 0);
  return 1000 + sections.length * 190 + rows + (doc.restStems > 0 ? 80 : 0) + (doc.sample ? 90 : 0);
}

/** Срезает пустой (цвета фона) низ картинки, оставляя поле `keep` пикселей. Возвращает новую высоту. */
export function trimBottom(data: Uint8Array | Buffer, width: number, height: number, keep: number, bg: [number, number, number] = [255, 255, 255]): number {
  const same = (y: number) => {
    const from = y * width * 4;
    for (let x = 0; x < width; x += 3) {
      const i = from + x * 4;
      if (Math.abs(data[i] - bg[0]) > 6 || Math.abs(data[i + 1] - bg[1]) > 6 || Math.abs(data[i + 2] - bg[2]) > 6) return false;
    }
    return true;
  };
  let last = height - 1;
  while (last > 0 && same(last)) last--;
  return Math.min(height, last + 1 + keep);
}

function Fact(props: { label: string; value: string; width: number }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", width: props.width, marginBottom: 18 }}>
      <div style={{ display: "flex", fontSize: 20, color: C.muted, letterSpacing: 1 }}>{props.label}</div>
      <div style={{ display: "flex", fontSize: 27, fontWeight: 700, marginTop: 4, lineHeight: 1.3 }}>{props.value}</div>
    </div>
  );
}

export async function renderWaybillJpeg(input: { doc: WaybillDoc; logo: string | null; fonts: WaybillFont[]; quality?: number }): Promise<Buffer> {
  const { doc, logo } = input;
  const sections = waybillSections(doc);
  const H = waybillCanvasHeight(doc);
  const inner = W - PAD * 2;
  const half = (inner - 56) / 2;
  const nameW = inner - 48 - COL.n - COL.qty - COL.price - COL.sum;
  const cell = { display: "flex", fontSize: 25 } as const;
  const head = { display: "flex", fontSize: 19, color: C.muted, letterSpacing: 1 } as const;
  let n = 0;

  const png = await new ImageResponse(
    (
      <div style={{ width: W, height: H, display: "flex", flexDirection: "column", background: C.bg, fontFamily: "Manrope Latin, Manrope Cyrillic, Manrope CyrExt, Arimo Ext, Arimo CyrExt", color: C.ink, padding: `${PAD}px ${PAD}px` }}>
        {doc.sample && (
          <div style={{ display: "flex", justifyContent: "center", background: C.warnSoft, color: C.warn, fontSize: 24, fontWeight: 700, borderRadius: 14, padding: "14px 20px", marginBottom: 24 }}>
            ОБРАЗЕЦ · клиент и позиции выдуманы, это не документ
          </div>
        )}

        {/* Шапка */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          {logo ? (
            // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
            <img src={logo} width={172} height={100} style={{ objectFit: "contain" }} />
          ) : (
            <div style={{ display: "flex", fontSize: 40, fontWeight: 800, color: C.accent }}>Ecoculture</div>
          )}
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
            <div style={{ display: "flex", fontSize: 21, letterSpacing: 5, color: C.accent, fontWeight: 700 }}>НАКЛАДНАЯ</div>
            <div style={{ display: "flex", fontSize: 44, fontWeight: 800, marginTop: 2 }}>№ {doc.number}</div>
            <div style={{ display: "flex", fontSize: 23, color: C.muted, marginTop: 2 }}>от {day(doc.date)}</div>
          </div>
        </div>

        {/* Кому и по какой заявке */}
        <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", borderTop: `2px solid ${C.ink}`, borderBottom: `2px solid ${C.line}`, marginTop: 28, paddingTop: 24, paddingBottom: 6 }}>
          <Fact label="ПОКУПАТЕЛЬ" value={doc.client ? `${doc.client}${doc.city ? ` · ${doc.city}` : ""}` : "-"} width={half} />
          <Fact label="ЗАЯВКА" value={`№ ${doc.orderCode}${day(doc.deliveryDate) ? ` · доставка ${day(doc.deliveryDate)}` : ""}`} width={half} />
          <Fact label="ПОСТАВЩИК" value={sections.map((s) => s.label).join(" · ") || "Ecoculture"} width={half} />
          <Fact label="МЕНЕДЖЕР" value={doc.manager || "-"} width={half} />
        </div>

        {/* Позиции по компаниям */}
        {sections.map((s) => (
          <div key={s.farm} style={{ display: "flex", flexDirection: "column", marginTop: 30 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
              <div style={{ display: "flex", fontSize: 29, fontWeight: 800 }}>{s.label}</div>
              {sections.length > 1 && (
                <div style={{ display: "flex", fontSize: 21, color: C.muted }}>
                  {nf(s.stems)} шт. · {nf(s.amount)} ₸
                </div>
              )}
            </div>
            <div style={{ display: "flex", flexDirection: "column", border: `2px solid ${C.line}`, borderRadius: 18, overflow: "hidden" }}>
              <div style={{ display: "flex", background: C.soft, padding: "14px 24px" }}>
                <div style={{ ...head, width: COL.n }}>№</div>
                <div style={{ ...head, width: nameW }}>НАИМЕНОВАНИЕ</div>
                <div style={{ ...head, width: COL.qty, justifyContent: "flex-end" }}>КОЛ-ВО</div>
                <div style={{ ...head, width: COL.price, justifyContent: "flex-end" }}>ЦЕНА</div>
                <div style={{ ...head, width: COL.sum, justifyContent: "flex-end" }}>СУММА</div>
              </div>
              {s.lines.map((l, i) => {
                n += 1;
                return (
                  <div key={i} style={{ display: "flex", alignItems: "flex-start", padding: "16px 24px", borderTop: `2px solid ${C.line}` }}>
                    <div style={{ ...cell, width: COL.n, color: C.muted }}>{n}</div>
                    <div style={{ ...cell, width: nameW, fontWeight: 700, lineHeight: 1.3, paddingRight: 12 }}>{glue(l.name)}</div>
                    <div style={{ ...cell, width: COL.qty, justifyContent: "flex-end" }}>{nf(l.quantity)} шт.</div>
                    <div style={{ ...cell, width: COL.price, justifyContent: "flex-end" }}>{nf(l.price)} ₸</div>
                    <div style={{ ...cell, width: COL.sum, justifyContent: "flex-end", fontWeight: 700 }}>{nf(l.amount)} ₸</div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}

        {/* Итого */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: C.accentSoft, borderRadius: 18, padding: "24px 28px", marginTop: 30 }}>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", fontSize: 21, color: C.accent, fontWeight: 700, letterSpacing: 3 }}>ИТОГО ОТГРУЖЕНО</div>
            <div style={{ display: "flex", fontSize: 30, fontWeight: 700, marginTop: 4 }}>{nf(doc.stems)} шт.</div>
          </div>
          <div style={{ display: "flex", fontSize: 50, fontWeight: 800, color: C.accent }}>{nf(doc.amount)} ₸</div>
        </div>

        {doc.restStems > 0 && (
          <div style={{ display: "flex", fontSize: 23, color: C.muted, marginTop: 18 }}>
            Отгружена часть заявки. По заявке осталось отгрузить: {nf(doc.restStems)} шт.
          </div>
        )}

        {/* Подвал */}
        <div style={{ display: "flex", flexDirection: "column", borderTop: `2px solid ${C.line}`, marginTop: 30, paddingTop: 20 }}>
          {doc.shippedBy ? <div style={{ display: "flex", fontSize: 22, color: C.ink }}>Отгрузил склад: {doc.shippedBy}</div> : null}
          <div style={{ display: "flex", fontSize: 20, color: C.muted, marginTop: 8, lineHeight: 1.4 }}>
            Сформировано в CRM Ecoculture автоматически, без подписи и печати. Вопросы по заказу - ответьте на это сообщение.
          </div>
        </div>
      </div>
    ),
    { width: W, height: H, fonts: input.fonts.map((f) => ({ name: f.name, data: f.data, weight: f.weight, style: "normal" as const })) }
  ).arrayBuffer();

  const decoded = PNG.sync.read(Buffer.from(png));
  const height = trimBottom(decoded.data, decoded.width, decoded.height, PAD);
  const out = jpeg.encode({ data: decoded.data.subarray(0, decoded.width * height * 4), width: decoded.width, height }, input.quality ?? 88);
  return Buffer.from(out.data);
}

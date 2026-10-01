import React from "react";
import { ImageResponse } from "next/og";
import { PNG } from "pngjs";
import jpeg from "jpeg-js";
import { catalogPageHeight, type CatalogPage } from "./catalog";

// ---------------------------------------------------------------------------
// Рисует страницу каталога (`catalog.ts`) в JPEG: Satori (`next/og`) даёт PNG,
// `pngjs` + `jpeg-js` перекладывают его в JPEG — владелец просил именно .jpeg,
// а WhatsApp с JPEG обходится бережнее. Светлые тона: сливочный фон, белые
// карточки, фирменный зелёный только на акцентах.
// ---------------------------------------------------------------------------

const W = 1080;
const C = {
  bg: "#FAF7F2",
  card: "#FFFFFF",
  line: "#EDE6DA",
  ink: "#1F2A23",
  muted: "#7C847D",
  accent: "#0F7A52",
  accentSoft: "#E8F3EC",
  chip: "#F6F1E8",
};

const nf = (n: number) => Math.round(n).toLocaleString("ru-RU").replace(/\s/g, " ");

export interface CatalogFont {
  name: string;
  data: ArrayBuffer;
  weight: 400 | 600 | 700 | 800;
}

/**
 * Шрифты для Satori: у @fontsource каждый набор знаков — отдельный файл, и
 * Satori склеивает одинаковые имена, поэтому имена разные: латиница и цифры —
 * «Manrope Latin», кириллица — «Manrope Cyrillic», знак ₸ есть только в Arimo
 * (latin-ext). Читает файлы из node_modules (`next.config.js` кладёт их в
 * функцию — `outputFileTracingIncludes`).
 */
export async function loadCatalogFonts(read: (path: string) => Promise<Buffer>): Promise<CatalogFont[]> {
  const base = "node_modules/@fontsource";
  const list: { name: string; file: string; weight: CatalogFont["weight"] }[] = [];
  for (const w of [400, 700, 800] as const) {
    list.push({ name: "Manrope Latin", file: `${base}/manrope/files/manrope-latin-${w}-normal.woff`, weight: w });
    list.push({ name: "Manrope Cyrillic", file: `${base}/manrope/files/manrope-cyrillic-${w}-normal.woff`, weight: w });
  }
  for (const w of [400, 700] as const) list.push({ name: "Arimo Ext", file: `${base}/arimo/files/arimo-latin-ext-${w}-normal.woff`, weight: w });
  return Promise.all(
    list.map(async (f) => {
      const buf = await read(f.file);
      return { name: f.name, weight: f.weight, data: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer };
    })
  );
}

export async function renderCatalogJpeg(input: {
  page: CatalogPage;
  /** «на 01.10.2026» */
  dateText: string;
  logo: string | null;
  /** Большое фото — data:… или null (тогда мягкая плашка с названием). */
  hero: string | null;
  /** До трёх маленьких фото под прайсом. */
  gallery: string[];
  fonts: CatalogFont[];
  quality?: number;
}): Promise<Buffer> {
  const { page, hero, logo } = input;
  const gallery = input.gallery.slice(0, 3);
  const H = catalogPageHeight(page, gallery.length, !!hero);
  // Без фото — невысокая плашка с названием, а не пустой прямоугольник в полстраницы.
  const heroH = hero ? 560 : 240;
  const png = await new ImageResponse(
    (
      <div style={{ width: W, height: H, display: "flex", flexDirection: "column", background: C.bg, fontFamily: "Manrope Latin, Manrope Cyrillic, Arimo Ext", color: C.ink, padding: "48px 56px" }}>
        {/* Шапка */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", height: 120 }}>
          {logo ? (
            // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
            <img src={logo} width={190} height={110} style={{ objectFit: "contain" }} />
          ) : (
            <div style={{ display: "flex", fontSize: 40, fontWeight: 800 }}>Ecoculture</div>
          )}
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
            <div style={{ display: "flex", fontSize: 22, letterSpacing: 4, color: C.accent, fontWeight: 700 }}>ОПТОВЫЙ КАТАЛОГ</div>
            <div style={{ display: "flex", fontSize: 22, color: C.muted, marginTop: 6 }}>свежий срез · цены {input.dateText}</div>
          </div>
        </div>

        {/* Большое фото с названием цветка */}
        <div style={{ display: "flex", position: "relative", marginTop: 24, height: heroH, borderRadius: 36, overflow: "hidden", background: C.accentSoft }}>
          {hero && (
            // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
            <img src={hero} width={W - 112} height={heroH} style={{ objectFit: "cover", width: W - 112, height: heroH }} />
          )}
          <div
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              bottom: 0,
              display: "flex",
              flexDirection: "column",
              padding: "36px 44px",
              ...(hero ? { backgroundImage: "linear-gradient(to top, rgba(20,30,24,0.55), rgba(20,30,24,0))" } : {}),
            }}
          >
            <div style={{ display: "flex", fontSize: 76, fontWeight: 800, color: hero ? "#FFFFFF" : C.accent }}>{page.title}</div>
            <div style={{ display: "flex", fontSize: 26, color: hero ? "rgba(255,255,255,0.9)" : C.muted, marginTop: 4 }}>
              своя теплица · срез каждый день
            </div>
          </div>
        </div>

        {/* Прайс */}
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginTop: 44, marginBottom: 18 }}>
          <div style={{ display: "flex", fontSize: 38, fontWeight: 800 }}>Цены за стебель</div>
          <div style={{ display: "flex", fontSize: 22, color: C.muted }}>оптом, ₸</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          {page.groups.map((g, i) => (
            <div
              key={i}
              style={{
                display: "flex",
                flexDirection: "column",
                background: C.card,
                border: `2px solid ${C.line}`,
                borderRadius: 28,
                padding: "24px 28px",
                marginBottom: 18,
              }}
            >
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
                <div style={{ display: "flex", fontSize: 28, fontWeight: 700, maxWidth: 760, lineHeight: 1.35 }}>{g.varieties.join(", ")}</div>
                {g.inStock && (
                  <div style={{ display: "flex", alignItems: "center", fontSize: 20, fontWeight: 700, color: C.accent, background: C.accentSoft, borderRadius: 999, padding: "8px 16px", marginLeft: 16 }}>
                    в наличии
                  </div>
                )}
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", marginTop: 14 }}>
                {g.prices.map((p) => (
                  <div key={p.grade} style={{ display: "flex", alignItems: "baseline", background: C.chip, borderRadius: 18, padding: "12px 18px", marginRight: 12, marginTop: 10 }}>
                    <div style={{ display: "flex", fontSize: 22, color: C.muted, marginRight: 10 }}>{p.label}</div>
                    <div style={{ display: "flex", fontSize: 28, fontWeight: 800 }}>{nf(p.price)} ₸</div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Ещё фото из теплицы */}
        {gallery.length > 0 && (
          <div style={{ display: "flex", marginTop: 14 }}>
            {gallery.map((src, i) => (
              <div key={i} style={{ display: "flex", width: (W - 112 - (gallery.length - 1) * 16) / gallery.length, height: 260, borderRadius: 24, overflow: "hidden", marginRight: i < gallery.length - 1 ? 16 : 0 }}>
                {/* eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text */}
                <img src={src} width={(W - 112 - (gallery.length - 1) * 16) / gallery.length} height={260} style={{ objectFit: "cover" }} />
              </div>
            ))}
          </div>
        )}

        {/* Подвал */}
        <div style={{ display: "flex", flexGrow: 1 }} />
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: `2px solid ${C.line}`, paddingTop: 24, marginTop: 24 }}>
          <div style={{ display: "flex", fontSize: 24, fontWeight: 700, color: C.accent }}>Чтобы заказать — ответьте на это сообщение</div>
          <div style={{ display: "flex", fontSize: 22, color: C.muted }}>Ecoculture · своя теплица</div>
        </div>
      </div>
    ),
    { width: W, height: H, fonts: input.fonts.map((f) => ({ name: f.name, data: f.data, weight: f.weight, style: "normal" as const })) }
  ).arrayBuffer();

  const decoded = PNG.sync.read(Buffer.from(png));
  const out = jpeg.encode({ data: decoded.data, width: decoded.width, height: decoded.height }, input.quality ?? 86);
  return Buffer.from(out.data);
}

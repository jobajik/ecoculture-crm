/**
 * JPEG → одностраничный PDF без библиотек: картинка кладётся в файл как есть (фильтр DCTDecode), страница — по её
 * пропорциям при ширине A4. Нужен длинной накладной (`waybill.ts`): высокую картинку WhatsApp сжимает до нечитаемой,
 * а PDF приходит файлом без пересжатия и листается пальцами.
 */
export function jpegToPdf(jpeg: Buffer, width: number, height: number): Buffer {
  const pageW = 595.28;
  const pageH = Math.round(((pageW * height) / width) * 100) / 100;
  const objects: Buffer[] = [];
  const text = (s: string) => Buffer.from(s, "latin1");
  objects.push(text("<< /Type /Catalog /Pages 2 0 R >>"));
  objects.push(text("<< /Type /Pages /Kids [3 0 R] /Count 1 >>"));
  objects.push(text(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageW} ${pageH}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`));
  objects.push(
    Buffer.concat([
      text(`<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`),
      jpeg,
      text("\nendstream"),
    ])
  );
  const draw = `q ${pageW} 0 0 ${pageH} 0 0 cm /Im0 Do Q`;
  objects.push(text(`<< /Length ${draw.length} >>\nstream\n${draw}\nendstream`));

  const parts: Buffer[] = [text("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n")];
  const offsets: number[] = [];
  let pos = parts[0].length;
  objects.forEach((body, i) => {
    offsets.push(pos);
    const chunk = Buffer.concat([text(`${i + 1} 0 obj\n`), body, text("\nendobj\n")]);
    parts.push(chunk);
    pos += chunk.length;
  });
  const xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  parts.push(text(`${xref}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${pos}\n%%EOF\n`));
  return Buffer.concat(parts);
}

/** Ширина и высота JPEG из его заголовка (маркер SOF). Не JPEG — null. */
export function jpegSize(jpeg: Buffer): { width: number; height: number } | null {
  if (jpeg.length < 4 || jpeg[0] !== 0xff || jpeg[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < jpeg.length) {
    if (jpeg[i] !== 0xff) return null;
    const marker = jpeg[i + 1];
    const len = jpeg.readUInt16BE(i + 2);
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return { height: jpeg.readUInt16BE(i + 5), width: jpeg.readUInt16BE(i + 7) };
    i += 2 + len;
  }
  return null;
}

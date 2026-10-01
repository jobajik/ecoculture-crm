// ---------------------------------------------------------------------------
// Картинка в браузере перед загрузкой: ужать до 1600 px и JPEG — WhatsApp всё
// равно пережмёт, а таблице (вкладка WaFiles) лишний мегабайт ни к чему.
// Только для компонентов в браузере: здесь document и FileReader.
// ---------------------------------------------------------------------------

export function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || ""));
    r.onerror = () => reject(new Error("Файл не прочитался"));
    r.readAsDataURL(file);
  });
}

/**
 * `force` — перекладывать в JPEG всегда (фото для каталога: его рисовальщик
 * понимает только JPEG и PNG), иначе — только тяжёлые картинки.
 */
export async function shrinkImage(file: File, force = false, maxSide = 1600): Promise<{ blob: Blob; name: string; mime: string }> {
  if (!file.type.startsWith("image/") || (!force && file.size < 700_000)) return { blob: file, name: file.name, mime: file.type };
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("Картинка не открылась"));
      i.src = url;
    });
    const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    canvas.getContext("2d")?.drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Картинка не сжалась"))), "image/jpeg", 0.85)
    );
    return { blob, name: file.name.replace(/\.[^.]+$/, "") + ".jpg", mime: "image/jpeg" };
  } finally {
    URL.revokeObjectURL(url);
  }
}

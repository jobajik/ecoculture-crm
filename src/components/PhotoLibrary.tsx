"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { uploadFilePartAction } from "@/app/clients/broadcasts/actions";
import { savePhotoAction, suggestCaptionAction, updatePhotoAction } from "@/app/clients/broadcasts/photos/actions";
import { unwrap, unwrapValue } from "@/lib/actionResult";
import { readAsDataUrl, shrinkImage } from "@/lib/imageShrink";
import { MAX_PHOTO_CAPTION } from "@/lib/botPhotos";
import { formatMoment } from "@/lib/formatDate";
import Section from "@/components/Section";

/**
 * Фото для клиентов: загрузить (ужимается в браузере в JPEG), указать цветок,
 * подпись предлагает ИИ — человек правит. Ниже — все фото: подпись правится,
 * фото выключается из ротации. Цену в подпись не пишем — бот допишет из прайса.
 */

const PART_CHARS = 600_000;

type PhotoRow = {
  photoId: string;
  url: string;
  label: string;
  caption: string;
  active: boolean;
  sentCount: number;
  lastSentAt: string;
};

type Flower = { key: string; label: string; varieties: string[]; grades: { key: string; label: string }[] };

export default function PhotoLibrary({ photos, flowers, aiReady }: { photos: PhotoRow[]; flowers: Flower[]; aiReady: boolean }) {
  const router = useRouter();
  const [file, setFile] = useState<{ id: string; name: string; preview: string } | null>(null);
  const [flower, setFlower] = useState("");
  const [variety, setVariety] = useState("");
  const [grade, setGrade] = useState("");
  const [caption, setCaption] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const f = flowers.find((x) => x.key === flower);

  async function onFile(input: File | null) {
    setError(null);
    setNote(null);
    setFile(null);
    if (!input) return;
    if (!input.type.startsWith("image/")) {
      setError("Нужна фотография (JPG, PNG)");
      return;
    }
    try {
      setBusy("Готовлю фото…");
      const prepared = await shrinkImage(input, true);
      if (prepared.blob.size > 5 * 1024 * 1024) throw new Error("Фото больше 5 МБ — уменьшите");
      const dataUrl = await readAsDataUrl(prepared.blob);
      const base64 = dataUrl.split(",")[1] || "";
      let fileId = "";
      let offset = 0;
      const parts = Math.ceil(base64.length / PART_CHARS);
      for (let i = 0; i < parts; i++) {
        setBusy(`Загружаю ${Math.round((i / parts) * 100)} %…`);
        const r = unwrapValue(
          await uploadFilePartAction({
            fileId,
            name: prepared.name,
            mime: prepared.mime,
            size: prepared.blob.size,
            partOffset: offset,
            data: base64.slice(i * PART_CHARS, (i + 1) * PART_CHARS),
          })
        );
        fileId = r.fileId;
        offset = r.nextOffset;
      }
      setFile({ id: fileId, name: prepared.name, preview: dataUrl });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Фото не загрузилось");
    } finally {
      setBusy("");
    }
  }

  async function suggest(nextFlower = flower, nextVariety = variety, nextGrade = grade) {
    if (!nextFlower || !aiReady) return;
    setError(null);
    setBusy("ИИ пишет подпись…");
    try {
      const r = unwrapValue(await suggestCaptionAction({ flowerType: nextFlower, variety: nextVariety, grade: nextGrade }));
      setCaption(r.caption);
    } catch (e) {
      setError(e instanceof Error ? e.message : "ИИ не ответил");
    } finally {
      setBusy("");
    }
  }

  function save() {
    if (!file) return;
    setError(null);
    startTransition(async () => {
      try {
        unwrapValue(await savePhotoAction({ fileId: file.id, fileName: file.name, flowerType: flower, variety, grade, caption }));
        setFile(null);
        setCaption("");
        setNote("Фото добавлено в ротацию.");
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Не сохранилось");
      }
    });
  }

  const select = "input !w-auto !py-1.5 text-sm";
  const active = photos.filter((p) => p.active).length;

  return (
    <>
      <Section tone="leads" icon="upload" title="Добавить фото">
        <div className="grid gap-4 md:grid-cols-[220px_1fr]">
          <div>
            {file ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={file.preview} alt="" className="aspect-square w-full rounded-xl object-cover" />
            ) : (
              <label className="flex aspect-square w-full cursor-pointer items-center justify-center rounded-xl border-2 border-dashed border-line-strong text-center text-sm text-ink-muted hover:border-accent">
                <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => onFile(e.target.files?.[0] ?? null)} />
                {busy || "Выбрать фото"}
              </label>
            )}
          </div>
          <div className="space-y-3 text-sm">
            <div className="flex flex-wrap gap-2">
              <select
                className={select}
                value={flower}
                onChange={(e) => {
                  setFlower(e.target.value);
                  setVariety("");
                  setGrade("");
                  if (!caption) void suggest(e.target.value, "", "");
                }}
              >
                <option value="">Цветок…</option>
                {flowers.map((x) => (
                  <option key={x.key} value={x.key}>
                    {x.label}
                  </option>
                ))}
              </select>
              <select className={select} value={variety} disabled={!f} onChange={(e) => setVariety(e.target.value)}>
                <option value="">сорт — любой</option>
                {(f?.varieties ?? []).map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
              <select className={select} value={grade} disabled={!f} onChange={(e) => setGrade(e.target.value)}>
                <option value="">категория — любая</option>
                {(f?.grades ?? []).map((g) => (
                  <option key={g.key} value={g.key}>
                    {g.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <div className="flex items-center justify-between">
                <span className="label">Продающая подпись (без цены — её бот допишет из прайса)</span>
                {aiReady && (
                  <button type="button" className="text-accent hover:underline disabled:opacity-50" disabled={!flower || !!busy} onClick={() => suggest()}>
                    {caption ? "Другой вариант от ИИ" : "Предложить ИИ"}
                  </button>
                )}
              </div>
              <textarea
                className="input min-h-[90px]"
                maxLength={MAX_PHOTO_CAPTION}
                value={caption}
                placeholder="Например: Свежий срез Altaj — крупный плотный бутон, стоит в вазе до трёх недель."
                onChange={(e) => setCaption(e.target.value)}
              />
            </div>
            {busy && file && <div className="text-ink-muted">{busy}</div>}
            {error && <div className="text-status-critical">{error}</div>}
            {note && <div className="text-status-good">{note}</div>}
            <div className="flex gap-2">
              <button type="button" className="btn-primary" disabled={!file || !flower || pending} onClick={save}>
                {pending ? "Сохраняю…" : "Добавить в ротацию"}
              </button>
              {file && (
                <button type="button" className="btn-secondary" onClick={() => setFile(null)}>
                  Другое фото
                </button>
              )}
            </div>
          </div>
        </div>
      </Section>

      <Section tone="leads" icon="list" title={`Фото в ротации: ${active}`} aside={<span className="text-xs text-ink-muted">реже отправленное уходит первым</span>}>
        {photos.length === 0 ? (
          <p className="text-sm text-ink-muted">Пока ни одного фото. Пока их нет, бот дожимает текстом, а в каталоге — плашка с названием цветка.</p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {photos.map((p) => (
              <PhotoCard key={p.photoId} photo={p} />
            ))}
          </div>
        )}
      </Section>
    </>
  );
}

function PhotoCard({ photo }: { photo: PhotoRow }) {
  const router = useRouter();
  const [caption, setCaption] = useState(photo.caption);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const changed = caption.trim() !== photo.caption.trim();

  function update(changes: { caption?: string; active?: boolean }) {
    setError(null);
    startTransition(async () => {
      try {
        unwrap(await updatePhotoAction(photo.photoId, changes));
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Не сохранилось");
      }
    });
  }

  return (
    <div className={clsx("space-y-2 rounded-xl border border-line-hairline p-2", !photo.active && "opacity-60")}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={photo.url} alt={photo.label} loading="lazy" className="aspect-[4/3] w-full rounded-lg object-cover" />
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium">{photo.label}</span>
        <button type="button" className="text-xs text-ink-secondary hover:underline" disabled={pending} onClick={() => update({ active: !photo.active })}>
          {photo.active ? "выключить" : "включить"}
        </button>
      </div>
      <textarea className="input min-h-[70px] text-sm" maxLength={MAX_PHOTO_CAPTION} value={caption} onChange={(e) => setCaption(e.target.value)} />
      <div className="flex items-center justify-between text-xs text-ink-muted">
        <span>
          {photo.active ? "в ротации" : "выключено"} · отправлено {photo.sentCount}
          {photo.lastSentAt ? ` · ${formatMoment(photo.lastSentAt)}` : ""}
        </span>
        {changed && (
          <button type="button" className="text-accent hover:underline" disabled={pending} onClick={() => update({ caption })}>
            Сохранить подпись
          </button>
        )}
      </div>
      {error && <div className="text-xs text-status-critical">{error}</div>}
    </div>
  );
}

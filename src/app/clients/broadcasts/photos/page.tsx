import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { FLOWER_TYPE_LABELS, GRADES_BY_FLOWER_TYPE, ROLES, formatGrade } from "@/lib/constants";
import { prefetchTables, SHEET_TABS } from "@/lib/sheets";
import { listBotPhotos } from "@/lib/repo/botPhotos";
import { listVarietiesByType } from "@/lib/repo/varieties";
import { getCurrentPrices } from "@/lib/repo/prices";
import { localDayKey } from "@/lib/timezone";
import { catalogFlowers } from "@/lib/catalog";
import { photoLabel } from "@/lib/botPhotos";
import { catalogFileName, photoFileUrl, siteUrl } from "@/lib/catalogFiles";
import { publicCatalogUrl } from "@/lib/waFileSign";
import { openAiConfigured } from "@/lib/openai";
import PageHeader from "@/components/PageHeader";
import Section from "@/components/Section";
import PhotoLibrary from "@/components/PhotoLibrary";
import { clientsTabsFor } from "../../tabs";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * «Фото и каталог»: живой каталог JPEG по цветам (`/api/catalog/<цветок>`) и
 * фото для клиентов — загрузка, подпись от ИИ, включить/выключить. Только
 * админ и РОП, как и рассылки.
 */
export default async function PhotosPage() {
  const session = await getServerSession(authOptions);
  const role = session?.user?.role;
  if (role !== ROLES.ADMIN && role !== ROLES.SALES_HEAD) redirect("/clients");

  await prefetchTables([SHEET_TABS.BOT_PHOTOS, SHEET_TABS.VARIETIES, SHEET_TABS.PRICE_HISTORY]);
  const [photos, varieties, prices] = await Promise.all([listBotPhotos(), listVarietiesByType(), getCurrentPrices(localDayKey())]);
  const site = siteUrl();
  const now = new Date();
  const catalog = catalogFlowers(prices).map((f) => ({
    flowerType: f,
    title: FLOWER_TYPE_LABELS[f] ?? f,
    url: publicCatalogUrl(site, f, now),
    download: publicCatalogUrl(site, f, now, true),
    fileName: catalogFileName(f),
  }));
  const list = [...photos]
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .map((p) => ({
      photoId: p.photoId,
      url: photoFileUrl(p),
      label: photoLabel(p),
      caption: p.caption,
      active: p.active,
      sentCount: p.sentCount,
      lastSentAt: p.lastSentAt,
    }));
  const flowers = Object.keys(FLOWER_TYPE_LABELS).map((f) => ({
    key: f,
    label: FLOWER_TYPE_LABELS[f],
    varieties: varieties[f] ?? [],
    grades: (GRADES_BY_FLOWER_TYPE[f] ?? []).map((g) => ({ key: g, label: formatGrade(g) })),
  }));

  return (
    <div className="space-y-6">
      <PageHeader
        area="leads"
        title="Фото и каталог"
        tabs={clientsTabsFor(undefined, role)}
        actions={
          <Link href="/clients/broadcasts" className="text-sm text-ink-secondary hover:underline">
            ← рассылки
          </Link>
        }
      />
      <Section tone="leads" icon="list" title="Каталог JPEG" aside={<span className="text-xs text-ink-muted">цены и наличие — на момент открытия</span>}>
        {catalog.length === 0 ? (
          <p className="text-sm text-ink-muted">В прайсе нет цен — каталог появится, когда РОП заполнит прайс.</p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-3">
            {catalog.map((c) => (
              <div key={c.flowerType} className="space-y-2">
                <a href={c.url} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-xl border border-line-hairline bg-surface-plane">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={c.url} alt={`Каталог: ${c.title}`} loading="lazy" className="block w-full" />
                </a>
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium">{c.title}</span>
                  <a href={c.download} className="text-accent hover:underline">
                    Скачать JPEG
                  </a>
                </div>
              </div>
            ))}
          </div>
        )}
        <p className="mt-3 text-xs text-ink-muted">
          Бот присылает его сам, когда клиент просит каталог или фото. В рассылке — «Каталог JPEG» в поле картинки. Фото на странице цветка — последние загруженные
          ниже.
        </p>
      </Section>
      <PhotoLibrary photos={list} flowers={flowers} aiReady={openAiConfigured()} />
    </div>
  );
}

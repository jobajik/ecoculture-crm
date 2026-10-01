import { getCurrentPrices } from "./repo/prices";
import { localDayKey } from "./timezone";
import { catalogFlowers } from "./catalog";
import { publicCatalogUrl, publicFileUrl } from "./waFileSign";
import type { BotPhoto } from "./botPhotos";

/** Основной адрес сайта: по нему Green API скачивает картинки. */
export const siteUrl = () => (process.env.NEXTAUTH_URL || "https://www.crm-ecoculture.kz").replace(/\/+$/, "");

const FILE_NAMES: Record<string, string> = {
  chrysanthemum: "Ecoculture-katalog-hrizantema.jpg",
  rose: "Ecoculture-katalog-roza.jpg",
  eustoma: "Ecoculture-katalog-eustoma.jpg",
};

export const catalogFileName = (flowerType: string) => FILE_NAMES[flowerType] ?? `Ecoculture-katalog-${flowerType}.jpg`;

/**
 * Страницы каталога для отправки: один цветок или все, у которых есть цены.
 * Ссылки подписаны — Green API скачивает их без входа в CRM.
 */
export async function catalogFiles(flowerType = ""): Promise<{ url: string; name: string; flowerType: string }[]> {
  const flowers = catalogFlowers(await getCurrentPrices(localDayKey()));
  const list = flowerType && flowers.includes(flowerType) ? [flowerType] : flowers;
  return list.map((f) => ({ url: publicCatalogUrl(siteUrl(), f), name: catalogFileName(f), flowerType: f }));
}

export const photoFileUrl = (p: Pick<BotPhoto, "fileId" | "fileName">) => publicFileUrl(siteUrl(), p.fileId, p.fileName || "photo.jpg");

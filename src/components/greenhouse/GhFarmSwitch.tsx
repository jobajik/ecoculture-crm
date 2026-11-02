import RememberGhFarm from "./RememberGhFarm";

/**
 * Компания на страницах «Теплицы». С 02.11.2026 переключателя здесь нет: владелец разделил теплицы на два раздела меню
 * («Теплица Rose Farm», «Теплица Есентай»), и компанию выбирает пункт меню, а название стоит в шапке страницы.
 * Остаётся невидимая часть — запомнить компанию и сообщить её меню (`RememberGhFarm`). `href` и `locked` больше не
 * нужны, но страницы их передают — оставлены, чтобы не править семь мест ради ничего.
 */
export default function GhFarmSwitch({ farm }: { farm: string; href?: (farm: string) => string; locked?: boolean }) {
  return <RememberGhFarm farm={farm} />;
}

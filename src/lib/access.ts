/**
 * Кто куда может заходить — ОДНА таблица на middleware и на API.
 *
 * Раньше таблица жила только в middleware, а API-маршруты держали свои списки
 * ролей — и они разошлись: в раздел «Продажи» РОПа и бухгалтера пускали, а
 * данные для смены периода (`/api/sales`) им отдавали отказом 403. Страница
 * открывалась, а переключатель «неделя / месяц» молча не работал.
 *
 * Порядок строк важен: выигрывает первая, чей префикс подходит, поэтому более
 * узкие адреса стоят выше общих (`/finance/claims` выше `/finance`).
 * Модуль без зависимостей — он работает и в middleware (edge), и на сервере.
 */
export const ROLE_ACCESS: { prefix: string; roles: string[] }[] = [
  // Собственная розница. Менеджеры розницы живут в своём разделе и в заявках;
  // клиентская база, деньги, планы и склад им не нужны и закрыты.
  // Зав. складом производства сюда пускаем ради вкладки «Регионы»: пока
  // заявки по Астане, Семею и Усть-Каменогорску заводит она. Что именно ей
  // видно внутри раздела, решают вкладки (`retailTabsFor`) и сами страницы.
  {
    prefix: "/retail",
    roles: ["retail_almaty", "retail_regions", "sales_head", "admin", "warehouse"],
  },
  // РОП заводит оптовые заявки в регионы — так решил владелец. Заявки по
  // Алматы остаются у менеджеров, и это проверяется не здесь, а в самом
  // действии: у региональной заявки обязано быть направление.
  {
    prefix: "/orders/new",
    roles: ["manager", "retail_almaty", "retail_regions", "admin", "warehouse", "sales_head"],
  },
  { prefix: "/warehouse", roles: ["warehouse", "admin"] },
  // Рекламацию заводит менеджер, а решение по ней видит у бухгалтера. Раньше
  // весь /finance был закрыт от менеджера, и он не мог узнать, чем кончилась
  // его же жалоба, хотя страница /finance/claims его пускала.
  { prefix: "/finance/claims", roles: ["accountant", "manager", "sales_head", "admin"] },
  // Удержания с сотрудников и журнал действий бухгалтера — не про продажи:
  // первое кадровое, второе служебное. РОПу они не нужны, и правила стоят ВЫШЕ
  // общего «/finance», потому что совпадение ищется по первому подходящему.
  { prefix: "/finance/takeouts", roles: ["accountant", "admin"] },
  { prefix: "/finance/log", roles: ["accountant", "admin"] },
  // РОП видит оплаты, долги и отчёт — но ничего в них не меняет: право смотреть
  // и право трогать разведены (`src/lib/financeAccess.ts`). Так попросил
  // владелец: «просто чтобы видела долги и прочее».
  { prefix: "/finance", roles: ["accountant", "admin", "sales_head"] },
  // РОП по замыслу видит продажи — их же он и планирует. В списке его не было,
  // и middleware разворачивал его с собственного раздела.
  { prefix: "/sales", roles: ["manager", "sales_head", "admin", "accountant"] },
  { prefix: "/prices", roles: ["manager", "sales_head", "admin"] },
  { prefix: "/plans", roles: ["sales_head", "admin"] },
  { prefix: "/forecast", roles: ["agronomist", "admin"] },
  // Агроном отвечает за срезку, а не за деньги: заявки и аналитика хозяйства
  // ему не нужны, а видел он их целиком по обоим производствам.
  {
    prefix: "/orders",
    roles: [
      "manager",
      "warehouse",
      "accountant",
      "sales_head",
      "admin",
      "retail_almaty",
      "retail_regions",
    ],
  },
  { prefix: "/analytics", roles: ["manager", "warehouse", "accountant", "sales_head", "admin"] },
  // Карточка магазина — та же карточка клиента, и держать её вторую копию в
  // разделе розницы значило бы чинить потом обе. Список клиентов менеджеру
  // розницы всё равно не показывается: страница разворачивает его в «Розницу».
  {
    prefix: "/clients",
    roles: [
      "manager",
      "sales_head",
      "accountant",
      "admin",
      "retail_almaty",
      "retail_regions",
    ],
  },
  { prefix: "/admin", roles: ["admin"] },
];

export function accessRuleFor(path: string): { prefix: string; roles: string[] } | undefined {
  return ROLE_ACCESS.find((r) => path.startsWith(r.prefix));
}

/** Пустит ли middleware эту роль на этот адрес. Админ — везде; без роли — никуда. */
export function canOpen(role: string | null | undefined, path: string): boolean {
  if (!role) return false;
  if (role === "admin") return true;
  const rule = accessRuleFor(path);
  return !rule || rule.roles.includes(role);
}

/**
 * Зав. складом или агроном без производства в карточке.
 *
 * Действия склада таким отказывают давно (грабли 1.10), а ЧТЕНИЕ — нет: пустое
 * производство означало «все производства», и человек со строкой, где забыли
 * дописать `Farm`, видел остатки и лист сборки обоих хозяйств. Ошибка в таблице
 * должна закрывать доступ, а не открывать. Роли перечислены здесь же, а не
 * взяты из constants.ts: модуль работает и в middleware.
 */
export function missingFarm(role: string | null | undefined, farm: string | null | undefined): boolean {
  return (role === "warehouse" || role === "agronomist") && !String(farm ?? "").trim();
}

export const MISSING_FARM_MESSAGE =
  "В вашей карточке сотрудника не указано производство — склад и прогноз закрыты. " +
  "Попросите администратора указать его в «Настройках».";

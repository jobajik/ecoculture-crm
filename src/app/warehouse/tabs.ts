/**
 * Вкладки раздела «Склад».
 *
 * Порядок — как идёт день: сначала отгрузить то, что готово, потом собрать
 * заявку дня, потом принять срезку и разобраться с партиями. «Выдачи
 * сотрудникам» в конце: их записывают по поводу, а не каждое утро.
 */
export const WAREHOUSE_TABS = [
  { href: "/warehouse", label: "Очередь на отгрузку" },
  { href: "/warehouse/picklist", label: "Заявка на день" },
  { href: "/warehouse/receive", label: "Приёмка" },
  { href: "/warehouse/batches", label: "Партии" },
  { href: "/warehouse/takeouts", label: "Выдачи сотрудникам" },
];

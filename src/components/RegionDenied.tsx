import PageHeader from "./PageHeader";

/** Раздел города открыл тот, кому он не положен (менеджер другого города или без города). Без «use client». */
export default function RegionDenied({ city }: { city: string }) {
  return (
    <div>
      <PageHeader area="stock" title={city} icon="store" />
      <p className="card text-sm text-ink-secondary">
        Раздел «{city}» ведёт директор этого региона — у вас его нет. Если это ошибка, попросите администратора назначить вас в «Настройках».
      </p>
    </div>
  );
}

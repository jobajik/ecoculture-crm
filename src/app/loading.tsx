/**
 * Что видно, пока страница загружается.
 *
 * Данные идут из Google-таблицы, и на телефоне страница открывается секунду-
 * две. Без этого экрана нажатие выглядело так, будто ничего не произошло, и
 * люди жали ещё раз — а повторное нажатие на кнопку действия и есть тот самый
 * двойной платёж или двойная отгрузка. Серые полосы на месте будущих блоков
 * говорят «уже открываю». Анимация отключается у тех, кто её отключил в системе.
 */
export default function Loading() {
  return (
    <div className="space-y-4 animate-pulse motion-reduce:animate-none" aria-busy="true" aria-live="polite">
      <span className="sr-only">Загрузка…</span>
      <div className="h-6 w-48 rounded bg-surface-sunk" />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-20 rounded-xl bg-surface-sunk" />
        ))}
      </div>
      <div className="h-40 rounded-xl bg-surface-sunk" />
      <div className="h-24 rounded-xl bg-surface-sunk" />
    </div>
  );
}

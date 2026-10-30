"use client";

/** «Печать / PDF»: браузер печатает страницу или сохраняет её в PDF — меню и кнопки помечены no-print. */
export default function PrintButton({ label = "Печать / PDF" }: { label?: string }) {
  return (
    <button type="button" className="btn-secondary !py-1.5 text-sm whitespace-nowrap" onClick={() => window.print()}>
      {label}
    </button>
  );
}

/**
 * Небольшой набор значков для заголовков разделов. Свои, а не библиотека: их
 * десяток, и тащить ради них пакет незачем. Рисуются линией в цвет текста
 * (`currentColor`), поэтому красятся тем же классом, что и подпись рядом.
 * Без "use client" — годится и серверным страницам.
 */
export type IconName =
  | "order"
  | "client"
  | "phone"
  | "calendar"
  | "box"
  | "wallet"
  | "alert"
  | "truck"
  | "route"
  | "note"
  | "arrow"
  | "clock"
  | "chart"
  | "card";

const PATHS: Record<IconName, string> = {
  order: "M7 3h7l5 5v13H7z M14 3v5h5 M10 12h6 M10 16h6",
  client: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M4 21c0-4 3.6-6 8-6s8 2 8 6",
  phone: "M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z",
  calendar: "M4 6h16v15H4z M4 10h16 M8 3v4 M16 3v4",
  box: "M3 7l9-4 9 4-9 4z M3 7v10l9 4 9-4V7 M12 11v10",
  wallet: "M3 7h15a3 3 0 0 1 3 3v8a2 2 0 0 1-2 2H3z M3 7l12-4v4 M16 14h2",
  alert: "M12 3l10 18H2z M12 10v5 M12 18v.5",
  truck: "M3 6h11v10H3z M14 10h4l3 3v3h-7 M7 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4z M17 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4z",
  route: "M6 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4z M18 9a2 2 0 1 0 0-4 2 2 0 0 0 0 4z M8 17h6a3 3 0 0 0 0-6h-4a3 3 0 0 1 0-6h6",
  note: "M5 4h14v12l-4 4H5z M15 20v-4h4 M8 9h8 M8 13h5",
  arrow: "M5 12h14 M13 6l6 6-6 6",
  clock: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z M12 7v5l3 2",
  chart: "M4 20V10 M10 20V4 M16 20v-7 M22 20H2",
  card: "M3 6h18v12H3z M3 10h18 M7 15h4",
};

export default function Icon({ name, className = "w-4 h-4" }: { name: IconName; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}

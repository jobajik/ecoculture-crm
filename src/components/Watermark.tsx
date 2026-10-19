import Image from "next/image";
import clsx from "clsx";

/**
 * Соцветие Ecoculture бледным водяным знаком в углу карточки-«лица» документа: заявка, клиент, отгрузка, касса.
 * Так было в первом фирменном виде (сентябрь: «на заказ использовать специальный шрифт и оформление») и владелец
 * попросил вернуть именно туда, а не в меню (19.10.2026: «внизу колонки как раз некрасиво… в заявках, в оплатах, в
 * складе, где уникальный номер заявки»). Родитель должен быть `relative overflow-hidden`. Без "use client".
 */
export default function Watermark({ className, size = "md" }: { className?: string; size?: "sm" | "md" }) {
  return (
    <Image
      src="/logo-mark.png"
      alt=""
      aria-hidden="true"
      width={180}
      height={180}
      className={clsx(
        "absolute object-contain opacity-[0.12] pointer-events-none select-none",
        size === "md" ? "-right-12 -bottom-14 w-44 h-44" : "-right-8 -top-8 w-28 h-28",
        className
      )}
    />
  );
}

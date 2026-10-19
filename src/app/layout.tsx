import type { Metadata } from "next";
// Шрифт Arimo подключён локально (пакет @fontsource/arimo), а не с Google Fonts:
// так интерфейс не зависит от внешней сети ни при сборке, ни у пользователя.
import "@fontsource/arimo/400.css";
import "@fontsource/arimo/500.css";
import "@fontsource/arimo/600.css";
import "@fontsource/arimo/700.css";
// Manrope — только для «лица» документа (номер заявки, клиент, суммы): tailwind `font-display`.
import "@fontsource/manrope/600.css";
import "@fontsource/manrope/700.css";
import "@fontsource/manrope/800.css";
import "./globals.css";
import Providers from "./providers";
import Nav from "@/components/Nav";
import MobileNav from "@/components/MobileNav";
import NavProgress from "@/components/NavProgress";
import { Suspense } from "react";

export const metadata: Metadata = {
  title: "Ecoculture-CRM",
  description: "Приём заявок, отгрузка и остатки цветка: розы, хризантемы, эустома",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <body className="min-h-screen font-sans antialiased">
        <Providers>
          {/* Suspense — потому что полоска читает адрес (useSearchParams), а
              такие компоненты без него ломают сборку статичных страниц. */}
          <Suspense fallback={null}>
            <NavProgress />
          </Suspense>
          {/* Новый вид (19.10.2026, образец владельца): меню колонкой слева на компьютере (Nav), на телефоне —
              полоска с ☰ и выезжающее меню (MobileNav). Серый холст, белые карточки. Каркас один и тот же со
              входом и без — иначе страница перерисовывалась бы целиком, когда подгрузится вход. */}
          <div className="lg:flex min-h-screen">
            <Nav />
            <div className="flex-1 min-w-0">
              <MobileNav />
              <main className="w-full px-4 sm:px-6 lg:px-8 py-5 sm:py-6">
                {children}
              </main>
            </div>
          </div>
        </Providers>
      </body>
    </html>
  );
}

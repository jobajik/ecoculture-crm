import type { Metadata } from "next";
// Шрифт Arimo подключён локально (пакет @fontsource/arimo), а не с Google Fonts:
// так интерфейс не зависит от внешней сети ни при сборке, ни у пользователя.
import "@fontsource/arimo/400.css";
import "@fontsource/arimo/500.css";
import "@fontsource/arimo/600.css";
import "@fontsource/arimo/700.css";
import "./globals.css";
import Providers from "./providers";
import Nav from "@/components/Nav";

export const metadata: Metadata = {
  title: "Ecoculture-CRM",
  description: "Приём заявок, отгрузка и остатки цветка: розы, хризантемы, эустома",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <body className="min-h-screen font-sans antialiased">
        <Providers>
          <Nav />
          <main className="max-w-6xl mx-auto px-4 sm:px-6 py-7">{children}</main>
        </Providers>
      </body>
    </html>
  );
}

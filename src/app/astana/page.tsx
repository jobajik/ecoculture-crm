import { redirect } from "next/navigation";

/** «Склад Астаны» с 17.11.2026 — один из городов раздела «Регионы»; старый адрес уводит туда. */
export default function AstanaRedirect() {
  redirect("/region/astana");
}

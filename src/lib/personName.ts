/**
 * Как звать человека на экране.
 *
 * В заявке хранится почта — она ключ, и это правильно. Но читает таблицу
 * человек, и «rop@ecoculture.kz» в колонке «Менеджер» ему ничего не говорит:
 * фамилию он знает, почту — нет. Имя лежит во вкладке `Users`, и подставлять
 * его нужно везде одинаково, иначе на одной странице будет имя, а на соседней
 * почта — и покажется, что это два разных человека.
 *
 * Если имя не заполнено, показываем почту как есть: выдумывать имя из адреса
 * («rop») хуже, чем честный адрес, — по адресу хотя бы понятно, кого искать в
 * таблице сотрудников.
 */
export type NameByEmail = Record<string, string>;

export function nameIndex(
  users: { email: string; name: string }[]
): NameByEmail {
  const index: NameByEmail = {};
  for (const u of users) {
    const key = (u.email || "").trim().toLowerCase();
    const name = (u.name || "").trim();
    if (key && name) index[key] = name;
  }
  return index;
}

export function personName(email: string, names: NameByEmail = {}): string {
  const key = (email || "").trim().toLowerCase();
  if (!key) return "—";
  return names[key] || email;
}

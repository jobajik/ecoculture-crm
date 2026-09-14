/**
 * Кого можно заводить и кем становиться.
 *
 * Здесь проверяется самое опасное место новой формы: возможность запереть себя
 * снаружи. Роль решает, что человек видит и что может, и ошибка в этой форме
 * стоит не «некрасиво», а «настройки больше никому не открыть».
 */
import { staffSaveRefusal, cleanStaff, staffChangeSummary, type StaffDraft } from "../src/lib/staffRules";
import { ROLES, FARMS } from "../src/lib/constants";
import { shelfLifeRefusal, shelfLifeValues } from "../src/lib/shelfLifeRules";
import type { AppUser } from "../src/lib/types";

let fails = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) fails += 1;
  console.log(
    `${ok ? "OK  " : "ПЛОХО"} ${name}: ${JSON.stringify(actual)}${
      ok ? "" : ` (ждали ${JSON.stringify(expected)})`
    }`
  );
}
/** Отказ есть — и он не пустой. Текст сравнивать целиком не будем. */
function refuses(name: string, refusal: string) {
  const ok = refusal.length > 0;
  if (!ok) fails += 1;
  console.log(`${ok ? "OK  " : "ПЛОХО"} ${name}: ${ok ? refusal : "разрешено, а не должно"}`);
}
function allows(name: string, refusal: string) {
  const ok = refusal === "";
  if (!ok) fails += 1;
  console.log(`${ok ? "OK  " : "ПЛОХО"} ${name}${ok ? "" : `: отказ «${refusal}»`}`);
}

const user = (p: Partial<AppUser> & { email: string }): AppUser => ({
  name: "Кто-то",
  role: ROLES.MANAGER,
  farm: null,
  active: true,
  ...p,
});

const draft = (p: Partial<StaffDraft> & { email: string }): StaffDraft => ({
  name: "Новый Человек",
  role: ROLES.MANAGER,
  farm: "",
  active: true,
  ...p,
});

const OWNER = "vladelec@ecoculture.kz";
const SECOND_ADMIN = "vtoroy@ecoculture.kz";

const base: AppUser[] = [
  user({ email: OWNER, name: "Владелец", role: ROLES.ADMIN }),
  user({ email: "emil@ecoculture.kz", name: "Эмиль", role: ROLES.MANAGER }),
  user({ email: "sklad@ecoculture.kz", name: "Разия", role: ROLES.WAREHOUSE, farm: FARMS.ROSE_FARM }),
];

const asOwner = (users: AppUser[] = base) => ({
  actorRole: ROLES.ADMIN,
  actorEmail: OWNER,
  users,
});

// --- Кто вообще может --------------------------------------------------------
refuses(
  "менеджер сотрудников не заводит",
  staffSaveRefusal(
    { actorRole: ROLES.MANAGER, actorEmail: "emil@ecoculture.kz", users: base },
    draft({ email: "novyy@ecoculture.kz" })
  )
);
refuses(
  "РОП тоже не заводит — роли это не её зона",
  staffSaveRefusal(
    { actorRole: ROLES.SALES_HEAD, actorEmail: "rop@ecoculture.kz", users: base },
    draft({ email: "novyy@ecoculture.kz" })
  )
);
refuses(
  "без роли вовсе — тем более",
  staffSaveRefusal(
    { actorRole: undefined, actorEmail: "", users: base },
    draft({ email: "novyy@ecoculture.kz" })
  )
);

// --- Что обязательно ---------------------------------------------------------
allows("админ заводит менеджера", staffSaveRefusal(asOwner(), draft({ email: "novyy@ecoculture.kz" })));
refuses("без почты нельзя", staffSaveRefusal(asOwner(), draft({ email: "  " })));
refuses("почта должна быть похожа на почту", staffSaveRefusal(asOwner(), draft({ email: "не почта" })));
refuses(
  "без имени нельзя — иначе в списках будет почта",
  staffSaveRefusal(asOwner(), draft({ email: "novyy@ecoculture.kz", name: "   " }))
);
refuses(
  "без роли нельзя — пустая роль не пускает никуда",
  staffSaveRefusal(asOwner(), draft({ email: "novyy@ecoculture.kz", role: "" }))
);
refuses(
  "выдуманной роли не существует",
  staffSaveRefusal(asOwner(), draft({ email: "novyy@ecoculture.kz", role: "nachalnik" }))
);

// --- Производство ------------------------------------------------------------
refuses(
  "зав. складом без производства — пустой склад",
  staffSaveRefusal(asOwner(), draft({ email: "sklad2@ecoculture.kz", role: ROLES.WAREHOUSE, farm: "" }))
);
refuses(
  "агроном без производства — тоже",
  staffSaveRefusal(asOwner(), draft({ email: "agro@ecoculture.kz", role: ROLES.AGRONOMIST, farm: "" }))
);
refuses(
  "выдуманного производства не существует",
  staffSaveRefusal(
    asOwner(),
    draft({ email: "sklad2@ecoculture.kz", role: ROLES.WAREHOUSE, farm: "teplica_3" })
  )
);
allows(
  "зав. складом с производством — можно",
  staffSaveRefusal(
    asOwner(),
    draft({ email: "sklad2@ecoculture.kz", role: ROLES.WAREHOUSE, farm: FARMS.ESENTAI })
  )
);
check(
  "у роли без производства поле СТИРАЕТСЯ, а не сохраняется про запас",
  cleanStaff(draft({ email: "e@x.kz", role: ROLES.MANAGER, farm: FARMS.ROSE_FARM })).farm,
  ""
);
check(
  "почта приводится к нижнему регистру",
  cleanStaff(draft({ email: "  ИМЯ@Ecoculture.KZ " })).email,
  "имя@ecoculture.kz"
);

// --- Нельзя запереть себя снаружи -------------------------------------------
const twoAdmins = base.concat(user({ email: SECOND_ADMIN, name: "Второй", role: ROLES.ADMIN }));

refuses(
  "свою роль менять нельзя даже при втором админе",
  staffSaveRefusal(
    asOwner(twoAdmins),
    draft({ email: OWNER, name: "Владелец", role: ROLES.MANAGER })
  )
);
refuses(
  "себя отключать нельзя",
  staffSaveRefusal(
    asOwner(twoAdmins),
    draft({ email: OWNER, name: "Владелец", role: ROLES.ADMIN, active: false })
  )
);
allows(
  "своё имя поправить можно",
  staffSaveRefusal(
    asOwner(twoAdmins),
    draft({ email: OWNER, name: "Ержан Садакбаев", role: ROLES.ADMIN })
  )
);

// Второго админа разжаловать можно — первый остаётся.
allows(
  "второго администратора можно разжаловать, пока есть первый",
  staffSaveRefusal(
    asOwner(twoAdmins),
    draft({ email: SECOND_ADMIN, name: "Второй", role: ROLES.MANAGER })
  )
);

// А вот последнего — нельзя, и это НЕ покрывается запретом «свою роль не менять»:
// разжаловать может и другой администратор.
const onlySecondIsAdmin: AppUser[] = [
  user({ email: OWNER, name: "Владелец", role: ROLES.ADMIN }),
  user({ email: SECOND_ADMIN, name: "Второй", role: ROLES.ADMIN, active: false }),
];
refuses(
  "последнего активного администратора не разжаловать",
  staffSaveRefusal(
    { actorRole: ROLES.ADMIN, actorEmail: SECOND_ADMIN, users: onlySecondIsAdmin },
    draft({ email: OWNER, name: "Владелец", role: ROLES.MANAGER })
  )
);
refuses(
  "последнего активного администратора не отключить",
  staffSaveRefusal(
    { actorRole: ROLES.ADMIN, actorEmail: SECOND_ADMIN, users: onlySecondIsAdmin },
    draft({ email: OWNER, name: "Владелец", role: ROLES.ADMIN, active: false })
  )
);
// Но если новым админом становится кто-то другой — можно.
allows(
  "нового администратора завести можно всегда",
  staffSaveRefusal(asOwner(), draft({ email: "tretiy@ecoculture.kz", role: ROLES.ADMIN }))
);

// --- Увольнение --------------------------------------------------------------
allows(
  "чужой доступ закрыть можно",
  staffSaveRefusal(
    asOwner(),
    draft({ email: "emil@ecoculture.kz", name: "Эмиль", role: ROLES.MANAGER, active: false })
  )
);

// --- Что человек увидит в ответе --------------------------------------------
check(
  "нового описываем словами",
  staffChangeSummary(null, draft({ email: "novyy@ecoculture.kz", name: "Асem" })).startsWith("заведён"),
  true
);
check(
  "смену роли описываем словами",
  staffChangeSummary(
    user({ email: "emil@ecoculture.kz", name: "Эмиль", role: ROLES.MANAGER }),
    draft({ email: "emil@ecoculture.kz", name: "Эмиль", role: ROLES.SALES_HEAD })
  ),
  "роль: manager → sales_head"
);
check(
  "закрытие доступа описываем словами",
  staffChangeSummary(
    user({ email: "emil@ecoculture.kz", name: "Эмиль", role: ROLES.MANAGER }),
    draft({ email: "emil@ecoculture.kz", name: "Эмиль", role: ROLES.MANAGER, active: false })
  ),
  "доступ закрыт"
);

// --- Сроки хранения ----------------------------------------------------------
//
// Числа маленькие, а красят они весь склад: ноль в этом поле мгновенно делает
// просроченным весь цветок, и сделать это можно одним промахом по клавише.
const life = (days: Record<string, number>, warningPercent = 70) => ({ days, warningPercent });
const GOOD = { rose: 7, chrysanthemum: 18, eustoma: 10 };

allows("обычные сроки сохраняются", shelfLifeRefusal(life(GOOD)));
refuses("ноль дней нельзя", shelfLifeRefusal(life({ ...GOOD, rose: 0 })));
refuses("отрицательные дни нельзя", shelfLifeRefusal(life({ ...GOOD, rose: -3 })));
refuses("дробные дни нельзя", shelfLifeRefusal(life({ ...GOOD, rose: 7.5 })));
refuses("год хранения — опечатка", shelfLifeRefusal(life({ ...GOOD, rose: 365 })));
refuses("порог ниже 10 % нельзя", shelfLifeRefusal(life(GOOD, 5)));
refuses("порог выше 100 % нельзя", shelfLifeRefusal(life(GOOD, 120)));
allows("порог ровно 100 % можно — жёлтого не будет вовсе", shelfLifeRefusal(life(GOOD, 100)));
check(
  "в таблицу ложится теми же ключами, что читаются",
  shelfLifeValues(life({ rose: 9 }, 80)),
  { ShelfLifeDays_rose: "9", WarningThresholdPercent: "80" }
);

console.log(fails === 0 ? "\nВсе проверки прошли." : `\nПровалено: ${fails}`);
process.exit(fails === 0 ? 0 : 1);

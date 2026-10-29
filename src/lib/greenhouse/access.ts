import { payrollScope, type PayrollScope } from "../payroll/access";

/**
 * Теплица — кто что может (29.10.2026). Раздел сводит два мира: производственный учёт агронома (циклы, черенкование,
 * срезка, брак) и выработку цветоводов с оплатой труда из «Зарплаты». Поэтому права тоже сводные: записывать могут
 * админ, агроном (роль CRM) и те, кому выработку открывает роль модуля зарплаты (начальник, бухгалтер по ЗП);
 * деньги (бюджеты, оплата труда) — только `seesMoney` зарплаты. Ошибка в строке Users закрывает, а не открывает
 * (грабли 1.10): роль не из списка — раздел закрыт.
 */
export interface GreenhouseUser {
  role: string | null | undefined;
  farm?: string | null;
  payrollRole: string | null | undefined;
  payrollDepartments: string[] | null | undefined;
}

export interface GreenhouseScope {
  /** Выработка цветоводов — по роли модуля зарплаты (её правила и действия — в `payroll/work.ts`). */
  editsWork: boolean;
  /** Журналы теплицы: срезка, черенкование, брак, даты циклов. */
  editsLogs: boolean;
  /** Бюджеты на виды работ. */
  editsRates: boolean;
  seesMoney: boolean;
  /** Компания закреплена за человеком (агроном, зав. складом) — переключателя нет. */
  farmLocked: string | null;
  payroll: PayrollScope | null;
}

/**
 * Роли CRM, которым раздел открыт сами по себе. Остальные (бригадир с ролью `payroll` или `manager`) входят, если у них
 * есть роль в модуле зарплаты: выработку участков ведут именно они. Охранник (`access.ts`) пускает все эти роли, а
 * решает эта функция — как у «Зарплаты».
 */
export const GREENHOUSE_ROLES = ["admin", "agronomist", "warehouse", "accountant", "sales_head"];

export function greenhouseScope(user: GreenhouseUser): GreenhouseScope | null {
  const role = String(user.role ?? "").trim();
  if (!role) return null;
  const payroll = payrollScope({ role, payrollRole: user.payrollRole, payrollDepartments: user.payrollDepartments });
  if (role === "admin") return { editsWork: true, editsLogs: true, editsRates: true, seesMoney: true, farmLocked: null, payroll };
  const farm = String(user.farm ?? "").trim().toLowerCase();
  const farmBound = role === "agronomist" || role === "warehouse";
  // Зав. складом и агроном без производства в карточке раздел не открывают (грабли 1.10).
  if (farmBound && !farm) return payroll ? { editsWork: payroll.editsWork, editsLogs: payroll.kind === "agronomist" || payroll.kind === "head", editsRates: payroll.editsRates, seesMoney: payroll.seesMoney, farmLocked: null, payroll } : null;
  // Кадровику выработка и журналы ни к чему — у него карточки людей, а не теплица.
  if (!GREENHOUSE_ROLES.includes(role) && (!payroll || payroll.kind === "hr")) return null;
  return {
    editsWork: !!payroll?.editsWork,
    // Журналы теплицы (срезка, черенкование, брак, даты циклов) — агроном и зав. складом своего производства, а из
    // «Зарплаты» — агроном и начальники участков: это те же ответственные, что ведут выработку.
    editsLogs: farmBound || payroll?.kind === "agronomist" || payroll?.kind === "head",
    editsRates: !!payroll?.editsRates,
    seesMoney: !!payroll?.seesMoney,
    farmLocked: farmBound ? farm : null,
    payroll,
  };
}

export const GREENHOUSE_NO_ACCESS = "Раздел «Теплица» для вашей почты не открыт: записи ведут агроном и ответственные за участки; доступ даёт администратор.";

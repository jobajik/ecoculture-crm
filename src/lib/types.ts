import type { FlowerType, OrderStatus, Role } from "./constants";

export interface AppUser {
  email: string;
  name: string;
  role: Role;
  /** Производство, за которое отвечает зав. складом. У менеджеров и админа — null. */
  farm: string | null;
  active: boolean;
}

export interface Order {
  orderId: string;
  createdAt: string;
  managerEmail: string;
  clientName: string;
  clientPhone: string;
  deliveryDate: string;
  status: OrderStatus;
  notes: string;
  /** Первая «зелёная галочка»: менеджер окончательно согласовал заявку с клиентом. */
  managerConfirmed: boolean;
  managerConfirmedAt: string;
  /** Вторая «зелёная галочка»: бухгалтер увидел деньги. Оплата только целиком. */
  paid: boolean;
  paidAt: string;
  paymentMethod: string;
  /** Кто из бухгалтеров отметил оплату. */
  accountantEmail: string;
  /**
   * Сколько денег по заявке уже получено. Оплата бывает частичной: клиент вносит
   * предоплату, потом остаток. Флаг `paid` при этом означает «оплачено целиком»
   * и считается из этой суммы — два поля не расходятся, потому что флаг всегда
   * пересчитывается при записи.
   */
  paidAmount: number;
  /** Клиент обещал заплатить до этой даты («ГГГГ-ММ-ДД»). Ставит бухгалтер. */
  promisedAt: string;
  /** Заметка бухгалтера по взысканию: с кем говорили, о чём договорились. */
  collectionNote: string;
  /**
   * Клиент из базы. `clientName` рядом остаётся намеренно — это СНИМОК имени на
   * момент заявки: точка может переименоваться или сменить владельца, а в
   * старой заявке должно стоять то, что было написано тогда.
   */
  clientId: string;
}

/**
 * Карточка клиента.
 *
 * Отдельная сущность появилась потому, что имя, вписанное в заявку руками, —
 * это не клиент: «Цветы 24», «цветы-24» и «ТОО Цветы 24» превращаются в трёх
 * разных, и ни средний чек, ни «сколько возим в Караганду» посчитать нельзя.
 */
export interface Client {
  clientId: string;
  createdAt: string;
  /** Как называем между собой — по нему ищут. */
  name: string;
  city: string;
  /** Название точки, если оно отличается от имени клиента. */
  shopName: string;
  clientType: string;
  contactPerson: string;
  phone: string;
  /** WhatsApp, Instagram — то, куда реально пишут. */
  messenger: string;
  address: string;
  /** Договорённость об оплате, а не факт: отличает «должен по договору» от «не платит». */
  paymentTerms: string;
  source: string;
  note: string;
  /** Чей клиент. По нему считается разрез по менеджерам. */
  managerEmail: string;
  /** Снятая галочка прячет клиента из выбора в заявке, но историю не трогает. */
  active: boolean;
}

/**
 * Рекламация: клиент пожаловался, менеджер сообщил, бухгалтер решает.
 * Решение «проведена» означает, что заявку пересчитали — сумма изменилась.
 */
export interface Claim {
  claimId: string;
  createdAt: string;
  orderId: string;
  /** Кто подал — менеджер заявки. */
  managerEmail: string;
  reason: string;
  comment: string;
  status: string;
  decidedAt: string;
  /** Кто решил — бухгалтер. */
  accountantEmail: string;
  /** Комментарий бухгалтера к решению. */
  decision: string;
}

/** Строка журнала действий по деньгам. Пишется всегда, стирать её нельзя. */
export interface MoneyLogEntry {
  logId: string;
  createdAt: string;
  actorEmail: string;
  orderId: string;
  action: string;
  details: string;
  /** Сумма заявки до и после действия — по ним видно, что реально изменилось. */
  amountBefore: number;
  amountAfter: number;
}

export interface OrderItem {
  orderId: string;
  itemId: string;
  flowerType: FlowerType;
  variety: string;
  grade: string;
  quantity: number;
  unitPrice: number;
  shippedQuantity: number;
}

export interface OrderWithItems extends Order {
  items: OrderItem[];
  totalAmount: number;
}

export interface Batch {
  batchId: string;
  receivedAt: string;
  harvestDate: string;
  flowerType: FlowerType;
  variety: string;
  grade: string;
  quantityIn: number;
  quantityRemaining: number;
  location: string;
  receivedByEmail: string;
}

export interface Shipment {
  shipmentId: string;
  createdAt: string;
  orderId: string;
  itemId: string;
  batchId: string;
  quantity: number;
  warehouseEmail: string;
  notes: string;
}

export interface Writeoff {
  writeoffId: string;
  createdAt: string;
  batchId: string;
  quantity: number;
  reason: string;
  warehouseEmail: string;
}

export interface PriceHistoryEntry {
  date: string;
  flowerType: FlowerType;
  variety: string;
  grade: string;
  price: number;
}

export interface Settings {
  shelfLifeDays: Record<string, number>;
  warningThreshold: number;
}

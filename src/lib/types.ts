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

export type Locale =
  | "en"
  | "ta"
  | "hi"
  | "ml"
  | "kn"
  | "te"
  | "si"
  | "ne"
  | "ar"
  | "fr"
  | "es"
  | "pt"
  | "id"
  | "th"
  | "de"
  | "sw"
  | "nl"
  | "it";
export interface Item {
  id: string;
  name: string;
  price: number;
  code: string;
  barcode?: string;
  category: string;
  visual: string;
  image?: string;
  shape?: "circle" | "square" | "diamond";
  taxBps: number;
  taxInclusive: boolean;
  active: boolean;
  requiresConfiguration?: boolean;
}
export interface Line {
  id: string;
  snapshotVersion?: string;
  offlineUntil?: string;
  itemId?: string;
  name: string;
  quantity: number;
  price: number;
  taxBps: number;
  taxInclusive: boolean;
}
export interface Customer {
  id: string;
  name: string;
  phone: string;
}
export interface Cart {
  id: string;
  lines: Line[];
  customer?: Customer;
  createdAt: string;
}
export interface UpiAccount {
  id: string;
  name: string;
  vpa: string;
  active: boolean;
  verification: "manual" | "provider";
}
export interface Shop {
  id: string;
  branchId: string;
  name: string;
  branchName: string;
  currency: string;
  staffId: string;
  staffName: string;
  mode: "training" | "live";
  baseUrl?: string;
  /** Server-authenticated routes sharing credentials and a deduplication ledger. */
  connection?: { idempotencyScope: string; local?: string; remote?: string };
  snapshotVersion: string;
  offlineUntil: string;
  quickTaxBps: number;
  quickTaxInclusive: boolean;
  permissions: {
    sell: boolean;
    quickSale: boolean;
    customerWrite: boolean;
    itemWrite: boolean;
    priceOverride: boolean;
    manualUpi: boolean;
  };
  upiAccounts: UpiAccount[];
  defaultUpiAccountId?: string;
  capabilities: {
    saleSync: boolean;
    devicePairing: boolean;
    tillPrint: boolean;
    terminal: boolean;
  };
}
export type Payment =
  | { method: "cash"; received: number; change: number }
  | {
      method: "upi";
      account: UpiAccount;
      status: "staff-confirmed";
      reference: string;
    };
export interface Sale {
  id: string;
  snapshotVersion?: string;
  tillPrint?: "pending" | "queued";
  shopId: string;
  branchId: string;
  staffId: string;
  cart: Cart;
  total: number;
  tax: number;
  payment: Payment;
  createdAt: string;
  currency: string;
  receipt: string;
  training: boolean;
  sync: "pending" | "synced" | "review";
  serverId?: string;
}
export interface Outbox {
  id: string;
  saleId: string;
  authority: string;
  shopId: string;
  branchId: string;
  attempts: number;
  nextAttemptAt: number;
  error?: string;
  state: "pending" | "review";
}
export interface Settings {
  locale: Locale;
  printer: "system" | "till";
  autoPrint: boolean;
}
export interface SessionData {
  shop: Shop | null;
  items: Item[];
  cart: Cart;
  held: Cart[];
  sales: Sale[];
  outbox: Outbox[];
  settings: Settings;
  customers: Customer[];
}

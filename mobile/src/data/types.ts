// The thirteen record types from section 10 of the scope sheet.
// Every record carries a phone-generated ID and timestamps, so a synced
// change can be replayed without creating a duplicate.

export type Id = string;
export type IsoDate = string;

export type Role = 'owner' | 'staff';
export type Provider = 'MTN' | 'Airtel' | 'Zamtel';
export type PaymentMethod = 'cash' | 'mobile_money';
export type StockReason = 'opening' | 'restock' | 'sale' | 'void' | 'correction';
export type SaleStatus = 'active' | 'void';
export type ReconcileStatus = 'matched' | 'sale_no_payment' | 'payment_no_sale' | 'unresolved';
export type ShopType = 'clothes' | 'shoes' | 'general' | 'other';
export type DiscountType = 'percent' | 'fixed';

export interface BaseRecord {
  id: Id;
  createdAt: IsoDate;
  updatedAt: IsoDate;
}

export interface Owner extends BaseRecord {
  name: string;
  phone: string;
  pinHash: string;
}

export interface Staff extends BaseRecord {
  name: string;
  phone: string;
  pinHash: string;
  role: Role;
}

export interface Shop extends BaseRecord {
  name: string;
  type: ShopType;
  town: string;
  currency: 'ZMW';
  language: 'en' | 'ny';
  usesBarcodes: boolean;
  lowStockDefault: number;
  turnoverTaxRegistered: boolean;
  tpin?: string;
  providers: Provider[];
}

export interface Product extends BaseRecord {
  name: string;
  category?: string;
  photoUri?: string;
  defaultBuyPrice: number; // ngwee
  defaultSellPrice: number; // ngwee
  discount?: ProductDiscount;
  variants: ProductVariant[];
}

export interface ProductDiscount {
  enabled: boolean;
  type: DiscountType;
  value: number;
  startsAt?: IsoDate;
  endsAt?: IsoDate;
}

export interface ProductVariant extends BaseRecord {
  productId: Id;
  size?: string;
  colour?: string;
  barcode?: string;
  buyPrice: number;
  sellPrice: number;
  lowStockLevel: number;
}

export interface StockMovement extends BaseRecord {
  variantId: Id;
  quantityChange: number; // negative on sale, positive on restock
  reason: StockReason;
  note?: string;
  saleId?: Id;
}

export interface Sale extends BaseRecord {
  recordedBy: Id;
  subtotal: number;
  discountTotal: number;
  total: number;
  status: SaleStatus;
  voidReason?: string;
  reconcileStatus: ReconcileStatus;
}

export interface SaleLine extends BaseRecord {
  saleId: Id;
  variantId: Id;
  quantity: number;
  buyPrice: number;
  listPrice: number;
  discount: number;
  finalPrice: number;
}

export interface Payment extends BaseRecord {
  saleId: Id;
  method: PaymentMethod;
  provider?: Provider;
  amount: number;
  mobileMoneyReference?: string;
}

export interface MobileMoneyTxn extends BaseRecord {
  provider: Provider;
  amount: number;
  sender?: string;
  reference?: string;
  receivedAt: IsoDate;
  rawMessage: string;
  parsed: boolean;
}

export interface Reconciliation extends BaseRecord {
  day: string; // YYYY-MM-DD
  matchedCount: number;
  saleNoPaymentCount: number;
  paymentNoSaleCount: number;
  openingFloat: number;
  countedCash?: number;
  expectedCash: number;
  note?: string;
}

export interface TaxPeriod extends BaseRecord {
  startsOn: string;
  endsOn: string;
  turnover: number;
  rateUsed: number;
  estimatedTax: number;
  dueOn: string;
  paid: boolean;
}

export interface TaxPotEntry extends BaseRecord {
  amount: number;
  kind: 'set_aside' | 'top_up' | 'paid';
  periodId: Id;
  saleId?: Id;
}

export interface SyncQueueItem extends BaseRecord {
  entity: string;
  entityId: Id;
  operation: 'create' | 'update';
  payload: string;
  attempts: number;
}

export interface TaxRules {
  version: number;
  rate: number;
  threshold: number;
  periodDays: number;
  dueDaysAfterPeriod: number;
  reminderDaysBefore: number[];
}

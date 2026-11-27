// Domain types for the thirteen records in section 10 of the scope sheet.
// Every record carries a phone-generated ID and timestamps, so a replayed
// sync change can never create a duplicate.

export type Id = string;
export type IsoDate = string;
export type Ngwee = number; // integer minor units; 100 ngwee = K1.00

export type Role = 'owner' | 'staff';
export type Provider = 'MTN' | 'Airtel' | 'Zamtel';
export type PaymentMethod = 'cash' | 'mobile_money';
export type StockReason = 'opening' | 'restock' | 'sale' | 'void' | 'correction';
export type SaleStatus = 'active' | 'void';
export type ReconcileStatus = 'matched' | 'sale_no_payment' | 'payment_no_sale' | 'unresolved';
export type ShopType = 'clothes' | 'shoes' | 'general' | 'other';
/** The trade the shop is in. Drives catalogue labels and defaults; `ShopType` stays as the legacy sync/USSD field. */
export type ProfileId =
  | 'fashion'
  | 'salaula'
  | 'health_beauty'
  | 'bar'
  | 'grocery'
  | 'hardware'
  | 'electronics'
  | 'salon'
  | 'general';
export type DiscountType = 'percent' | 'fixed';
export type StockState = 'out' | 'low' | 'ok';

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
  /** Legacy mirror of the profile, kept for sync and USSD. */
  type: ShopType;
  profileId: ProfileId;
  town: string;
  currency: 'ZMW';
  language: 'en' | 'ny';
  usesBarcodes: boolean;
  lowStockDefault: number;
  turnoverTaxRegistered: boolean;
  tpin?: string;
  providers: Provider[];
}

export interface VariantAttribute {
  key: string;
  value: string;
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
  buyPrice: Ngwee;
  sellPrice: Ngwee;
  lowStockLevel: number;
}

export interface Product extends BaseRecord {
  name: string;
  category?: string;
  photoUri?: string;
  defaultBuyPrice: Ngwee;
  defaultSellPrice: Ngwee;
  discount?: ProductDiscount;
  variants: ProductVariant[];
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
  subtotal: Ngwee;
  discountTotal: Ngwee;
  total: Ngwee;
  status: SaleStatus;
  voidReason?: string;
  reconcileStatus: ReconcileStatus;
}

export interface SaleLine extends BaseRecord {
  saleId: Id;
  variantId: Id;
  quantity: number;
  buyPrice: Ngwee;
  listPrice: Ngwee;
  discount: Ngwee;
  finalPrice: Ngwee;
}

export interface Payment extends BaseRecord {
  saleId: Id;
  method: PaymentMethod;
  provider?: Provider;
  amount: Ngwee;
  mobileMoneyReference?: string;
}

export interface MobileMoneyTxn extends BaseRecord {
  provider: Provider;
  amount: Ngwee;
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
  openingFloat: Ngwee;
  countedCash?: Ngwee;
  expectedCash: Ngwee;
  note?: string;
}

export interface TaxPeriod extends BaseRecord {
  startsOn: string;
  endsOn: string;
  turnover: Ngwee;
  rateUsed: number;
  estimatedTax: Ngwee;
  dueOn: string;
  paid: boolean;
}

export interface TaxPotEntry extends BaseRecord {
  amount: Ngwee;
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

// Configuration that ships with the app and refreshes from the backend.
export interface TaxRules {
  version: number;
  rate: number; // 0.05 = 5%
  /** Turnover at or above this is income tax, not turnover tax. */
  threshold: Ngwee;
  /** What the threshold is measured against: sales so far this calendar year, or this period only. */
  thresholdBasis: 'year' | 'period';
  periodDays: number;
  dueDaysAfterPeriod: number;
  reminderDaysBefore: number[];
}

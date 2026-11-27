import type {
  MobileMoneyTxn,
  Payment,
  Product,
  Reconciliation,
  Sale,
  SaleLine,
  Shop,
  StockMovement,
  TaxPeriod,
  TaxPotEntry,
  TaxRules,
} from '@/core/types';
import { variantLabel } from '@/core/profiles';

const kwacha = (amount: number) => Math.round(amount * 100);
const at = (time: string) => `2026-11-17T${time}:00+02:00`;

export const taxRules: TaxRules = {
  version: 2,
  // From ZRA, 18 November 2026 (scope sheet section 7): 5% of monthly
  // turnover, turnover tax for businesses below K5 million a year and income
  // tax from K5 million a year, due on the 14th of the following month.
  // Every tax figure on screen is derived from this object.
  rate: 0.05,
  threshold: 500_000_000, // K5,000,000 in ngwee
  thresholdBasis: 'year',
  periodDays: 30,
  dueDaysAfterPeriod: 14,
  reminderDaysBefore: [7, 3, 0],
};

export const shop: Shop = {
  id: 'shop-1',
  createdAt: at('07:00'),
  updatedAt: at('07:00'),
  name: 'Chiwala Fashions',
  type: 'clothes',
  profileId: 'fashion',
  town: 'Lusaka',
  currency: 'ZMW',
  language: 'en',
  usesBarcodes: true,
  lowStockDefault: 3,
  turnoverTaxRegistered: true,
  tpin: '1001234567',
  providers: ['MTN', 'Airtel', 'Zamtel'],
};

export const products: Product[] = [
  {
    id: 'prod-1',
    createdAt: at('07:10'),
    updatedAt: at('07:10'),
    name: 'Black school shoes',
    category: 'Shoes',
    defaultBuyPrice: kwacha(180),
    defaultSellPrice: kwacha(280),
    discount: { enabled: true, type: 'percent', value: 10 },
    unit: 'piece',
    variants: [
      { id: 'var-1', createdAt: at('07:10'), updatedAt: at('07:10'), productId: 'prod-1', size: '40', barcode: '6001234500018', buyPrice: kwacha(180), sellPrice: kwacha(280), lowStockLevel: 3 },
      { id: 'var-2', createdAt: at('07:10'), updatedAt: at('07:10'), productId: 'prod-1', size: '42', barcode: '6001234500025', buyPrice: kwacha(180), sellPrice: kwacha(280), lowStockLevel: 3 },
    ],
  },
  {
    id: 'prod-2',
    createdAt: at('07:12'),
    updatedAt: at('07:12'),
    name: 'Blue cotton shirt',
    category: 'Clothes',
    defaultBuyPrice: kwacha(90),
    defaultSellPrice: kwacha(160),
    unit: 'piece',
    variants: [
      { id: 'var-3', createdAt: at('07:12'), updatedAt: at('07:12'), productId: 'prod-2', size: 'M', barcode: '6001234500032', buyPrice: kwacha(90), sellPrice: kwacha(160), lowStockLevel: 3 },
      { id: 'var-4', createdAt: at('07:12'), updatedAt: at('07:12'), productId: 'prod-2', size: 'L', barcode: '6001234500049', buyPrice: kwacha(90), sellPrice: kwacha(160), lowStockLevel: 3 },
    ],
  },
  {
    id: 'prod-3',
    createdAt: at('07:15'),
    updatedAt: at('07:15'),
    name: 'Ladies handbag',
    category: 'Accessories',
    defaultBuyPrice: kwacha(250),
    defaultSellPrice: kwacha(450),
    unit: 'piece',
    variants: [
      { id: 'var-5', createdAt: at('07:15'), updatedAt: at('07:15'), productId: 'prod-3', colour: 'Brown', barcode: '2000000000015', buyPrice: kwacha(250), sellPrice: kwacha(450), lowStockLevel: 2 },
    ],
  },
  {
    id: 'prod-4',
    createdAt: at('07:18'),
    updatedAt: at('07:18'),
    name: 'Sports socks',
    category: 'Accessories',
    defaultBuyPrice: kwacha(25),
    defaultSellPrice: kwacha(60),
    unit: 'piece',
    variants: [
      { id: 'var-6', createdAt: at('07:18'), updatedAt: at('07:18'), productId: 'prod-4', colour: 'White', barcode: '2000000000022', buyPrice: kwacha(25), sellPrice: kwacha(60), lowStockLevel: 5 },
    ],
  },
  {
    id: 'prod-5',
    createdAt: at('07:20'),
    updatedAt: at('07:20'),
    name: 'Canvas sneakers',
    category: 'Shoes',
    defaultBuyPrice: kwacha(200),
    defaultSellPrice: kwacha(320),
    unit: 'piece',
    variants: [
      { id: 'var-7', createdAt: at('07:20'), updatedAt: at('07:20'), productId: 'prod-5', size: '41', barcode: '2000000000039', buyPrice: kwacha(200), sellPrice: kwacha(320), lowStockLevel: 3 },
    ],
  },
];

type SeedSale = {
  id: string;
  time: string;
  lines: { variantId: string; quantity: number; discount?: number }[];
  payments: Omit<Payment, 'id' | 'createdAt' | 'updatedAt' | 'saleId'>[];
  status?: Sale['status'];
  reconcileStatus: Sale['reconcileStatus'];
};

const seeds: SeedSale[] = [
  {
    id: 'sale-1',
    time: '08:40',
    lines: [{ variantId: 'var-6', quantity: 2 }],
    payments: [{ method: 'cash', amount: kwacha(120) }],
    reconcileStatus: 'matched',
  },
  {
    id: 'sale-2',
    time: '09:15',
    lines: [{ variantId: 'var-1', quantity: 1 }],
    payments: [
      { method: 'mobile_money', provider: 'MTN', amount: kwacha(252), mobileMoneyReference: 'MP2607.1122.A84721' },
    ],
    reconcileStatus: 'matched',
  },
  {
    id: 'sale-3',
    time: '10:05',
    lines: [{ variantId: 'var-3', quantity: 1, discount: kwacha(20) }],
    payments: [
      { method: 'mobile_money', provider: 'Airtel', amount: kwacha(140), mobileMoneyReference: 'AIR-9912034' },
    ],
    reconcileStatus: 'sale_no_payment',
  },
];

function variantOf(variantId: string) {
  for (const product of products) {
    const variant = product.variants.find((candidate) => candidate.id === variantId);
    if (variant) return { product, variant };
  }
  throw new Error(`Unknown variant ${variantId}`);
}

const sales: Sale[] = [];
const saleLines: SaleLine[] = [];
const payments: Payment[] = [];

for (const seed of seeds) {
  let subtotal = 0;
  let discountTotal = 0;

  seed.lines.forEach((line, index) => {
    const { variant } = variantOf(line.variantId);
    const listPrice = variant.sellPrice * line.quantity;
    const discount = line.discount ?? 0;
    subtotal += listPrice;
    discountTotal += discount;
    saleLines.push({
      id: `${seed.id}-line-${index + 1}`,
      createdAt: at(seed.time),
      updatedAt: at(seed.time),
      saleId: seed.id,
      variantId: line.variantId,
      quantity: line.quantity,
      buyPrice: variant.buyPrice,
      listPrice,
      discount,
      finalPrice: listPrice - discount,
    });
  });

  sales.push({
    id: seed.id,
    createdAt: at(seed.time),
    updatedAt: at(seed.time),
    recordedBy: 'staff-1',
    subtotal,
    discountTotal,
    total: subtotal - discountTotal,
    status: seed.status ?? 'active',
    reconcileStatus: seed.reconcileStatus,
  });

  seed.payments.forEach((payment, index) => {
    payments.push({
      ...payment,
      id: `${seed.id}-pay-${index + 1}`,
      createdAt: at(seed.time),
      updatedAt: at(seed.time),
      saleId: seed.id,
    });
  });
}

export const salesData = sales;
export const saleLinesData = saleLines;
export const paymentsData = payments;

// Opening stock, minus sales, so quantities are always derived from movements.
// A variant with no opening stock gets no movement at all: zero-quantity
// movements are meaningless and the schema rejects them.
export const stockMovements: StockMovement[] = [
  ...products.flatMap((product) =>
    product.variants.flatMap((variant) => {
      const opening = variant.id === 'var-6' ? 1 : variant.id === 'var-7' ? 0 : 6;
      if (opening === 0) return [];
      return [
        {
          id: `open-${variant.id}`,
          createdAt: at('07:30'),
          updatedAt: at('07:30'),
          variantId: variant.id,
          quantityChange: opening,
          reason: 'opening' as const,
        },
      ];
    })
  ),
  ...saleLines.map((line) => ({
    id: `move-${line.id}`,
    createdAt: line.createdAt,
    updatedAt: line.updatedAt,
    variantId: line.variantId,
    quantityChange: -line.quantity,
    reason: 'sale' as const,
    saleId: line.saleId,
  })),
];

export const mobileMoneyTxns: MobileMoneyTxn[] = [
  {
    id: 'mm-1',
    createdAt: at('09:15'),
    updatedAt: at('09:15'),
    provider: 'MTN',
    amount: kwacha(252),
    sender: 'Mutale Banda',
    reference: 'MP2607.1122.A84721',
    receivedAt: at('09:15'),
    rawMessage: 'You have received K252.00 from Mutale Banda. Ref MP2607.1122.A84721. Balance K1,204.00.',
    parsed: true,
  },
  {
    id: 'mm-2',
    createdAt: at('11:32'),
    updatedAt: at('11:32'),
    provider: 'Zamtel',
    amount: kwacha(450),
    sender: 'Grace Phiri',
    reference: 'ZAM-552103',
    receivedAt: at('11:32'),
    rawMessage: 'Zamtel Money: You have received K450.00 from Grace Phiri. Transaction ID ZAM-552103.',
    parsed: true,
  },
];

export const reconciliation: Reconciliation = {
  id: 'rec-1',
  createdAt: at('07:00'),
  updatedAt: at('11:40'),
  day: '2026-11-17',
  matchedCount: 1,
  saleNoPaymentCount: 1,
  paymentNoSaleCount: 1,
  openingFloat: kwacha(500),
  countedCash: undefined,
  expectedCash: kwacha(620),
};

export const taxPeriod: TaxPeriod = {
  id: 'tax-1',
  createdAt: at('07:00'),
  updatedAt: at('11:40'),
  startsOn: '2026-11-01',
  endsOn: '2026-11-30',
  turnover: 0,
  rateUsed: taxRules.rate,
  estimatedTax: 0,
  dueOn: '2026-12-14',
  paid: false,
};

export const taxPot: TaxPotEntry[] = [
  {
    id: 'pot-1',
    createdAt: at('09:20'),
    updatedAt: at('09:20'),
    amount: kwacha(10),
    kind: 'set_aside',
    periodId: 'tax-1',
    saleId: 'sale-2',
  },
];

// ---------- selectors ----------

export function stockOnHand(variantId: string): number {
  return stockMovements
    .filter((movement) => movement.variantId === variantId)
    .reduce((total, movement) => total + movement.quantityChange, 0);
}

export function activeSales(): Sale[] {
  return salesData.filter((sale) => sale.status === 'active');
}

export function todayTotals() {
  const active = activeSales();
  const totals = active.reduce(
    (acc, sale) => {
      acc.salesTotal += sale.total;
      acc.discounts += sale.discountTotal;
      acc.count += 1;
      return acc;
    },
    { salesTotal: 0, discounts: 0, count: 0 }
  );

  const cost = saleLinesData
    .filter((line) => active.some((sale) => sale.id === line.saleId))
    .reduce((sum, line) => sum + line.buyPrice * line.quantity, 0);

  return { ...totals, cost, grossProfit: totals.salesTotal - cost };
}

export function lowStockItems(): { variantId: string; label: string; quantity: number; level: number }[] {
  return products.flatMap((product) =>
    product.variants.flatMap((variant) => {
      const quantity = stockOnHand(variant.id);
      if (quantity > variant.lowStockLevel) return [];
      const label = variantLabel(product.name, variant);
      return [{ variantId: variant.id, label, quantity, level: variant.lowStockLevel }];
    })
  );
}

export function taxEstimate() {
  const turnover = activeSales()
    .filter((sale) => sale.reconcileStatus !== 'unresolved')
    .reduce((sum, sale) => sum + sale.total, 0);
  const potBalance = taxPot
    .filter((entry) => entry.kind !== 'paid')
    .reduce((sum, entry) => sum + entry.amount, 0);
  return { turnover, estimatedTax: Math.round(turnover * taxRules.rate), potBalance };
}

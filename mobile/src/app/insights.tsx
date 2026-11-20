import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import {
  ChartCard,
  ColumnChart,
  compactNumber,
  RankedBars,
  SegmentedBar,
  StatTile,
  Toggle,
  type ColumnPoint,
  type RankedItem,
} from '@/components/charts';
import { IconButton, Screen } from '@/components/ui';
import { change, type InsightPeriod, type Insights, type PaymentKey } from '@/core';
import { useInsights } from '@/db/hooks';
import { useI18n } from '@/i18n';
import { formatCount, formatKwacha } from '@/lib/format';
import { colors, spacing, typeScale } from '@/theme/tokens';

type Translate = ReturnType<typeof useI18n>['t'];
type ProductMetric = 'sales' | 'profit' | 'units';
type TimeView = 'hour' | 'weekday';

const PAYMENT_SLOTS: Record<PaymentKey, number> = { cash: 0, MTN: 1, Airtel: 2, Zamtel: 3, mobile: 4 };
const TOP = 5;

/**
 * Owner-only. Each card answers one business question and leads with the
 * answer in words; the chart under it is the evidence.
 */
export default function InsightsScreen() {
  const { t } = useI18n();
  const router = useRouter();
  const [period, setPeriod] = useState<InsightPeriod>(7);
  const [metric, setMetric] = useState<ProductMetric>('sales');
  const [timeView, setTimeView] = useState<TimeView>('hour');
  const { data, loading, error } = useInsights(period);

  const back = <IconButton name="close" label={t('common.back')} onPress={() => router.back()} />;

  return (
    <Screen title={t('insights.title')} subtitle={t('insights.subtitle', { days: period })} action={back}>
      <Toggle
        options={[
          { value: 7 as InsightPeriod, label: t('insights.period.7') },
          { value: 30 as InsightPeriod, label: t('insights.period.30') },
        ]}
        value={period}
        onChange={setPeriod}
      />

      {error ? <Text style={styles.error}>{error}</Text> : null}
      {!data ? (
        <Text style={styles.muted}>{loading ? t('insights.loading') : ''}</Text>
      ) : (
        <Body
          data={data}
          t={t}
          metric={metric}
          onMetric={setMetric}
          timeView={timeView}
          onTimeView={setTimeView}
        />
      )}
    </Screen>
  );
}

function Body({
  data,
  t,
  metric,
  onMetric,
  timeView,
  onTimeView,
}: {
  data: Insights;
  t: Translate;
  metric: ProductMetric;
  onMetric: (metric: ProductMetric) => void;
  timeView: TimeView;
  onTimeView: (view: TimeView) => void;
}) {
  const { current, previous, period } = data;
  const vs = t('insights.vs', { days: period });
  const hasSales = current.saleCount > 0;

  return (
    <>
      <View style={styles.tiles}>
        <StatTile
          label={t('insights.kpi.sales')}
          value={formatKwacha(current.sales)}
          delta={change(current.sales, previous.sales)}
          deltaLabel={previous.sales > 0 ? vs : t('insights.noCompare')}
        />
        <StatTile
          label={t('insights.kpi.profit')}
          value={formatKwacha(current.profit)}
          hint={current.margin === null ? undefined : t('insights.kpi.margin', { percent: Math.round(current.margin * 100) })}
          delta={change(current.profit, previous.profit)}
          deltaLabel={previous.profit !== 0 ? vs : t('insights.noCompare')}
        />
        <StatTile
          label={t('insights.kpi.count')}
          value={formatCount(current.saleCount)}
          delta={change(current.saleCount, previous.saleCount)}
          deltaLabel={previous.saleCount > 0 ? vs : t('insights.noCompare')}
        />
        <StatTile
          label={t('insights.kpi.average')}
          value={formatKwacha(current.avgSale)}
          delta={change(current.avgSale, previous.avgSale)}
          deltaLabel={previous.avgSale > 0 ? vs : t('insights.noCompare')}
        />
      </View>

      {!hasSales ? (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>{t('insights.empty', { days: period })}</Text>
        </View>
      ) : (
        <>
          <DailyCard data={data} t={t} />
          <ProductsCard data={data} t={t} metric={metric} onMetric={onMetric} />
          <TimingCard data={data} t={t} view={timeView} onView={onTimeView} />
          <PaymentsCard data={data} t={t} />
        </>
      )}
      <ShelfCard data={data} t={t} />
    </>
  );
}

/* ---------------------------------------------------------------- */

const tickKwacha = (ngwee: number) => compactNumber(ngwee / 100);

function weekdayIndex(day: string) {
  const [y, m, d] = day.split('-').map(Number);
  return (new Date(y, m - 1, d).getDay() + 6) % 7;
}

function shortDate(day: string) {
  const [y, m, d] = day.split('-').map(Number);
  return new Intl.DateTimeFormat('en-ZM', { day: 'numeric', month: 'short' }).format(new Date(y, m - 1, d));
}

function DailyCard({ data, t }: { data: Insights; t: Translate }) {
  const points: ColumnPoint[] = data.daily.map((point, index) => {
    const weekday = t(`insights.weekday.${weekdayIndex(point.day)}`);
    const isLast = index === data.daily.length - 1;
    const label =
      data.period === 7 ? weekday : index % 7 === (data.daily.length - 1) % 7 ? String(Number(point.day.slice(8))) : '';
    return {
      key: point.day,
      label: isLast ? t('insights.today') : label,
      value: point.sales,
      describe: t('insights.daily.describe', {
        day: `${weekday} ${shortDate(point.day)}`,
        amount: formatKwacha(point.sales),
        count: point.saleCount,
      }),
    };
  });
  const best = data.daily.reduce((top, point) => (point.sales > top.sales ? point : top), data.daily[0]);

  return (
    <ChartCard
      title={t('insights.daily.title')}
      takeaway={t('insights.daily.takeaway', {
        day: `${t(`insights.weekday.${weekdayIndex(best.day)}`)} ${shortDate(best.day)}`,
        amount: formatKwacha(best.sales),
      })}
    >
      <ColumnChart points={points} initialIndex={points.length - 1} formatTick={tickKwacha} />
    </ChartCard>
  );
}

function ProductsCard({
  data,
  t,
  metric,
  onMetric,
}: {
  data: Insights;
  t: Translate;
  metric: ProductMetric;
  onMetric: (metric: ProductMetric) => void;
}) {
  const sorted = [...data.products].sort((a, b) => b[metric] - a[metric] || b.sales - a.sales);
  const items: RankedItem[] = sorted.slice(0, TOP).map((product) => ({
    key: product.productId,
    label: product.name,
    value: product[metric],
    valueLabel: metric === 'units' ? formatCount(product.units) : formatKwacha(product[metric]),
    note:
      metric === 'units'
        ? formatKwacha(product.sales)
        : t('insights.products.units', { count: product.units }),
    flag: product.profit < 0 ? { label: t('insights.products.belowCost'), tone: 'danger' } : undefined,
  }));
  const leader = sorted[0];
  const share = data.current.sales > 0 && leader ? Math.round((leader.sales / data.current.sales) * 100) : 0;
  const takeaway =
    metric === 'profit'
      ? t('insights.products.takeawayProfit', { name: leader?.name ?? '', amount: formatKwacha(leader?.profit ?? 0) })
      : metric === 'units'
        ? t('insights.products.takeawayUnits', { name: leader?.name ?? '', count: leader?.units ?? 0 })
        : t('insights.products.takeawaySales', { name: leader?.name ?? '', percent: share });

  return (
    <ChartCard
      title={t('insights.products.title')}
      takeaway={takeaway}
      control={
        <Toggle
          options={[
            { value: 'sales' as ProductMetric, label: t('insights.metric.sales') },
            { value: 'profit' as ProductMetric, label: t('insights.metric.profit') },
            { value: 'units' as ProductMetric, label: t('insights.metric.units') },
          ]}
          value={metric}
          onChange={onMetric}
        />
      }
    >
      <RankedBars items={items} />
    </ChartCard>
  );
}

function hourLabel(hour: number) {
  return `${String(hour).padStart(2, '0')}:00`;
}

function TimingCard({
  data,
  t,
  view,
  onView,
}: {
  data: Insights;
  t: Translate;
  view: TimeView;
  onView: (view: TimeView) => void;
}) {
  let points: ColumnPoint[];
  let peak: number;
  let takeaway: string;

  if (view === 'hour') {
    points = data.hours.map((point) => ({
      key: String(point.hour),
      label: point.hour % 3 === 0 ? String(point.hour) : '',
      value: point.sales,
      describe: t('insights.timing.hourDescribe', {
        from: hourLabel(point.hour),
        to: hourLabel(point.hour + 1),
        amount: formatKwacha(point.sales),
        count: point.saleCount,
      }),
    }));
    peak = data.hours.reduce((best, point, index) => (point.sales > data.hours[best].sales ? index : best), 0);
    takeaway = t('insights.timing.hourTakeaway', {
      from: hourLabel(data.hours[peak].hour),
      to: hourLabel(data.hours[peak].hour + 1),
    });
  } else {
    points = data.weekdays.map((point) => ({
      key: String(point.weekday),
      label: t(`insights.weekday.${point.weekday}`),
      value: point.sales,
      describe: t('insights.timing.dayDescribe', {
        day: t(`insights.weekdayLong.${point.weekday}`),
        amount: formatKwacha(point.sales),
      }),
    }));
    peak = data.weekdays.reduce((best, point, index) => (point.sales > data.weekdays[best].sales ? index : best), 0);
    takeaway = t('insights.timing.dayTakeaway', { day: t(`insights.weekdayLong.${data.weekdays[peak].weekday}`) });
  }

  return (
    <ChartCard
      title={t('insights.timing.title')}
      takeaway={takeaway}
      control={
        <Toggle
          options={[
            { value: 'hour' as TimeView, label: t('insights.timing.byHour') },
            { value: 'weekday' as TimeView, label: t('insights.timing.byDay') },
          ]}
          value={view}
          onChange={onView}
        />
      }
    >
      <ColumnChart key={view} points={points} initialIndex={peak} formatTick={tickKwacha} />
    </ChartCard>
  );
}

function PaymentsCard({ data, t }: { data: Insights; t: Translate }) {
  const total = data.payments.reduce((sum, payment) => sum + payment.amount, 0);
  const mobile = data.payments.filter((payment) => payment.key !== 'cash').reduce((sum, payment) => sum + payment.amount, 0);
  const percent = total > 0 ? Math.round((mobile / total) * 100) : 0;

  return (
    <ChartCard title={t('insights.payments.title')} takeaway={t('insights.payments.takeaway', { percent })}>
      <SegmentedBar
        segments={data.payments.map((payment) => ({
          key: payment.key,
          label: t(`insights.payments.${payment.key}`),
          value: payment.amount,
          valueLabel: formatKwacha(payment.amount),
          slot: PAYMENT_SLOTS[payment.key],
        }))}
      />
    </ChartCard>
  );
}

function ShelfCard({ data, t }: { data: Insights; t: Translate }) {
  const total = data.shelf.reduce((sum, item) => sum + item.value, 0);
  const idle = data.shelf.filter((item) => item.soldUnits === 0).length;
  const items: RankedItem[] = data.shelf.slice(0, TOP).map((item) => ({
    key: item.productId,
    label: item.name,
    value: item.value,
    valueLabel: formatKwacha(item.value),
    note:
      item.soldUnits > 0
        ? t('insights.shelf.sold', { units: item.units, sold: item.soldUnits, days: data.period })
        : t('insights.shelf.onHand', { units: item.units }),
    flag:
      item.soldUnits === 0 ? { label: t('insights.shelf.idle', { days: data.period }), tone: 'warning' } : undefined,
  }));

  return (
    <ChartCard
      title={t('insights.shelf.title')}
      takeaway={
        data.shelf.length === 0
          ? t('insights.shelf.empty')
          : t(idle === 1 ? 'insights.shelf.takeawayOne' : 'insights.shelf.takeaway', {
              amount: formatKwacha(total),
              count: idle,
              days: data.period,
            })
      }
    >
      {items.length > 0 ? <RankedBars items={items} /> : null}
    </ChartCard>
  );
}

const styles = StyleSheet.create({
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  muted: { fontSize: typeScale.body, color: colors.textMuted },
  error: { fontSize: typeScale.body, color: colors.danger, fontWeight: '600' },
  empty: {
    padding: spacing.lg,
    borderRadius: 16,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.border,
  },
  emptyText: { fontSize: typeScale.body, color: colors.textMuted, textAlign: 'center' },
});

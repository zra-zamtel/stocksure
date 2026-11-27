import { StyleSheet, Text, View } from 'react-native';
import { Card, Choice, Field, TextLink } from '@/components/ui';
import { parsePrice, sanitisePriceInput, type ProfileAxis } from '@/core';
import { useI18n } from '@/i18n';
import { formatKwacha } from '@/lib/format';
import type { DraftVariant } from '@/lib/variant-drafts';
import { colors, spacing, themed, typeScale } from '@/theme/tokens';

/**
 * One variant row on the new-product form: the profile's axis values, its own
 * barcode, prices, opening stock and (for trades that use them) expiry and batch.
 */
export function VariantDraftCard({
  draft,
  onChange,
  title,
  onRemove,
  axes,
  uniqueItems,
  usesBarcodes,
  usesExpiry,
  usesBatch,
  lowStockDefault,
}: {
  draft: DraftVariant;
  onChange: (next: DraftVariant) => void;
  /** Shown only when there is more than one row. */
  title?: string;
  /** Absent when this is the only row, which cannot be removed. */
  onRemove?: () => void;
  axes: ProfileAxis[];
  uniqueItems: boolean;
  usesBarcodes: boolean;
  usesExpiry: boolean;
  usesBatch: boolean;
  lowStockDefault: number;
}) {
  const { t } = useI18n();
  const set = (patch: Partial<DraftVariant>) => onChange({ ...draft, ...patch });
  const setAxis = (key: string, value: string) => set({ attributes: { ...draft.attributes, [key]: value } });

  // Selling below what it cost is allowed, but the owner is told while typing.
  const buy = parsePrice(draft.buyPrice);
  const sell = parsePrice(draft.sellPrice);
  const loss = buy.ok && sell.ok && sell.ngwee < buy.ngwee ? buy.ngwee - sell.ngwee : 0;
  const profit = buy.ok && sell.ok && sell.ngwee >= buy.ngwee && sell.ngwee > 0 ? sell.ngwee - buy.ngwee : null;
  const markup = profit !== null && buy.ok && buy.ngwee > 0 ? ((profit / buy.ngwee) * 100).toFixed(1) : null;

  return (
    <Card>
      {title || onRemove ? (
        <View style={styles.header}>
          <Text style={styles.title}>{title}</Text>
          {onRemove ? <TextLink label={t('product.new.removeVariant')} onPress={onRemove} /> : null}
        </View>
      ) : null}

      {axes.map((axis) => (
        <View key={axis.key} style={styles.group}>
          <Field
            label={t(axis.labelKey)}
            value={draft.attributes[axis.key] ?? ''}
            onChangeText={(value) => setAxis(axis.key, value)}
            placeholder={axis.placeholder}
            maxLength={axis.maxLength}
          />
          <View style={styles.chips}>
            {axis.quickPicks.map((pick) => (
              <Choice
                key={pick}
                label={pick}
                selected={draft.attributes[axis.key] === pick}
                onPress={() => setAxis(axis.key, draft.attributes[axis.key] === pick ? '' : pick)}
              />
            ))}
          </View>
        </View>
      ))}

      {usesBarcodes ? (
        <Field
          label={t('product.new.barcode')}
          value={draft.barcode}
          onChangeText={(barcode) => set({ barcode })}
          placeholder={t('products.barcodeAuto')}
          keyboardType="numeric"
        />
      ) : null}

      <Field
        label={t('products.buyPrice')}
        value={draft.buyPrice}
        onChangeText={(value) => set({ buyPrice: sanitisePriceInput(value) })}
        placeholder={t('product.new.buyPlaceholder')}
        keyboardType="decimal-pad"
        required
      />
      <Field
        label={t('products.sellPrice')}
        value={draft.sellPrice}
        onChangeText={(value) => set({ sellPrice: sanitisePriceInput(value) })}
        placeholder={t('product.new.sellPlaceholder')}
        keyboardType="decimal-pad"
        required
      />
      {loss > 0 ? (
        <Text style={styles.warning}>{t('price.belowCost', { loss: formatKwacha(loss) })}</Text>
      ) : profit !== null ? (
        <Text style={styles.success} accessibilityLiveRegion="polite">
          {markup !== null
            ? t('product.new.profit', { amount: formatKwacha(profit), percent: markup })
            : t('product.new.profitOnly', { amount: formatKwacha(profit) })}
        </Text>
      ) : null}

      {uniqueItems ? (
        <View style={styles.group}>
          <Text style={styles.label}>{t('product.new.openingQty')}</Text>
          <Text style={styles.fixedValue}>{t('product.new.uniqueQty')}</Text>
        </View>
      ) : (
        <Field
          label={t('product.new.openingQty')}
          value={draft.quantity}
          onChangeText={(value) => set({ quantity: value.replace(/\D/g, '') })}
          placeholder={t('product.new.qtyPlaceholder')}
          hint={t('product.new.qtyHint')}
          keyboardType="numeric"
          required
        />
      )}
      <Field
        label={t('product.new.lowStock')}
        value={draft.lowStock}
        onChangeText={(value) => set({ lowStock: value.replace(/\D/g, '') })}
        placeholder={t('product.new.lowStockPlaceholder', { count: lowStockDefault })}
        hint={t('product.new.lowStockHint')}
        keyboardType="numeric"
      />
      {usesExpiry ? (
        <Field
          label={t('product.new.expiry')}
          value={draft.expiryDate}
          onChangeText={(value) => set({ expiryDate: value.replace(/[^\d-]/g, '') })}
          placeholder="YYYY-MM-DD"
          hint={t('product.new.expiryHint')}
          maxLength={10}
        />
      ) : null}
      {usesBatch ? (
        <Field
          label={t('product.new.batch')}
          value={draft.batchNo}
          onChangeText={(batchNo) => set({ batchNo })}
          placeholder={t('common.optional')}
          autoCapitalize="characters"
          maxLength={60}
        />
      ) : null}
    </Card>
  );
}

const styles = themed(() =>
  StyleSheet.create({
    header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    title: { fontSize: typeScale.body, color: colors.text, fontWeight: '700' },
    group: { gap: spacing.sm },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
    label: { fontSize: typeScale.label, color: colors.textMuted, fontWeight: '600' },
    fixedValue: { fontSize: typeScale.body, color: colors.text, fontWeight: '600' },
    success: { fontSize: typeScale.label, color: colors.success, fontWeight: '600' },
    warning: { fontSize: typeScale.label, color: colors.warning, fontWeight: '600' },
  })
);

import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useRef, useState, type ComponentRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { captureRef } from 'react-native-view-shot';
import { usePermissionGuard } from '@/auth/permissions';
import { BarcodeLabel } from '@/components/barcode-label';
import { Button, Card, Choice, Field, Screen, SectionTitle } from '@/components/ui';
import { VariantDraftCard } from '@/components/variant-draft-card';
import {
  isValidEan13,
  normaliseBarcode,
  parsePrice,
  profileForShop,
  SALE_WARNING_AGE,
  SALE_WARNING_RX,
} from '@/core';
import { useShop } from '@/db/hooks';
import { createProductWithVariants } from '@/db/repos';
import { useI18n } from '@/i18n';
import { formatKwacha } from '@/lib/format';
import { labelHtml } from '@/lib/label';
import { draftsToVariants, emptyDraft, nextDraft, type DraftProblem, type DraftVariant } from '@/lib/variant-drafts';
import { colors, spacing, themed, typeScale } from '@/theme/tokens';

export default function NewProductScreen() {
  const { t } = useI18n();
  const router = useRouter();
  const db = useSQLiteContext();
  const guard = usePermissionGuard();
  const { barcode: scannedBarcode, from } = useLocalSearchParams<{ barcode?: string; from?: string }>();
  const { data: shop } = useShop();
  const onboarding = from === 'onboarding';
  // The trade decides which variant fields and category suggestions show.
  const profile = profileForShop(shop);

  const [name, setName] = useState('');
  const [category, setCategory] = useState('');
  // null until the owner picks one, so the profile's default applies once the shop loads.
  const [unitDraft, setUnitDraft] = useState<string | null>(null);
  const [saleWarning, setSaleWarning] = useState('');
  // One row per variant (Bottle / Crate / Shot, three shades...). A scanned code fills the first.
  const nextKey = useRef(1);
  const [drafts, setDrafts] = useState<DraftVariant[]>(() => [emptyDraft('v0', scannedBarcode ?? '')]);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const labelRef = useRef<ComponentRef<typeof View>>(null);
  const usesBarcodes = shop?.usesBarcodes ?? false;
  const unit = unitDraft ?? profile.defaultUnit;
  const usesExpiry = profile.modules.includes('expiry');
  const usesBatch = profile.modules.includes('batch');
  const usesSaleWarning = profile.modules.includes('saleWarning');
  const lowStockDefault = shop?.lowStockDefault ?? 3;
  const firstAxis = profile.axes[0];
  // Several variants only make sense when the trade has something to tell them apart.
  const canAddVariant = firstAxis !== undefined;

  // The share/print label card covers the single-variant case, as before; with
  // several variants, each label is printed from the product page.
  const single = drafts.length === 1 ? drafts[0] : null;
  const savedCode = single && single.barcode.trim() !== '' ? normaliseBarcode(single.barcode) : '';
  const scannable = savedCode !== '' && isValidEan13(savedCode);

  function updateDraft(key: string, next: DraftVariant) {
    setDrafts((current) => current.map((draft) => (draft.key === key ? next : draft)));
  }

  function addDraft() {
    const key = `v${nextKey.current++}`;
    setDrafts((current) => [...current, nextDraft(current[current.length - 1], key)]);
  }

  function removeDraft(key: string) {
    setDrafts((current) => (current.length > 1 ? current.filter((draft) => draft.key !== key) : current));
  }

  function problemMessage(problem: DraftProblem): string {
    const row = drafts.length > 1 ? t('product.new.variantN', { n: problem.row }) + ': ' : '';
    switch (problem.code) {
      case 'buyPrice':
        return row + t(`price.error.${problem.priceError}`, { field: t('products.buyPrice') });
      case 'sellPrice':
        return row + t(`price.error.${problem.priceError}`, { field: t('products.sellPrice') });
      case 'quantity':
        return row + t('product.new.error.qty');
      case 'expiry':
        return row + t('product.new.error.expiry');
      case 'noAxisValue':
        return row + t('product.new.error.noAxisValue', { axis: firstAxis ? t(firstAxis.labelKey) : '' });
      case 'duplicateVariant':
        return t('product.new.error.duplicateVariant', { a: problem.otherRow, b: problem.row });
      case 'duplicateBarcode':
        return t('product.new.error.duplicateBarcode', { a: problem.otherRow, b: problem.row });
    }
  }

  async function handleSave() {
    setError(null);
    setMessage(null);

    try {
      guard('products.manage');
    } catch {
      setError(t('permission.denied'));
      return;
    }

    if (!name.trim()) return setError('Product name is required');
    const result = draftsToVariants(drafts, {
      axes: profile.axes,
      usesBarcodes,
      usesExpiry,
      usesBatch,
      lowStockDefault: shop?.lowStockDefault,
    });
    if (!result.ok) return setError(problemMessage(result.problem));

    setSaving(true);
    try {
      const created = await createProductWithVariants(db, {
        name,
        category: category.trim() || undefined,
        unit,
        saleWarning: usesSaleWarning ? saleWarning || undefined : undefined,
        variants: result.variants,
      });
      if (onboarding) {
        // Return to the setup screen that opened this form, dismissing any
        // intermediate scan/form screens and refreshing its product count.
        router.dismissTo('/onboarding/first-products');
      } else {
        router.replace(`/product/${created.productId}`);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save the product');
    } finally {
      setSaving(false);
    }
  }

  async function handleShareLabel() {
    if (!labelRef.current) return;
    setError(null);
    try {
      const uri = await captureRef(labelRef, { format: 'png', quality: 1, result: 'tmpfile' });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, {
          mimeType: 'image/png',
          dialogTitle: t('products.shareLabel'),
        });
        setMessage(t('products.labelShared'));
      } else {
        setError('Sharing is not available on this device');
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not share the label');
    }
  }

  async function handlePrintLabel() {
    if (!scannable || !single) return;
    setError(null);
    const printPrice = parsePrice(single.sellPrice);
    const priceText = printPrice.ok ? formatKwacha(printPrice.ngwee) : '';
    try {
      await Print.printAsync({
        html: labelHtml({
          shopName: shop?.name ?? 'StockSure',
          productName: name.trim() || 'New product',
          priceText,
          code: savedCode,
        }),
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not open printing');
    }
  }

  return (
    <Screen back
      title={t('product.new.title')}
      footer={<Button label={t('products.saveProduct')} disabled={saving} loading={saving} onPress={handleSave} />}
    >
      {usesBarcodes ? (
        <Button
          label={t('products.scanBarcode')}
          variant="secondary"
          onPress={() =>
            router.push(from ? { pathname: '/scan', params: { from } } : '/scan')
          }
        />
      ) : null}

      <SectionTitle>{t('product.new.details')}</SectionTitle>
      <Card>
        <Field label={t('product.new.name')} value={name} onChangeText={setName} placeholder={t('product.new.namePlaceholder')} required />
        <View style={styles.chips}>
          {profile.categories.map((suggestion) => (
            <Choice
              key={suggestion}
              label={suggestion}
              selected={suggestion === category}
              onPress={() => setCategory((current) => (current === suggestion ? '' : suggestion))}
            />
          ))}
        </View>
        <Field
          label={t('product.new.category')}
          value={category}
          onChangeText={setCategory}
          placeholder={profile.categories[0] ?? t('product.new.categoryPlaceholder')}
        />
        {profile.units.length > 1 ? (
          <View style={styles.group}>
            <Text style={styles.label}>{t('product.new.unit')}</Text>
            <View style={styles.chips}>
              {profile.units.map((option) => (
                <Choice key={option} label={option} selected={option === unit} onPress={() => setUnitDraft(option)} />
              ))}
            </View>
          </View>
        ) : null}
        {usesSaleWarning ? (
          <View style={styles.group}>
            <Text style={styles.label}>{t('product.new.saleWarning')}</Text>
            <View style={styles.chips}>
              <Choice label={t('product.new.saleWarning.none')} selected={saleWarning === ''} onPress={() => setSaleWarning('')} />
              <Choice
                label={t('product.new.saleWarning.rx')}
                selected={saleWarning === SALE_WARNING_RX}
                onPress={() => setSaleWarning(SALE_WARNING_RX)}
              />
              <Choice
                label={t('product.new.saleWarning.age')}
                selected={saleWarning === SALE_WARNING_AGE}
                onPress={() => setSaleWarning(SALE_WARNING_AGE)}
              />
            </View>
          </View>
        ) : null}
      </Card>

      <SectionTitle>{drafts.length > 1 ? t('product.new.variants') : t('product.new.pricing')}</SectionTitle>
      {drafts.map((draft, index) => (
        <VariantDraftCard
          key={draft.key}
          draft={draft}
          onChange={(next) => updateDraft(draft.key, next)}
          title={drafts.length > 1 ? t('product.new.variantN', { n: index + 1 }) : undefined}
          onRemove={drafts.length > 1 ? () => removeDraft(draft.key) : undefined}
          axes={profile.axes}
          usesBarcodes={usesBarcodes}
          usesExpiry={usesExpiry}
          usesBatch={usesBatch}
          lowStockDefault={lowStockDefault}
        />
      ))}
      {canAddVariant ? (
        <Button
          label={t('product.new.addVariant', { axis: t(firstAxis.labelKey).toLowerCase() })}
          icon="add"
          variant="secondary"
          onPress={addDraft}
        />
      ) : null}

      {usesBarcodes && single && single.barcode.trim() !== '' ? (
        <Card>
          {scannable ? (
            <>
              <BarcodeLabel code={savedCode} viewRef={labelRef} />
              <View style={styles.labelActions}>
                <View style={styles.rowButton}>
                  <Button label={t('products.shareLabel')} variant="secondary" onPress={handleShareLabel} />
                </View>
                <View style={styles.rowButton}>
                  <Button label={t('products.printLabel')} variant="secondary" onPress={handlePrintLabel} />
                </View>
              </View>
            </>
          ) : (
            <Text style={styles.muted}>{t('products.notScannable')}</Text>
          )}
          {message ? <Text style={styles.success}>{message}</Text> : null}
        </Card>
      ) : null}

      {error ? <Text style={styles.error}>{error}</Text> : null}
    </Screen>
  );
}

const styles = themed(() => StyleSheet.create({
  rowButton: { flex: 1 },
  group: { gap: spacing.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  label: { fontSize: typeScale.label, color: colors.textMuted, fontWeight: '600' },
  labelActions: { flexDirection: 'row', gap: spacing.md },
  muted: { fontSize: typeScale.label, color: colors.textMuted },
  success: { fontSize: typeScale.label, color: colors.success, fontWeight: '600' },
  error: { fontSize: typeScale.label, color: colors.danger, fontWeight: '600' },
}));

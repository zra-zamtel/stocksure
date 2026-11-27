import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useRef, useState, type ComponentRef } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { captureRef } from 'react-native-view-shot';
import { usePermissionGuard } from '@/auth/permissions';
import { BarcodeLabel } from '@/components/barcode-label';
import { BigTile, PressScale, ProductTile, StepDots } from '@/components/big-ui';
import { Button, Card, Choice, Field, FormError, Icon, Screen } from '@/components/ui';
import { VariantDraftCard } from '@/components/variant-draft-card';
import {
  isValidEan13,
  normaliseBarcode,
  parsePrice,
  profileForShop,
  SALE_WARNING_AGE,
  SALE_WARNING_RX,
  sanitisePriceInput,
} from '@/core';
import { useShop } from '@/db/hooks';
import { createProductWithVariants } from '@/db/repos';
import { useI18n } from '@/i18n';
import { formatKwacha } from '@/lib/format';
import { labelHtml } from '@/lib/label';
import { discardPhoto, takeProductPhoto, type PhotoSource } from '@/lib/photos';
import { draftsToVariants, emptyDraft, nextDraft, type DraftProblem, type DraftVariant } from '@/lib/variant-drafts';
import { colors, fonts, iconSize, radii, spacing, themed, touch, typeScale } from '@/theme/tokens';

const STEPS = ['photo', 'name', 'price', 'count'] as const;
type Step = (typeof STEPS)[number];
const QUICK_COUNTS = [1, 5, 10];

/**
 * Adding a product, one question per screen: a photo, its name, what it
 * costs, how many there are. Everything else (sizes, barcode, unit, warning,
 * expiry, more variants) waits under "More details" on the last step, so the
 * common case is four taps and some typing.
 */
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

  const [step, setStep] = useState<Step>('photo');
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [name, setName] = useState('');
  const [category, setCategory] = useState('');
  // null until the owner picks one, so the profile's default applies once the shop loads.
  const [unitDraft, setUnitDraft] = useState<string | null>(null);
  const [saleWarning, setSaleWarning] = useState('');
  // One row per variant. A scanned code fills the first.
  const nextKey = useRef(1);
  const [drafts, setDrafts] = useState<DraftVariant[]>(() => [emptyDraft('v0', scannedBarcode ?? '')]);
  const [moreOpen, setMoreOpen] = useState(Boolean(scannedBarcode));
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
  const first = drafts[0];
  const extras = drafts.slice(1);
  const stepIndex = STEPS.indexOf(step);

  // The share/print label card covers the single-variant case; with several
  // variants, each label is printed from the product page.
  const single = drafts.length === 1 ? first : null;
  const savedCode = single && single.barcode.trim() !== '' ? normaliseBarcode(single.barcode) : '';
  const scannable = savedCode !== '' && isValidEan13(savedCode);

  // Profit per item while pricing, so a typo shows before saving.
  const buy = parsePrice(first.buyPrice);
  const sell = parsePrice(first.sellPrice);
  const margin = buy.ok && sell.ok ? sell.ngwee - buy.ngwee : null;
  const mood: 'good' | 'even' | 'bad' | null =
    margin === null ? null : margin > 0 ? 'good' : margin === 0 ? 'even' : 'bad';

  function updateFirst(patch: Partial<DraftVariant>) {
    setDrafts((current) => [{ ...current[0], ...patch }, ...current.slice(1)]);
  }

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

  async function pickPhoto(source: PhotoSource) {
    setError(null);
    setPhotoBusy(true);
    try {
      const result = await takeProductPhoto(source, name || 'product');
      if (result.status === 'saved') {
        // A retake replaces the earlier photo; do not leave it on the phone.
        discardPhoto(photoUri);
        setPhotoUri(result.uri);
      }
      if (result.status === 'denied') setError(t('product.photo.denied'));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('product.photo.failed'));
    } finally {
      setPhotoBusy(false);
    }
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

  /** Checks only what this step asked, so the owner fixes it where they typed it. */
  function stepError(current: Step): string | null {
    if (current === 'name' && !name.trim()) return t('product.ask.name');
    if (current === 'price') {
      if (!buy.ok) return t(`price.error.${buy.error}`, { field: t('products.buyPrice') });
      if (!sell.ok) return t(`price.error.${sell.error}`, { field: t('products.sellPrice') });
    }
    return null;
  }

  function goNext() {
    const problem = stepError(step);
    setError(problem);
    if (problem) return;
    setStep(STEPS[Math.min(STEPS.length - 1, stepIndex + 1)]);
  }

  function goBack() {
    setError(null);
    if (stepIndex === 0) router.back();
    else setStep(STEPS[stepIndex - 1]);
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

    if (!name.trim()) {
      setStep('name');
      setError(t('product.ask.name'));
      return;
    }
    const result = draftsToVariants(drafts, {
      axes: profile.axes,
      usesBarcodes,
      usesExpiry,
      usesBatch,
      lowStockDefault: shop?.lowStockDefault,
    });
    if (!result.ok) {
      // A problem with the first item's price belongs on the price step.
      if (result.problem.row === 1 && (result.problem.code === 'buyPrice' || result.problem.code === 'sellPrice')) {
        setStep('price');
      } else if (result.problem.code !== 'quantity' || result.problem.row !== 1) {
        setMoreOpen(true);
      }
      setError(problemMessage(result.problem));
      return;
    }

    setSaving(true);
    try {
      const created = await createProductWithVariants(db, {
        name,
        category: category.trim() || undefined,
        unit,
        saleWarning: usesSaleWarning ? saleWarning || undefined : undefined,
        photoUri: photoUri ?? undefined,
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
        await Sharing.shareAsync(uri, { mimeType: 'image/png', dialogTitle: t('products.shareLabel') });
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

  const last = step === 'count';
  const footer = (
    <View style={styles.footer}>
      <PressScale onPress={goBack} accessibilityLabel={t('product.previous')} style={styles.backButton}>
        <Icon name="arrow_back" size={iconSize.lg} color={colors.text} />
      </PressScale>
      <View style={styles.footerMain}>
        {last ? (
          <Button label={t('products.saveProduct')} icon="check" disabled={saving} loading={saving} onPress={handleSave} />
        ) : (
          <Button
            label={step === 'photo' && !photoUri ? t('product.skip') : t('product.next')}
            icon="arrow_forward"
            onPress={goNext}
          />
        )}
      </View>
    </View>
  );

  return (
    <Screen back title={t('product.new.title')} footer={footer}>
      <View style={styles.progress}>
        <StepDots
          count={STEPS.length}
          current={stepIndex}
          label={t('product.step', { current: stepIndex + 1, count: STEPS.length })}
        />
      </View>

      {step === 'photo' ? (
        <>
          <Text style={styles.ask}>{t('product.ask.photo')}</Text>
          <View style={styles.photo}>
            <ProductTile id="new-product" name={name || category} category={category} photoUri={photoUri} size={touch.big * 3} />
          </View>
          <View style={styles.tiles}>
            <BigTile
              icon="photo_camera"
              label={photoUri ? t('product.photo.retake') : t('product.photo.take')}
              tone="primary"
              onPress={() => void pickPhoto('camera')}
            />
            <BigTile icon="photo_library" label={t('product.photo.gallery')} onPress={() => void pickPhoto('library')} />
          </View>
          {photoBusy ? <Text style={styles.muted}>{t('state.loading')}</Text> : null}
          {/* Scanning opens a fresh form, so offer it only before anything is entered. */}
          {usesBarcodes && !photoUri && !name.trim() ? (
            <Button
              label={t('products.scanBarcode')}
              icon="barcode_scanner"
              variant="secondary"
              onPress={() => router.push(from ? { pathname: '/scan', params: { from } } : '/scan')}
            />
          ) : null}
        </>
      ) : null}

      {step === 'name' ? (
        <>
          <Text style={styles.ask}>{t('product.ask.name')}</Text>
          <Field
            label={t('product.new.name')}
            value={name}
            onChangeText={setName}
            placeholder={t('product.new.namePlaceholder')}
            autoFocus
            required
          />
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
        </>
      ) : null}

      {step === 'price' ? (
        <>
          <Text style={styles.ask}>{t('product.ask.price')}</Text>
          <Field
            label={t('product.buy')}
            value={first.buyPrice}
            onChangeText={(value) => updateFirst({ buyPrice: sanitisePriceInput(value) })}
            placeholder={t('product.new.buyPlaceholder')}
            keyboardType="decimal-pad"
            prefix="K"
            autoFocus
            required
          />
          <Field
            label={t('product.sell')}
            value={first.sellPrice}
            onChangeText={(value) => updateFirst({ sellPrice: sanitisePriceInput(value) })}
            placeholder={t('product.new.sellPlaceholder')}
            keyboardType="decimal-pad"
            prefix="K"
            required
          />
          {mood && margin !== null ? (
            <View style={styles.profit} accessibilityLiveRegion="polite">
              {/* An arrow, not only a colour: up for profit, down for a loss, flat for none. */}
              <Icon
                name={mood === 'good' ? 'trending_up' : mood === 'bad' ? 'trending_down' : 'trending_flat'}
                size={iconSize.xl}
                color={mood === 'good' ? colors.success : mood === 'bad' ? colors.danger : colors.warning}
              />
              <Text style={[styles.profitText, mood === 'bad' && styles.loss, mood === 'even' && styles.even]}>
                {mood === 'good'
                  ? t('product.profit.good', { amount: formatKwacha(margin) })
                  : mood === 'bad'
                    ? t('product.profit.bad', { amount: formatKwacha(-margin) })
                    : t('product.profit.even')}
              </Text>
            </View>
          ) : null}
        </>
      ) : null}

      {step === 'count' ? (
        <>
          <Text style={styles.ask}>{t('product.ask.count')}</Text>
          <View style={styles.countRow}>
            <ProductTile id="new-product" name={name} category={category} photoUri={photoUri} size={touch.big} />
            <Text style={styles.countValue} numberOfLines={1} adjustsFontSizeToFit>
              {first.quantity === '' ? '0' : first.quantity}
            </Text>
          </View>
          <View style={styles.quick}>
            {QUICK_COUNTS.map((n) => (
              <PressScale
                key={n}
                onPress={() => updateFirst({ quantity: String((Number.parseInt(first.quantity, 10) || 0) + n) })}
                accessibilityLabel={`+${n}`}
                style={styles.quickButton}
              >
                <Text style={styles.quickText}>+{n}</Text>
              </PressScale>
            ))}
          </View>
          <Field
            label={t('product.new.openingQty')}
            value={first.quantity}
            onChangeText={(value) => updateFirst({ quantity: value.replace(/\D/g, '') })}
            placeholder="0"
            keyboardType="numeric"
            required
          />

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('product.more')}
            accessibilityState={{ expanded: moreOpen }}
            onPress={() => setMoreOpen((open) => !open)}
            android_ripple={{ color: colors.ripple }}
            style={styles.moreToggle}
          >
            <Icon name="tune" size={iconSize.lg} color={colors.primaryInk} />
            <Text style={styles.moreText}>{t('product.more')}</Text>
            <Icon name={moreOpen ? 'expand_less' : 'expand_more'} size={iconSize.lg} color={colors.primaryInk} />
          </Pressable>

          {moreOpen ? (
            <>
              <Card>
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

              <VariantDraftCard
                draft={first}
                onChange={(next) => updateDraft(first.key, next)}
                title={drafts.length > 1 ? t('product.new.variantN', { n: 1 }) : undefined}
                axes={profile.axes}
                usesBarcodes={usesBarcodes}
                usesExpiry={usesExpiry}
                usesBatch={usesBatch}
                lowStockDefault={lowStockDefault}
                extrasOnly
              />
              {extras.map((draft, index) => (
                <VariantDraftCard
                  key={draft.key}
                  draft={draft}
                  onChange={(next) => updateDraft(draft.key, next)}
                  title={t('product.new.variantN', { n: index + 2 })}
                  onRemove={() => removeDraft(draft.key)}
                  axes={profile.axes}
                  usesBarcodes={usesBarcodes}
                  usesExpiry={usesExpiry}
                  usesBatch={usesBatch}
                  lowStockDefault={lowStockDefault}
                />
              ))}
              {firstAxis ? (
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
            </>
          ) : null}
        </>
      ) : null}

      {error ? <FormError message={error} /> : null}
    </Screen>
  );
}

const styles = themed(() => StyleSheet.create({
  progress: { alignItems: 'center' },
  ask: { fontFamily: fonts.display, fontSize: typeScale.title, color: colors.text },
  photo: { alignItems: 'center', paddingVertical: spacing.sm },
  tiles: { flexDirection: 'row', gap: spacing.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  group: { gap: spacing.sm },
  label: { fontSize: typeScale.label, color: colors.textMuted, fontWeight: '600' },
  profit: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  profitText: { flex: 1, fontFamily: fonts.display, fontSize: typeScale.heading, color: colors.success },
  loss: { color: colors.danger },
  even: { color: colors.warning },
  countRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg },
  countValue: {
    flex: 1,
    fontFamily: fonts.display,
    fontSize: typeScale.money,
    color: colors.text,
    fontVariant: ['tabular-nums'],
  },
  quick: { flexDirection: 'row', gap: spacing.sm },
  quickButton: {
    flex: 1,
    minHeight: touch.big,
    borderRadius: radii.lg,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primarySoft,
  },
  quickText: { fontFamily: fonts.display, fontSize: typeScale.title, color: colors.primaryInk },
  moreToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: touch.big,
    paddingHorizontal: spacing.xs,
    borderRadius: radii.md,
    overflow: 'hidden',
  },
  moreText: { flex: 1, fontSize: typeScale.body, fontWeight: '700', color: colors.primaryInk },
  footer: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  footerMain: { flex: 1 },
  backButton: {
    width: touch.big,
    height: touch.big,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceAlt,
  },
  rowButton: { flex: 1 },
  labelActions: { flexDirection: 'row', gap: spacing.md },
  muted: { fontSize: typeScale.body, color: colors.textMuted },
  success: { fontSize: typeScale.label, color: colors.success, fontWeight: '600' },
}));

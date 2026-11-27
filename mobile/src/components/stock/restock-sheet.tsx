// Add stock in a bottom sheet. Nothing is saved until the Save button: the
// buttons only change a draft count, so a wrong tap is undone by tapping again.
import { useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { usePermissionGuard } from '@/auth/permissions';
import { BottomSheet, PressScale, ProductTile } from '@/components/big-ui';
import { Button, Choice, FormError, Icon, TextLink } from '@/components/ui';
import { variantLabel } from '@/core';
import { restockVariant, type ProductWithStock } from '@/db/repos';
import { useI18n } from '@/i18n';
import { useNotifications } from '@/notifications/provider';
import { colors, fonts, iconSize, radii, spacing, themed, touch, typeScale } from '@/theme/tokens';

const STEPS = [1, 5, 10, 20];

function lowestVariantId(product: ProductWithStock): string | undefined {
  return product.variants.reduce<ProductWithStock['variants'][number] | undefined>(
    (lowest, variant) => (!lowest || variant.quantity < lowest.quantity ? variant : lowest),
    undefined
  )?.id;
}

export function RestockSheet({
  product,
  initialVariantId,
  onClose,
  onSaved,
}: {
  product: ProductWithStock | null;
  initialVariantId?: string;
  onClose: () => void;
  onSaved?: (result: { variantId: string; added: number; onHand: number }) => void;
}) {
  const { t } = useI18n();
  const db = useSQLiteContext();
  const router = useRouter();
  const guard = usePermissionGuard();
  const { afterRestock } = useNotifications();
  const [variantId, setVariantId] = useState<string | undefined>();
  const [draft, setDraft] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The sheet animates out after `product` goes null; keep the last one so it
  // does not empty while sliding away.
  const [shown, setShown] = useState<ProductWithStock | null>(product);
  if (product && product !== shown) setShown(product);
  const view = product ?? shown;

  // A new product (or a reopen) starts from the asked-for or emptiest variant.
  // Reset during render, keyed on the id, so a reload after saving keeps the draft.
  const productId = product?.id ?? null;
  const [seenId, setSeenId] = useState<string | null>(null);
  if (productId !== seenId) {
    setSeenId(productId);
    if (product) {
      setVariantId(
        initialVariantId && product.variants.some((v) => v.id === initialVariantId)
          ? initialVariantId
          : lowestVariantId(product)
      );
      setDraft(0);
      setError(null);
    }
  }

  const variant = view?.variants.find((v) => v.id === variantId) ?? view?.variants[0];
  const current = variant?.quantity ?? 0;

  function pick(id: string) {
    setVariantId(id);
    setDraft(0);
    setError(null);
  }

  async function save() {
    if (!variant || draft <= 0) return;
    setError(null);
    try {
      guard('products.manage');
    } catch {
      setError(t('permission.denied'));
      return;
    }
    setSaving(true);
    try {
      const result = await restockVariant(db, { variantId: variant.id, quantity: draft });
      afterRestock();
      onSaved?.({ variantId: variant.id, added: result.quantityAdded, onHand: result.quantityOnHand });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  function openDetails() {
    if (!view) return;
    const id = view.id;
    onClose();
    router.push(`/product/${id}`);
  }

  return (
    <BottomSheet visible={product !== null} onClose={onClose} title={t('stock.restock.title')} closeLabel={t('common.close')}>
      {view && variant ? (
        <View style={styles.body}>
          {view.variants.length > 1 ? (
            <View style={styles.pick}>
              <Text style={styles.label}>{t('stock.restock.pick')}</Text>
              <View style={styles.chips}>
                {view.variants.map((v) => (
                  <Choice
                    key={v.id}
                    label={variantLabel('', v) || view.name}
                    selected={v.id === variant.id}
                    onPress={() => pick(v.id)}
                  />
                ))}
              </View>
            </View>
          ) : null}

          <View style={styles.nameRow}>
            <ProductTile id={view.id} name={view.name} category={view.category} photoUri={view.photoUri} size={touch.big} />
            <Text style={styles.name} numberOfLines={2}>
              {view.name}
            </Text>
          </View>

          <Text style={styles.now} accessibilityLiveRegion="polite">
            {t('stock.restock.now', { count: current + draft })}
          </Text>

          <View style={styles.steps}>
            <PressScale
              onPress={() => setDraft((d) => Math.max(0, d - 1))}
              accessibilityLabel={t('stock.restock.less')}
              style={[styles.step, styles.less]}
            >
              <Icon name="remove" size={iconSize.lg} color={colors.text} />
            </PressScale>
            {STEPS.map((n) => (
              <PressScale
                key={n}
                onPress={() => setDraft((d) => d + n)}
                accessibilityLabel={`+${n}`}
                style={[styles.step, styles.more]}
              >
                <Text style={styles.stepText}>+{n}</Text>
              </PressScale>
            ))}
          </View>

          {error ? <FormError message={error} /> : null}

          <Button
            label={t('stock.restock.add', { count: draft })}
            icon="inventory"
            disabled={draft === 0}
            loading={saving}
            onPress={save}
          />
          <TextLink label={t('stock.restock.details')} onPress={openDetails} accent />
        </View>
      ) : null}
    </BottomSheet>
  );
}

const styles = themed(() =>
  StyleSheet.create({
    body: { gap: spacing.md },
    pick: { gap: spacing.xs },
    label: { fontSize: typeScale.label, color: colors.textMuted },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
    nameRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
    name: { flex: 1, fontFamily: fonts.display, fontSize: typeScale.heading, color: colors.text },
    now: {
      fontFamily: fonts.display,
      fontSize: typeScale.money,
      color: colors.text,
      textAlign: 'center',
      fontVariant: ['tabular-nums'],
    },
    steps: { flexDirection: 'row', gap: spacing.sm },
    step: {
      flex: 1,
      minHeight: touch.big,
      borderRadius: radii.lg,
      alignItems: 'center',
      justifyContent: 'center',
    },
    more: { backgroundColor: colors.primarySoft },
    less: { backgroundColor: colors.surfaceAlt },
    stepText: { fontFamily: fonts.display, fontSize: typeScale.title, color: colors.primaryInk },
  })
);

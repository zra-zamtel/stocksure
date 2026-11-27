import { useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '@/auth/session';
import { displayName } from '@/components/auth';
import { Toggle } from '@/components/charts';
import { Button, Choice, Field, Icon, IconButton, Screen, SectionTitle, TextLink } from '@/components/ui';
import { isValidTpin, PROFILES, profileForShop, type ProfileId } from '@/core';
import { useShop, useSmartInvoiceLink } from '@/db/hooks';
import { saveMoneySettings, saveShopDetails } from '@/db/repos';
import { useSync } from '@/db/use-sync';
import { LANGUAGE_LABELS, useI18n, type Language } from '@/i18n';
import { ConnectReminder, SyncProblemBanner } from '@/components/connect-device';
import { formatDateTime } from '@/lib/format';
import { colors, elevation, radii, setThemePreference, spacing, themed, type ThemePreference, themePreference, touch, typeScale } from '@/theme/tokens';

const PROVIDERS = ['MTN', 'Airtel', 'Zamtel'] as const;

export default function SettingsScreen() {
  const { t, language, setLanguage } = useI18n();
  const router = useRouter();
  const db = useSQLiteContext();
  const { ownerPreview, signOut, refresh, deviceToken } = useAuth();
  const { data: shop, reload } = useShop();
  const [theme, setTheme] = useState<ThemePreference>(themePreference);
  const { data: smartInvoice } = useSmartInvoiceLink();
  const sync = useSync();

  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const [town, setTown] = useState('');
  const [profileId, setProfileId] = useState<ProfileId>('fashion');
  const [usesBarcodes, setUsesBarcodes] = useState(false);
  const [providers, setProviders] = useState<string[]>([]);
  const [tpin, setTpin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function changeLanguage(next: Language) {
    setLanguage(next);
    // Keep the shop record in step so the choice syncs and survives a reinstall.
    if (!shop) return;
    try {
      await saveShopDetails(db, {
        name: shop.name,
        town: shop.town,
        profileId: profileForShop(shop).id,
        usesBarcodes: shop.usesBarcodes,
        language: next,
      });
      reload();
    } catch {
      // The on-screen switch already happened; the shop row catches up next save.
    }
  }

  function startEditing() {
    if (!shop) return;
    setName(shop.name);
    setTown(shop.town);
    setProfileId(profileForShop(shop).id);
    setUsesBarcodes(shop.usesBarcodes);
    setProviders(shop.providers);
    setTpin(shop.tpin ?? '');
    setError(null);
    setEditing(true);
  }

  async function saveEdits() {
    if (!shop || saving) return;
    setError(null);
    if (!name.trim()) return setError(t('onboarding.shop.error.nameRequired'));
    if (!town.trim()) return setError(t('onboarding.shop.error.townRequired'));
    if (tpin.trim() && !isValidTpin(tpin)) return setError(t('onboarding.money.tpinInvalid'));

    setSaving(true);
    try {
      await saveShopDetails(db, {
        name,
        town,
        profileId,
        usesBarcodes,
        language,
      });
      await saveMoneySettings(db, {
        providers,
        turnoverTaxRegistered: shop.turnoverTaxRegistered,
        tpin: tpin.trim() || undefined,
      });
      await refresh();
      reload();
      setEditing(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('onboarding.account.error.generic'));
    } finally {
      setSaving(false);
    }
  }

  const toggleProvider = (provider: string) =>
    setProviders((current) =>
      current.includes(provider) ? current.filter((item) => item !== provider) : [...current, provider],
    );

  return (
    <Screen
      title={t('settings.title')}
      subtitle={shop?.name ?? t('app.name')}
      action={<IconButton name="close" label={t('common.back')} onPress={() => router.back()} />}
    >
      <View style={styles.group}>
        <SectionTitle>{t('settings.language')}</SectionTitle>
        <Toggle
          options={(Object.keys(LANGUAGE_LABELS) as Language[]).map((code) => ({
            value: code,
            label: LANGUAGE_LABELS[code],
          }))}
          value={language}
          onChange={(code) => void changeLanguage(code)}
        />
      </View>

      <View style={styles.group}>
        <SectionTitle>{t('settings.appearance')}</SectionTitle>
        <Toggle
          options={(['system', 'light', 'dark'] as ThemePreference[]).map((value) => ({
            value,
            label: t(`theme.${value}`),
          }))}
          value={theme}
          onChange={(value) => {
            setTheme(value);
            setThemePreference(value);
          }}
        />
        <Text style={styles.hint}>{t('theme.hint')}</Text>
      </View>

      {editing ? (
        <Group title={t('settings.shop')}>
          <View style={styles.groupPad}>
            <Field label={t('onboarding.shop.name')} value={name} onChangeText={setName} required />
            <Field label={t('onboarding.shop.town')} value={town} onChangeText={setTown} required />

            <Text style={styles.label}>{t('settings.profile')}</Text>
            <View style={styles.wrap}>
              {PROFILES.map((profile) => (
                <View key={profile.id} style={styles.pairItem}>
                  <Choice
                    label={t(profile.nameKey)}
                    selected={profileId === profile.id}
                    onPress={() => setProfileId(profile.id)}
                  />
                </View>
              ))}
            </View>
            <Text style={styles.hint}>{t('settings.profileHint')}</Text>

            <Text style={styles.label}>{t('onboarding.money.providers')}</Text>
            <View style={styles.wrap}>
              {PROVIDERS.map((provider) => (
                <View key={provider} style={styles.pairItem}>
                  <Choice
                    label={provider}
                    selected={providers.includes(provider)}
                    onPress={() => toggleProvider(provider)}
                  />
                </View>
              ))}
            </View>

            <Field
              label={t('onboarding.money.tpin')}
              value={tpin}
              onChangeText={setTpin}
              placeholder={t('onboarding.money.tpinHint')}
              keyboardType="numeric"
              maxLength={10}
            />

            <Text style={styles.label}>{t('onboarding.shop.barcodes')}</Text>
            <View style={styles.pair}>
              <View style={styles.pairItem}>
                <Choice
                  label={t('common.yes')}
                  selected={usesBarcodes}
                  onPress={() => setUsesBarcodes(true)}
                />
              </View>
              <View style={styles.pairItem}>
                <Choice
                  label={t('common.no')}
                  selected={!usesBarcodes}
                  onPress={() => setUsesBarcodes(false)}
                />
              </View>
            </View>

            {error ? (
              <Text style={styles.error} accessibilityLiveRegion="polite">
                {error}
              </Text>
            ) : null}
            <View style={styles.pair}>
              <View style={styles.pairItem}>
                <Button label={t('common.cancel')} variant="secondary" onPress={() => setEditing(false)} />
              </View>
              <View style={styles.pairItem}>
                <Button
                  label={saving ? t('common.saving') : t('common.save')}
                  disabled={saving}
                  loading={saving}
                  onPress={() => void saveEdits()}
                />
              </View>
            </View>
          </View>
        </Group>
      ) : (
        <Group
          title={t('settings.shop')}
          action={shop ? <TextLink accent label={t('settings.edit')} onPress={startEditing} /> : undefined}
        >
          <ListRow label={t('onboarding.shop.name')} value={shop?.name ?? t('common.notYet')} />
          <ListRow label={t('onboarding.shop.town')} value={shop?.town ?? t('common.notYet')} />
          <ListRow
            label={t('settings.profile')}
            value={shop ? t(profileForShop(shop).nameKey) : t('common.notYet')}
          />
          <ListRow
            label={t('settings.mobileMoney')}
            value={shop && shop.providers.length > 0 ? shop.providers.join(', ') : t('common.notYet')}
          />
          <ListRow label={t('onboarding.money.tpin')} value={shop?.tpin ?? t('common.notYet')} />
          <ListRow
            label={t('settings.barcodes')}
            value={shop ? (shop.usesBarcodes ? t('common.yes') : t('common.no')) : t('common.notYet')}
            last
          />
        </Group>
      )}

      {/* Rows that open another screen live apart from the read-only shop
          details, so it is clear which rows are links. */}
      {editing ? null : (
        <Group title={t('settings.services')}>
          <ListRow
            label={t('si.title')}
            value={smartInvoice ? t('si.settings.connected') : t('si.settings.connect')}
            onPress={() => router.push('/smart-invoice')}
          />
          <ListRow
            label={t('tr.title')}
            value={t('tr.settings')}
            onPress={() => router.push('/trading-record')}
            last
          />
        </Group>
      )}

      <Group title={t('settings.people')}>
        <ListRow
          label={ownerPreview ? displayName(ownerPreview.name) : t('common.notYet')}
          value={t('staff.role.owner')}
        />
        <ListRow label={t('settings.manageStaff')} onPress={() => router.push('/staff')} last />
      </Group>

      <Group
        title={t('settings.sync')}
        action={
          <TextLink
            accent
            label={sync.busy ? t('sync.syncing') : t('sync.now')}
            onPress={() => {
              if (!sync.busy) void sync.syncNow();
            }}
          />
        }
      >
        <ListRow
          label={t('sync.lastSync')}
          value={sync.lastSyncAt ? formatDateTime(sync.lastSyncAt) : t('sync.never')}
        />
        <ListRow label={t('sync.pending')} value={String(sync.pending)} last />
      </Group>
      {/* Sync needs this phone connected: the strip opens the connect sheet. */}
      {deviceToken ? <SyncProblemBanner /> : <ConnectReminder dismissible={false} />}

      <Pressable
        accessibilityRole="button"
        onPress={signOut}
        style={({ pressed }) => [styles.signOut, pressed && styles.pressed]}
      >
        <Icon name="logout" size={20} color={colors.danger} />
        <Text style={styles.signOutText}>{t('settings.signOut')}</Text>
      </Pressable>

      {/* Kept apart from Sign out and worded plainly: this one clears the
          phone, after a backup check and the owner PIN on the next screen. */}
      <Group title={t('handOver.settingsGroup')}>
        <ListRow
          label={t('handOver.title')}
          value={t('handOver.settingsHint')}
          onPress={() => router.push('/hand-over')}
          last
        />
      </Group>

      <View style={styles.footer}>
        <Text style={styles.muted}>{t('settings.version')} 0.1.0</Text>
      </View>
    </Screen>
  );
}

const styles = themed(() => StyleSheet.create({
  pair: { flexDirection: 'row', gap: spacing.md },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  pairItem: { flexGrow: 1, flexBasis: '40%' },
  label: {
    fontSize: typeScale.label,
    fontWeight: '600',
    color: colors.textMuted,
    marginTop: spacing.sm,
  },
  ownerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  ownerName: {
    fontSize: typeScale.body,
    fontWeight: '600',
    color: colors.text,
  },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 48,
  },
  link: {
    fontSize: typeScale.body,
    color: colors.primaryInk,
    fontWeight: '600',
  },
  pressed: { backgroundColor: colors.surfaceAlt },
  muted: {
    fontSize: typeScale.label,
    color: colors.textMuted,
    textAlign: 'center',
  },
  error: { fontSize: typeScale.body, color: colors.danger, fontWeight: '600' },
  signOut: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    minHeight: touch.minHeight + 4,
    marginTop: spacing.md,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.danger,
    backgroundColor: colors.surface,
  },
  signOutText: {
    fontSize: typeScale.body,
    fontWeight: '700',
    color: colors.danger,
  },
  group: { gap: spacing.xs },
  groupHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 32,
  },
  groupCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    overflow: 'hidden',
    ...elevation.card,
  },
  groupPad: { padding: spacing.lg, gap: spacing.sm },
  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 52,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  listRowLast: { paddingBottom: spacing.md },
  rowLabel: { flex: 1, fontSize: typeScale.body, color: colors.textMuted },
  rowValue: {
    flexShrink: 1,
    maxWidth: '60%',
    textAlign: 'right',
    fontSize: typeScale.body,
    color: colors.text,
    fontWeight: '600',
  },
  footer: { alignItems: 'center', marginTop: spacing.md },
  hint: { fontSize: typeScale.label, color: colors.textMuted },
}));

/** A titled group of rows on one card, with an optional small action. */
function Group({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <View style={styles.group}>
      <View style={styles.groupHead}>
        <SectionTitle>{title}</SectionTitle>
        {action}
      </View>
      <View style={styles.groupCard}>{children}</View>
    </View>
  );
}

/** Label on the left, value on the right; tappable rows get a chevron. */
function ListRow({
  label,
  value,
  onPress,
  last,
}: {
  label: string;
  value?: string;
  onPress?: () => void;
  last?: boolean;
}) {
  const content = (
    <>
      <Text style={styles.rowLabel} numberOfLines={2}>
        {label}
      </Text>
      {value ? (
        <Text style={styles.rowValue} numberOfLines={2}>
          {value}
        </Text>
      ) : null}
      {onPress ? <Icon name="chevron_right" color={colors.textMuted} /> : null}
    </>
  );
  const style = [styles.listRow, last && styles.listRowLast];
  return onPress ? (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [style, pressed && styles.pressed]}
    >
      {content}
    </Pressable>
  ) : (
    <View style={style}>{content}</View>
  );
}

import { Image, Pressable, StyleSheet, Text, View, type ImageSourcePropType } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import type { Provider } from '@/core';
import { colors, fonts, iconSize, radii, spacing, themed, touch, typeScale } from '@/theme/tokens';
import { Icon } from './ui';

/**
 * Official network logos, used as supplied: never redrawn or recoloured.
 * Each sits on a tile of its own background colour, so a wide logo (MTN) or
 * one with a coloured square (Airtel) fills the tile without a white band.
 * `inset` is how much of the tile the picture covers.
 */
type Logo = { source: ImageSourcePropType; background: string; inset: `${number}%` };

const LOGOS: Record<Provider, Logo | null> = {
  MTN: { source: require('../../assets/images/networks/mtn.jpg'), background: '#FFCB01', inset: '100%' },
  Airtel: { source: require('../../assets/images/networks/airtel.png'), background: '#E30010', inset: '100%' },
  Zamtel: { source: require('../../assets/images/networks/zamtel.jpg'), background: '#FFFFFF', inset: '92%' },
};

/** How each network's wallet is usually called at the counter. */
export const WALLET_NAMES: Record<Provider, string> = {
  MTN: 'MTN MoMo',
  Airtel: 'Airtel Money',
  Zamtel: 'Zamtel Kwacha',
};

/** A network's logo on a small tile, or its name on a neutral tile if a logo is missing. */
export function NetworkMark({ provider, size = 32 }: { provider: Provider; size?: number }) {
  const logo = LOGOS[provider];
  const box = { width: size, height: size, borderRadius: Math.round(size * 0.25) };
  if (logo) {
    return (
      <View style={[styles.logoTile, box, { backgroundColor: logo.background }]} accessible={false}>
        <Image source={logo.source} style={{ width: logo.inset, height: logo.inset }} resizeMode="contain" />
      </View>
    );
  }
  return (
    <View style={[styles.fallback, box]} accessible={false}>
      <Text style={[styles.fallbackText, { fontSize: Math.max(9, Math.round(size * 0.28)) }]} numberOfLines={1}>
        {provider === 'Zamtel' ? 'ZAM' : provider.toUpperCase().slice(0, 3)}
      </Text>
    </View>
  );
}

/** The detected network's mark, fading in at the end of the phone field once the prefix tells. */
export function DetectedNetwork({ provider }: { provider: Provider | null }) {
  if (!provider) return null;
  return (
    <Animated.View key={provider} entering={FadeIn.duration(160)} exiting={FadeOut.duration(120)}>
      <NetworkMark provider={provider} size={30} />
    </Animated.View>
  );
}

/** One network as a selectable tile: mark, wallet name, and a tick when chosen. */
export function NetworkOption({
  provider,
  selected,
  onPress,
}: {
  provider: Provider;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={WALLET_NAMES[provider]}
      onPress={onPress}
      android_ripple={{ color: colors.ripple }}
      style={({ pressed }) => [styles.option, selected && styles.optionSelected, pressed && styles.optionPressed]}
    >
      <NetworkMark provider={provider} size={36} />
      <Text style={[styles.optionLabel, selected && styles.optionLabelSelected]} numberOfLines={1}>
        {provider}
      </Text>
      {selected ? (
        <View style={styles.tick}>
          <Icon name="check" size={iconSize.sm} color={colors.primaryText} />
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = themed(() =>
  StyleSheet.create({
    // Logos keep their own colours in both themes, as brand rules ask.
    logoTile: {
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    fallback: {
      backgroundColor: colors.surfaceAlt,
      alignItems: 'center',
      justifyContent: 'center',
    },
    fallbackText: { fontFamily: fonts.display, color: colors.text, letterSpacing: 0.2 },
    option: {
      flex: 1,
      minHeight: touch.minHeight + spacing.xl + spacing.sm,
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing.xs,
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.xs,
      borderRadius: radii.lg,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      overflow: 'hidden',
    },
    optionSelected: { borderColor: colors.primary, borderWidth: 2, backgroundColor: colors.primarySoft },
    optionPressed: { backgroundColor: colors.surfaceAlt },
    optionLabel: { fontSize: typeScale.label, fontWeight: '600', color: colors.text },
    optionLabelSelected: { color: colors.primaryInk, fontWeight: '700' },
    tick: {
      position: 'absolute',
      top: spacing.xs,
      right: spacing.xs,
      width: 20,
      height: 20,
      borderRadius: radii.pill,
      backgroundColor: colors.primary,
      alignItems: 'center',
      justifyContent: 'center',
    },
  })
);

import { useMemo, type ComponentRef, type RefObject } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { encodeEan13 } from '@/core';
import { colors, typeScale } from '@/theme/tokens';

type ViewRef = ComponentRef<typeof View>;

type Props = {
  code: string;
  height?: number;
  moduleWidth?: number;
  viewRef?: RefObject<ViewRef | null>;
};

/**
 * Draws EAN-13 with plain Views, so no barcode rendering library is needed.
 * Bars are pure black on white with a quiet zone each side; that is what makes
 * the label scannable when printed, not the pretty display below it.
 */
export function BarcodeLabel({ code, height = 88, moduleWidth = 2, viewRef }: Props) {
  const bits = useMemo(() => encodeEan13(code), [code]);
  const quiet = moduleWidth * 10;

  return (
    <View ref={viewRef} collapsable={false} style={styles.wrap}>
      <View style={[styles.bars, { height }]}>
        <View style={{ width: quiet, backgroundColor: '#FFFFFF' }} />
        {bits.split('').map((bit, index) => (
          <View
            key={`${index}-${bit}`}
            style={{
              width: moduleWidth,
              height: '100%',
              backgroundColor: bit === '1' ? '#000000' : '#FFFFFF',
            }}
          />
        ))}
        <View style={{ width: quiet, backgroundColor: '#FFFFFF' }} />
      </View>
      <Text style={styles.digits}>{code}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignSelf: 'center',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderRadius: 8,
    gap: 4,
  },
  bars: { flexDirection: 'row', alignItems: 'stretch' },
  digits: { color: colors.text, fontSize: typeScale.caption, letterSpacing: 2 },
});

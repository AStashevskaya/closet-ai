import type { LimitCode } from '@closet-ai/shared';
import { WANT_MORE_CODES } from '@closet-ai/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text } from 'react-native';

import { maison } from '@/components/maison';
import { wantMore } from '@/lib/api';
import { colors, fonts } from '@/theme';

// Under a reached limit: tells us someone would want more of this (decided 2026-11-08), to measure
// demand before there's anything to buy. It says nothing about a price or a date, because there
// are none yet. A failed request isn't worth her attention, so the thanks show regardless.
export function WantMore({ code }: { code: LimitCode }) {
  const { t } = useTranslation();
  // The limit tapped for: another limit reached on the same screen still gets its own tap.
  const [sent, setSent] = useState<LimitCode | null>(null);

  // Only limits a plan could lift: not the server's daily stop or the safety caps.
  if (!(WANT_MORE_CODES as readonly string[]).includes(code)) return null;
  if (sent === code) return <Text style={styles.thanks}>{t('limits.wantMoreThanks')}</Text>;
  return (
    <Pressable
      onPress={() => {
        setSent(code);
        void wantMore(code).catch(() => undefined);
      }}
      hitSlop={8}
      accessibilityRole="button"
      style={styles.button}
    >
      <Text style={maison.link}>{t('limits.wantMore')}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: { alignSelf: 'center', marginTop: 8 },
  thanks: {
    alignSelf: 'center',
    marginTop: 8,
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.textMuted,
  },
});

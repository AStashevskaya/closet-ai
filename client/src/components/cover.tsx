import type { Inspiration } from '@closet-ai/shared';
import { BlurView } from 'expo-blur';
import { Image } from 'expo-image';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState, type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { absoluteUrl, listInspiration, sessionHeaders } from '@/lib/api';
import { colors, fonts } from '@/theme';

type Cover = { url: string; headers: Record<string, string> };

const DAY_MS = 24 * 60 * 60 * 1000;

// One of the user's saved looks, a different one each day, so every screen's cover is her own
// taste; null while loading and when nothing is saved (the cover then falls back to the bright
// block).
export function pickCover(looks: Inspiration[], now = Date.now()): Inspiration | null {
  if (looks.length === 0) return null;
  return looks[Math.floor(now / DAY_MS) % looks.length]!;
}

function useCover(): Cover | null {
  const [cover, setCover] = useState<Cover | null>(null);
  // Reloaded when the screen comes into view: a look saved or deleted meanwhile counts.
  useFocusEffect(
    useCallback(() => {
      const load = async () => {
        try {
          const [looks, headers] = await Promise.all([listInspiration(), sessionHeaders()]);
          const look = pickCover(looks);
          setCover(look ? { url: absoluteUrl(look.url), headers } : null);
        } catch {
          // The bright block is a fine cover too.
        }
      };
      void load();
    }, []),
  );
  return cover;
}

type Props = {
  eyebrow: string;
  title: string;
  text: string;
  // The block's action, under the text.
  children?: ReactNode;
};

// The editorial block at the top of a screen: the user's saved look as a photo with the words
// on a frosted strip over it, or the bright block when she has saved none.
export function EditorialCover({ eyebrow, title, text, children }: Props) {
  const cover = useCover();

  if (!cover) {
    return (
      <View style={[styles.block, styles.bright]}>
        <Words eyebrow={eyebrow} title={title} text={text} />
        {children}
      </View>
    );
  }
  return (
    <View style={[styles.block, styles.photo]}>
      <Image
        source={{ uri: cover.url, headers: cover.headers }}
        style={StyleSheet.absoluteFill}
        contentFit="cover"
        transition={600}
        accessibilityIgnoresInvertColors
      />
      <BlurView
        intensity={50}
        tint="light"
        experimentalBlurMethod="dimezisBlurView"
        style={styles.strip}
      >
        <Words eyebrow={eyebrow} title={title} text={text} />
        {children}
      </BlurView>
    </View>
  );
}

function Words({ eyebrow, title, text }: Omit<Props, 'children'>) {
  return (
    <>
      <Text style={styles.eyebrow}>{eyebrow}</Text>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.text}>{text}</Text>
    </>
  );
}

// textAlign has no start/end in React Native: 'left' follows the layout direction, so it acts as start in RTL.
const styles = StyleSheet.create({
  block: {
    marginHorizontal: 10,
    overflow: 'hidden',
  },
  bright: {
    paddingHorizontal: 22,
    paddingTop: 26,
    paddingBottom: 22,
    gap: 8,
    backgroundColor: colors.highlight,
  },
  photo: {
    minHeight: 460,
    justifyContent: 'flex-end',
    backgroundColor: colors.hero,
  },
  // Milky enough for ink text to read over any photo.
  strip: {
    paddingHorizontal: 22,
    paddingTop: 20,
    paddingBottom: 22,
    gap: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.55)',
  },
  eyebrow: {
    fontFamily: fonts.bodyMedium,
    fontSize: 12,
    color: colors.text,
    textAlign: 'left',
  },
  title: {
    fontFamily: fonts.displayLight,
    fontSize: 34,
    lineHeight: 38,
    color: colors.text,
    textAlign: 'left',
  },
  text: {
    fontFamily: fonts.body,
    fontSize: 14,
    lineHeight: 20,
    color: colors.text,
    textAlign: 'left',
  },
});

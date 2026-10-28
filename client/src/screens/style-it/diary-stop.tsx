import type { Outfit, StyledEntry } from '@closet-ai/shared';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';

import { FlatLay } from '@/components/flat-lay';
import { seedFrom } from '@/components/hand-drawn';
import { ItemPhoto } from '@/components/item-photo';
import { PressableScale } from '@/components/pressable-scale';
import { getWearWith } from '@/lib/api';
import { appLanguage } from '@/lib/app-language';
import { dayLabel } from '@/lib/day-label';
import { colors, fonts } from '@/theme';

import { ThreadRow } from './thread-row';

type Props = {
  entry: StyledEntry;
  headers: Record<string, string> | undefined;
  joined: boolean;
  last: boolean;
  onOpen: () => void;
};

// A piece styled before, on Style it's diary thread (decided 2026-10-28): the piece, when, and its
// looks folded small (a heart on the liked ones, the rejected ones left out). A tap opens it.
export function DiaryStop({ entry, headers, joined, last, onOpen }: Props) {
  const { t, i18n } = useTranslation();
  const looks = usePeek(entry.id);
  const shown = looks?.filter((look) => look.opinion !== 'dislike') ?? [];
  return (
    <ThreadRow kind="root" joined={joined} last={last} hollow>
      <PressableScale
        style={styles.stop}
        onPress={onOpen}
        accessibilityRole="button"
        accessibilityLabel={t('styleIt.open', { name: entry.name })}
        accessibilityHint={dayLabel(entry.createdAt, t, i18n.language)}
      >
        <View style={styles.who}>
          <ItemPhoto
            item={{
              photoUrl: entry.photoUrl ?? undefined,
              cutoutUrl: entry.cutoutUrl ?? undefined,
            }}
            headers={headers}
            style={styles.piece}
          />
          <View style={styles.text}>
            <Text style={styles.name} numberOfLines={2}>
              {entry.name}
            </Text>
            <Text style={styles.when}>
              {dayLabel(entry.createdAt, t, i18n.language)}
              {entry.mood && ` · ${t(`wearWith.moods.${entry.mood}`)}`}
            </Text>
          </View>
        </View>
        {shown.length > 0 && (
          <View
            style={styles.peek}
            importantForAccessibility="no-hide-descendants"
            accessibilityElementsHidden
          >
            {shown.slice(0, 3).map((look) => (
              <View key={look.id} style={styles.mini}>
                <FlatLay
                  pieces={look.pieces.flatMap((p) => (p.item ? [p.item] : []))}
                  headers={headers}
                  caption={look.caption}
                  loved={look.opinion === 'like'}
                  seed={seedFrom(look.id)}
                  small
                />
              </View>
            ))}
          </View>
        )}
      </PressableScale>
    </ThreadRow>
  );
}

// The looks of a request done before, read once when the stop appears (it stays mounted across
// visits to the tab), with no polling: one still being written shows none.
function usePeek(id: string | null) {
  const { i18n } = useTranslation();
  const lang = appLanguage(i18n.language);
  const [looks, setLooks] = useState<{ id: string; outfits: Outfit[] } | null>(null);
  useEffect(() => {
    if (!id) return;
    let gone = false;
    const load = async () => {
      try {
        const request = await getWearWith(id, lang);
        if (!gone && request.status === 'done') setLooks({ id, outfits: request.outfits });
      } catch {
        // A peek is a nicety: the stop works without it.
      }
    };
    void load();
    return () => {
      gone = true;
    };
  }, [id, lang]);
  return looks?.id === id ? looks.outfits : null;
}

// textAlign has no start/end in React Native: 'left' follows the layout direction, so it acts as start in RTL.
const styles = StyleSheet.create({
  stop: {
    paddingBottom: 30,
    gap: 12,
  },
  who: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  piece: {
    width: 64,
    height: 72,
  },
  text: {
    flex: 1,
    gap: 2,
  },
  name: {
    fontFamily: fonts.displayLight,
    fontSize: 24,
    lineHeight: 28,
    color: colors.text,
    textAlign: 'left',
  },
  when: {
    fontFamily: fonts.hand,
    fontSize: 18,
    lineHeight: 22,
    color: colors.text,
    textAlign: 'left',
  },
  peek: {
    flexDirection: 'row',
    gap: 8,
  },
  // A square of its own: the flat lay inside sizes itself by its width, which a bare flex cell
  // doesn't give it on the phone (it came out 0 high, 2026-10-28).
  mini: {
    flex: 1,
    aspectRatio: 1,
  },
});

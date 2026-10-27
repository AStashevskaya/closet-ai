import type { OutfitMood } from '@closet-ai/shared';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, ScrollView, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { askWearWith, sessionHeaders } from '@/lib/api';
import { appLanguage } from '@/lib/app-language';
import { askFailedText, useUsage } from '@/lib/limits';
import type { StyledPiece } from '@/lib/styled';
import { StyleThread } from '@/screens/style-it/style-thread';
import { colors } from '@/theme';

type Props = {
  requestId: string;
  piece: StyledPiece;
  mood: OutfitMood | null;
};

// A closet piece's outfits on Style it's thread, pushed over the item screen (owner, 2026-10-27),
// so going back returns to the piece. A piece from a photo keeps the outfits screen, which also has
// the verdict and "Add to my closet".
export function Styled({ requestId, piece, mood }: Props) {
  const { t, i18n } = useTranslation();
  const insets = useSafeAreaInsets();
  const { usage, refresh: refreshUsage } = useUsage();
  const [headers, setHeaders] = useState<Record<string, string>>();
  // "Try again" asks afresh: the new request replaces the one from the route.
  const [request, setRequest] = useState(requestId);
  const [asking, setAsking] = useState(false);

  useEffect(() => {
    // An effect can't be async itself, so the async work goes in an inner function.
    const loadHeaders = async () => {
      try {
        setHeaders(await sessionHeaders());
      } catch {
        setHeaders({});
      }
    };
    void loadHeaders();
  }, []);

  async function askAgain() {
    setAsking(true);
    try {
      const { id } = await askWearWith(
        mood ? { itemId: piece.id, mood } : { itemId: piece.id },
        appLanguage(i18n.language),
      );
      void refreshUsage();
      setRequest(id);
    } catch (cause) {
      if (__DEV__) console.warn('Asking for outfits failed', cause);
      Alert.alert(askFailedText(t, i18n.language, cause, usage));
    } finally {
      setAsking(false);
    }
  }

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 40 }]}
    >
      <StyleThread
        chosen={{ requestId: request, ...piece }}
        headers={headers}
        onAskAgain={askAgain}
        asking={asking}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    paddingTop: 16,
  },
});

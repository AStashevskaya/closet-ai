import type { ItemDetail } from '@closet-ai/shared';
import { Image } from 'expo-image';
import { type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { I18nManager, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { useReducedMotion } from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';

import { cutoutShadow } from '@/components/cutout-shadow';
import { Hanger, HANGERS } from '@/components/hanger';
import { absoluteUrl } from '@/lib/api';
import { CSS_EASE_OUT, durations, rise, STAGGER_STEP } from '@/motion';
import { colors, fonts } from '@/theme';

// "The cut-out went wrong" (decided 2026-11-13, direction A of the prototype
// `~/Desktop/closet/wrinkle-lab/design-cutout-fix`): a quiet line on the item screen opens a sheet
// with the piece both ways, side by side, and she picks how it hangs everywhere. The cut-out stays
// stored on the server, so the choice can always be undone from here.

// The item as shown after choosing: without the cut-out, or with the stored one back. The server's
// answer replaces it (with the cut-out's box) a moment later.
export function shownAs(item: ItemDetail, showPhoto: boolean): ItemDetail {
  return showPhoto
    ? { ...item, showPhoto, cutoutUrl: undefined, cutoutBox: undefined }
    : { ...item, showPhoto, cutoutUrl: item.storedCutoutUrl };
}

// Only a piece with a cut-out has anything to choose.
export const canChooseHang = (item: ItemDetail) => Boolean(item.storedCutoutUrl && item.photoUrl);

// Under the rail: small, underlined, never shouting. It reads as the way to the other version.
export function HangChoiceLink({
  showPhoto,
  onPress,
}: {
  showPhoto: boolean;
  onPress: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Pressable
      onPress={onPress}
      style={styles.link}
      hitSlop={6}
      accessibilityRole="button"
      testID="hang-choice-link"
    >
      <Text style={styles.linkText}>{t(showPhoto ? 'item.hang.askPhoto' : 'item.hang.ask')}</Text>
    </Pressable>
  );
}

// Space between the two versions, and the height of the thread from the hanger down to the chosen one.
const GAP = 14;
const THREAD_HEIGHT = 52;

type Props = {
  item: ItemDetail;
  headers: Record<string, string> | undefined;
  visible: boolean;
  // A choice is being saved: both versions wait for it.
  saving: boolean;
  onChoose: (showPhoto: boolean) => void;
  onClose: () => void;
};

export function HangChoiceSheet({ item, headers, visible, saving, onChoose, onClose }: Props) {
  const { t } = useTranslation();
  const reduced = useReducedMotion();
  const [width, setWidth] = useState(0);
  const showPhoto = item.showPhoto ?? false;
  const enter = (step: number) => (reduced ? undefined : rise.delay(step * STAGGER_STEP));

  // The thread runs from the hanger's hook, in the middle, to the top of the chosen version. In
  // Hebrew the row runs right to left, so the cut-out is on the right.
  const card = (width - GAP) / 2;
  const photoOnRight = !I18nManager.isRTL;
  const end = showPhoto === photoOnRight ? width - card / 2 : card / 2;
  const mid = width / 2;
  const thread = `M${mid} 0 C${mid} ${THREAD_HEIGHT * 0.55}, ${end} ${THREAD_HEIGHT * 0.45}, ${end} ${THREAD_HEIGHT}`;

  return (
    <Modal
      visible={visible}
      animationType={reduced ? 'none' : 'slide'}
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={styles.sheet} accessibilityViewIsModal testID="hang-choice-sheet">
        <Animated.Text entering={enter(0)} style={styles.title} accessibilityRole="header">
          {t('item.hang.title')}
        </Animated.Text>

        <Animated.View
          entering={enter(1)}
          onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
        >
          <View
            style={styles.hanger}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          >
            <Hanger kind={HANGERS[item.category]} />
          </View>
          {width > 0 && (
            <Svg
              width={width}
              height={THREAD_HEIGHT}
              fill="none"
              stroke={colors.text}
              strokeWidth={1.2}
              aria-hidden
              testID="hang-thread"
            >
              <Path d={thread} />
            </Svg>
          )}
          <View style={[styles.row, width === 0 && { marginTop: THREAD_HEIGHT }]}>
            <Choice
              label={t('item.hang.cutout')}
              selected={!showPhoto}
              disabled={saving}
              reduced={reduced}
              onSelect={() => onChoose(false)}
            >
              {headers && item.storedCutoutUrl && (
                <View style={styles.cutout}>
                  <Image
                    source={{ uri: absoluteUrl(item.storedCutoutUrl), headers }}
                    style={styles.fill}
                    contentFit="contain"
                    accessibilityIgnoresInvertColors
                  />
                </View>
              )}
            </Choice>
            <Choice
              label={t('item.hang.photo')}
              selected={showPhoto}
              disabled={saving}
              reduced={reduced}
              onSelect={() => onChoose(true)}
            >
              <View style={styles.print}>
                {headers && item.photoUrl && (
                  <Image
                    source={{ uri: absoluteUrl(item.photoUrl), headers }}
                    style={styles.fill}
                    contentFit="cover"
                    accessibilityIgnoresInvertColors
                  />
                )}
              </View>
            </Choice>
          </View>
        </Animated.View>

        <Animated.Text entering={enter(2)} style={styles.note}>
          {t('item.hang.note')}
        </Animated.Text>

        <Animated.View entering={enter(3)} style={styles.doneRow}>
          <Pressable
            onPress={onClose}
            style={styles.done}
            hitSlop={6}
            accessibilityRole="button"
            testID="hang-choice-done"
          >
            <Text style={styles.doneText}>{t('item.hang.done')}</Text>
          </Pressable>
        </Animated.View>
      </View>
    </Modal>
  );
}

// One version: a button, outlined in powder blue when it's how the piece hangs now (blue = the
// thing being edited, docs/design.md), with its name under it.
function Choice({
  label,
  selected,
  disabled,
  reduced,
  onSelect,
  children,
}: {
  label: string;
  selected: boolean;
  disabled: boolean;
  reduced: boolean;
  onSelect: () => void;
  children: ReactNode;
}) {
  return (
    <Pressable
      onPress={selected ? undefined : onSelect}
      disabled={disabled}
      style={styles.choice}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected, disabled }}
      testID={selected ? 'hang-choice-selected' : 'hang-choice-other'}
    >
      <Animated.View
        style={[
          styles.card,
          { borderColor: selected ? colors.ground : colors.background },
          !reduced && {
            transitionProperty: 'borderColor',
            transitionDuration: durations.state,
            transitionTimingFunction: CSS_EASE_OUT,
          },
        ]}
      >
        {children}
      </Animated.View>
      <Text
        style={[styles.choiceLabel, selected && styles.choiceLabelOn]}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        {selected ? `${label} ✓` : label}
      </Text>
    </Pressable>
  );
}

// textAlign has no start/end in React Native: 'left' follows the layout direction, so it acts as start in RTL.
const styles = StyleSheet.create({
  link: {
    alignSelf: 'center',
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 12,
    // The tap area is tall; the heading below stays close to the rail all the same.
    marginBottom: -14,
  },
  linkText: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.textMuted,
    textDecorationLine: 'underline',
    textDecorationColor: colors.border,
  },
  sheet: {
    flex: 1,
    backgroundColor: colors.background,
    paddingHorizontal: 22,
    paddingTop: 36,
    gap: 18,
  },
  title: {
    fontFamily: fonts.hand,
    fontSize: 28,
    lineHeight: 34,
    color: colors.text,
    textAlign: 'left',
  },
  hanger: {
    alignItems: 'center',
    marginBottom: -2,
  },
  row: {
    flexDirection: 'row',
    gap: GAP,
  },
  choice: {
    flex: 1,
    gap: 10,
  },
  card: {
    aspectRatio: 158 / 230,
    borderRadius: 18,
    borderWidth: 3,
    padding: 10,
    backgroundColor: colors.surface,
  },
  // The cut-out as on her rails: bare, with its tinted shadow.
  cutout: {
    flex: 1,
    margin: 6,
    ...cutoutShadow('hanging'),
  },
  // The photo as a white-bordered print, as a piece without a cut-out hangs on her rail.
  print: {
    flex: 1,
    borderWidth: 7,
    borderBottomWidth: 20,
    borderColor: colors.paper,
    backgroundColor: colors.hero,
    shadowColor: colors.accentDark,
    shadowOpacity: 0.12,
    shadowRadius: 7,
    shadowOffset: { width: 0, height: 6 },
    elevation: 3,
  },
  fill: {
    flex: 1,
  },
  choiceLabel: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  choiceLabelOn: {
    fontFamily: fonts.bodyMedium,
    color: colors.text,
  },
  note: {
    fontFamily: fonts.body,
    fontSize: 13,
    lineHeight: 19,
    color: colors.textMuted,
    textAlign: 'center',
  },
  doneRow: {
    alignItems: 'center',
  },
  done: {
    minHeight: 44,
    minWidth: 88,
    alignItems: 'center',
    justifyContent: 'center',
  },
  doneText: {
    fontFamily: fonts.bodyMedium,
    fontSize: 15,
    color: colors.text,
    textDecorationLine: 'underline',
  },
});

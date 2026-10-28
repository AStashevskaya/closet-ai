import type { Inspiration as SavedLook } from '@closet-ai/shared';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, I18nManager, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, {
  useAnimatedProps,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Path } from 'react-native-svg';

import { lineLength, smoothPath } from '@/components/hand-drawn';
import { HangerLoader } from '@/components/hanger-loader';
import { Icon } from '@/components/icon';
import { Button, maison, ScreenTitle } from '@/components/maison';
import { useTabBarClearance } from '@/components/tab-bar';
import { deleteInspiration, listInspiration, sessionHeaders, uploadPhoto } from '@/lib/api';
import { ApiError, limitReached, OfflineError } from '@/lib/api-error';
import { appLanguage } from '@/lib/app-language';
import { limitText } from '@/lib/limits';
import { shrinkPhoto } from '@/lib/shrink-photo';
import { useStyle } from '@/lib/style';
import { durations, EASE_OUT, rise, STAGGER_STEP } from '@/motion';
import { colors, fonts } from '@/theme';

import { Garland, type GarlandLook, type Point } from './garland';

// Looks picked at once from the gallery, and saved a few at a time.
const MAX_PICKED = 20;
const PARALLEL_UPLOADS = 3;

// The thread: its bead at the brief, then down the margin (this far from the edge), clear of text.
const DOT = { start: 25.5, top: 10, r: 5.5 };
const EDGE = 8;
const AnimatedPath = Animated.createAnimatedComponent(Path);

type Frame = { y: number; height: number };

// Inspiration (The Thread, decided 2026-10-28): looks she saved because she likes them, on a
// thread from her style. The stylist (the brief) learns her taste from them: the ones it has read
// are tied on with hearts ("taken to heart"); the ones saved since hang loose on a dashed thread,
// with "Teach my stylist" under them. Saving is free; teaching writes a new brief (~10 ¢), allowed
// by the server once a day within her monthly cap.
export function Inspiration() {
  const { t, i18n } = useTranslation();
  const insets = useSafeAreaInsets();
  const clearance = useTabBarClearance();
  const router = useRouter();
  const reduceMotion = useReducedMotion();
  const { style, update, load: loadStyle, asked } = useStyle(i18n.language);
  const [looks, setLooks] = useState<SavedLook[] | null>(null);
  // Local photos on their way up, shown greyed out on the new garland until the list catches up.
  const [saving, setSaving] = useState<string[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [headers, setHeaders] = useState<Record<string, string>>();
  const [teaching, setTeaching] = useState(false);

  // Where things are in the threaded block, for drawing the thread through them.
  const [width, setWidth] = useState(0);
  const [brief, setBrief] = useState<Frame | null>(null);
  const [freshAt, setFreshAt] = useState<number | null>(null);
  const [learnedAt, setLearnedAt] = useState<number | null>(null);
  const [freshTies, setFreshTies] = useState<Point[]>([]);
  const [learnedTies, setLearnedTies] = useState<Point[]>([]);

  const load = useCallback(async () => {
    try {
      setLooks(await listInspiration());
    } catch {
      setLooks((current) => current ?? []);
    }
  }, []);

  // Reloads when the tab comes into view, like the closet.
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

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

  // Read by the brief written at writtenAt, or saved since. Without a brief, every look is new.
  // createdAt and writtenAt are both ISO in UTC, so the strings compare as the dates do.
  const writtenAt = style?.writtenAt ?? null;
  const fresh: GarlandLook[] = [
    ...saving.map((uri): GarlandLook => ({ kind: 'pending', key: uri, uri })),
    ...(looks ?? [])
      .filter((look) => !writtenAt || look.createdAt > writtenAt)
      .map((look): GarlandLook => ({ kind: 'saved', ...look })),
  ];
  const learned: GarlandLook[] = writtenAt
    ? (looks ?? [])
        .filter((look) => look.createdAt <= writtenAt)
        .map((look): GarlandLook => ({ kind: 'saved', ...look }))
    : [];
  const updating = teaching || (style?.updating ?? false);

  async function add() {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      selectionLimit: MAX_PICKED,
      orderedSelection: true,
    });
    if (result.canceled) return;
    setMessage(null);
    const assets = result.assets;
    setSaving(assets.map((asset) => asset.uri));
    const lang = appLanguage(i18n.language);
    // A few workers take the photos in order; a limit stops the rest.
    let next = 0;
    let stopped = false;
    const worker = async () => {
      while (!stopped && next < assets.length) {
        const asset = assets[next++]!;
        try {
          await uploadPhoto(await shrinkPhoto(asset), lang, 'inspiration');
        } catch (cause) {
          const code = limitReached(cause);
          if (code) {
            stopped = true;
            setMessage(limitText(t, i18n.language, code));
          } else if (__DEV__) console.warn('Saving a look failed', cause);
        }
        setSaving((current) => current.filter((uri) => uri !== asset.uri));
      }
    };
    await Promise.all(Array.from({ length: Math.min(PARALLEL_UPLOADS, assets.length) }, worker));
    setSaving([]);
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    // The server makes the WebP in the background: a moment later the looks are listed.
    setTimeout(() => void load(), 1500);
  }

  async function teach() {
    setTeaching(true);
    try {
      await update();
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (cause) {
      const code = limitReached(cause);
      if (code) Alert.alert(limitText(t, i18n.language, code));
      else if (cause instanceof OfflineError) Alert.alert(t('common.offline'));
      // Once a day: the stylist has already learned today.
      else if (cause instanceof ApiError && cause.message === 'style:wait')
        Alert.alert(t('inspiration.teachWait'));
      // Already being written, or nothing to write from yet: show what is.
      else if (cause instanceof ApiError && cause.status === 409) void loadStyle();
      else Alert.alert(t('style.failed'));
    } finally {
      setTeaching(false);
    }
  }

  function confirmDelete(key: string) {
    Alert.alert(t('inspiration.deleteTitle'), undefined, [
      { text: t('closet.cancel'), style: 'cancel' },
      {
        text: t('inspiration.delete'),
        style: 'destructive',
        onPress: async () => {
          setLooks((current) => current?.filter((l) => l.key !== key) ?? null);
          try {
            await deleteInspiration(key);
          } catch {
            void load();
          }
        },
      },
    ]);
  }

  const onFreshTies = useCallback(
    (ties: Point[]) => setFreshTies((old) => (sameTies(old, ties) ? old : ties)),
    [],
  );
  const onLearnedTies = useCallback(
    (ties: Point[]) => setLearnedTies((old) => (sameTies(old, ties) ? old : ties)),
    [],
  );

  // Drawn once everything it runs through has its place, so it draws in once, whole.
  const placed =
    (fresh.length === 0 || (freshAt !== null && freshTies.length === fresh.length)) &&
    (learned.length === 0 || (learnedAt !== null && learnedTies.length === learned.length));
  const thread = threadGeometry({
    width,
    brief,
    fresh: freshAt !== null && fresh.length > 0 ? offset(freshTies, freshAt) : [],
    learned: learnedAt !== null && learned.length > 0 ? offset(learnedTies, learnedAt) : [],
  });

  const briefNote = style?.updating
    ? t('style.updatingTitle')
    : writtenAt
      ? t('inspiration.briefNote', {
          date: new Date(writtenAt).toLocaleDateString(i18n.language, {
            day: 'numeric',
            month: 'long',
          }),
        })
      : t('style.title');

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + 20, paddingBottom: clearance },
      ]}
    >
      <Animated.View entering={rise} style={[maison.gutter, styles.intro]}>
        <ScreenTitle title={t('inspiration.title')} />
        <Text style={maison.body}>{t('inspiration.intro')}</Text>
      </Animated.View>

      {/* Recreate the look: what of a look she already owns (docs/product.md, feature boundaries). */}
      <Animated.View entering={rise.delay(STAGGER_STEP)} style={maison.gutter}>
        <Pressable
          style={styles.want}
          onPress={() => router.push('/want-can')}
          accessibilityRole="button"
        >
          <View style={styles.wantText}>
            <Text style={styles.wantTitle}>{t('want.title')}</Text>
            <Text style={maison.note}>{t('inspiration.wantTitle')}</Text>
          </View>
          <View style={styles.chevron}>
            <Icon name="chevron" color={colors.iconMuted} size={16} strokeWidth={1.4} />
          </View>
        </Pressable>
      </Animated.View>

      <View style={styles.story} onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
        {thread && placed && <Thread {...thread} reduceMotion={reduceMotion} />}

        <Animated.View
          entering={rise.delay(STAGGER_STEP * 2)}
          style={styles.brief}
          onLayout={(event) => {
            const { y, height } = event.nativeEvent.layout;
            setBrief((old) => (old?.y === y && old.height === height ? old : { y, height }));
          }}
        >
          <Text style={maison.note}>{briefNote}</Text>
          <Text style={styles.briefText}>{style?.summary ?? t('inspiration.briefNone')}</Text>
        </Animated.View>

        {looks === null ? (
          <View style={styles.loading}>
            <HangerLoader />
          </View>
        ) : (
          <>
            {fresh.length > 0 && (
              <>
                <Section
                  title={t('inspiration.fresh', { count: fresh.length })}
                  note={writtenAt ? t('inspiration.freshNote') : undefined}
                  delay={STAGGER_STEP * 3}
                />
                <View onLayout={(event) => setFreshAt(event.nativeEvent.layout.y)}>
                  <Garland
                    looks={fresh}
                    loose
                    headers={headers}
                    delay={STAGGER_STEP * 4}
                    onTies={onFreshTies}
                    onLongPress={confirmDelete}
                  />
                </View>
              </>
            )}

            <Animated.View
              entering={rise.delay(STAGGER_STEP * 4)}
              style={[maison.gutter, styles.actions]}
            >
              <View style={styles.buttons}>
                {writtenAt && fresh.some((look) => look.kind === 'saved') && (
                  <Button
                    kind="bright"
                    label={updating ? t('inspiration.teaching') : t('inspiration.teach')}
                    onPress={teach}
                    busy={teaching}
                    disabled={updating}
                    style={styles.button}
                  />
                )}
                <Button
                  kind="outline"
                  label={t('inspiration.add')}
                  onPress={add}
                  busy={saving.length > 0}
                  style={styles.button}
                />
              </View>
              {(message || (asked && style?.updating)) && (
                <Text style={[maison.note, styles.centered]}>{message ?? t('style.updating')}</Text>
              )}
            </Animated.View>

            {learned.length > 0 && (
              <>
                <Section
                  title={t('inspiration.learned')}
                  note={t('style.looks', { count: learned.length })}
                  delay={STAGGER_STEP * 5}
                />
                <View onLayout={(event) => setLearnedAt(event.nativeEvent.layout.y)}>
                  <Garland
                    looks={learned}
                    loose={false}
                    headers={headers}
                    delay={STAGGER_STEP * 6}
                    onTies={onLearnedTies}
                    onLongPress={confirmDelete}
                  />
                </View>
              </>
            )}
          </>
        )}
      </View>
    </ScrollView>
  );
}

function Section({ title, note, delay }: { title: string; note?: string; delay: number }) {
  return (
    <Animated.View entering={rise.delay(delay)} style={[maison.gutter, styles.section]}>
      <Text style={styles.sectionTitle} accessibilityRole="header">
        {title}
      </Text>
      {note && <Text style={[maison.note, styles.sectionNote]}>{note}</Text>}
    </Animated.View>
  );
}

const offset = (ties: Point[], y: number): Point[] => ties.map(([x, ty]) => [x, ty + y]);
// The same points again don't re-render the thread.
const sameTies = (a: Point[], b: Point[]) =>
  a.length === b.length && a.every((p, i) => p[0] === b[i]![0] && p[1] === b[i]![1]);

// The thread in the block's own (physical, left-based) coordinates: from the bead at the brief down
// the margin, sagging through the learned looks; the new ones on a loose garland of their own off it.
function threadGeometry({
  width,
  brief,
  fresh,
  learned,
}: {
  width: number;
  brief: Frame | null;
  fresh: Point[];
  learned: Point[];
}) {
  if (!width || !brief) return null;
  const rtl = I18nManager.isRTL;
  const x = (fromStart: number) => (rtl ? width - fromStart : fromStart);
  const dot: Point = [x(DOT.start), brief.y + DOT.top];
  const under: Point = [dot[0], brief.y + brief.height + 4];
  const edge = x(EDGE);

  let solid: Point[] = [dot, under];
  const first = learned[0];
  if (first) {
    const side: Point = [edge, first[1] - 40];
    solid = [...solid, [edge, under[1] + 24], ...sagging([side, ...learned])];
  }
  const loose = fresh[0] ? sagging([[edge, fresh[0][1] - 30], ...fresh]) : null;
  return {
    dot,
    solid: { d: smoothPath(solid), length: lineLength(solid) },
    loose: loose && smoothPath(loose),
  };
}

// Through the points, sagging between each two, like a garland.
function sagging(points: Point[], sag = 34): Point[] {
  const out: Point[] = [points[0]!];
  for (let i = 1; i < points.length; i++) {
    const [a, b] = [points[i - 1]!, points[i]!];
    out.push([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2 + sag], b);
  }
  return out;
}

// Drawn once it has its shape: the solid thread draws itself down (~2 s, as in the prototype), the
// loose one fades in. Decoration: the sections' titles say the same, so screen readers skip it.
function Thread({
  dot,
  solid,
  loose,
  reduceMotion,
}: NonNullable<ReturnType<typeof threadGeometry>> & { reduceMotion: boolean }) {
  const progress = useSharedValue(reduceMotion ? 1 : 0);
  const shown = useSharedValue(reduceMotion ? 1 : 0);
  const { length } = solid;
  const measured = length > 0;
  useEffect(() => {
    if (reduceMotion) {
      progress.value = 1;
      shown.value = 1;
      return;
    }
    if (!measured) return;
    progress.value = withDelay(
      STAGGER_STEP * 3,
      withTiming(1, { duration: 2000, easing: EASE_OUT }),
    );
    shown.value = withDelay(
      STAGGER_STEP * 5,
      withTiming(1, { duration: durations.settle, easing: EASE_OUT }),
    );
  }, [measured, reduceMotion, progress, shown]);

  const line = useAnimatedProps(
    () => ({
      strokeDashoffset: length * (1 - progress.value),
      strokeOpacity: progress.value > 0 ? 1 : 0,
    }),
    [length],
  );
  const looseLine = useAnimatedProps(() => ({ strokeOpacity: shown.value }));

  return (
    <View
      style={StyleSheet.absoluteFill}
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Svg width="100%" height="100%">
        <AnimatedPath
          d={solid.d}
          animatedProps={line}
          fill="none"
          stroke={colors.text}
          strokeWidth={1.2}
          strokeLinecap="round"
          strokeDasharray={[length, length]}
        />
        {loose && (
          <AnimatedPath
            d={loose}
            animatedProps={looseLine}
            fill="none"
            stroke={colors.textMuted}
            strokeWidth={1.2}
            strokeLinecap="round"
            strokeDasharray={[3, 5]}
          />
        )}
        <Circle
          cx={dot[0]}
          cy={dot[1]}
          r={DOT.r}
          fill={colors.bead}
          stroke={colors.text}
          strokeWidth={1.2}
        />
      </Svg>
    </View>
  );
}

// textAlign has no start/end in React Native: 'left' follows the layout direction, so it acts as start in RTL.
const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    gap: 22,
  },
  intro: {
    gap: 12,
  },
  want: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.divider,
    paddingVertical: 8,
  },
  wantText: {
    flex: 1,
    gap: 2,
  },
  wantTitle: {
    fontFamily: fonts.displayLight,
    fontSize: 22,
    lineHeight: 26,
    color: colors.text,
    textAlign: 'left',
  },
  // The chevron points toward the end of the row, so it flips in right-to-left layouts.
  chevron: {
    transform: [{ scaleX: I18nManager.isRTL ? -1 : 1 }],
  },
  story: {
    paddingTop: 4,
  },
  brief: {
    marginHorizontal: 20,
    paddingStart: 26,
    gap: 4,
  },
  briefText: {
    fontFamily: fonts.displayLight,
    fontSize: 20,
    lineHeight: 25,
    color: colors.text,
    textAlign: 'left',
  },
  loading: {
    alignItems: 'center',
    paddingVertical: 24,
  },
  section: {
    marginTop: 34,
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 8,
  },
  sectionTitle: {
    fontFamily: fonts.displayLight,
    fontSize: 24,
    lineHeight: 28,
    color: colors.text,
    textAlign: 'left',
  },
  sectionNote: {
    flexShrink: 1,
  },
  actions: {
    marginTop: 26,
    gap: 10,
  },
  buttons: {
    flexDirection: 'row',
    gap: 10,
  },
  button: {
    flex: 1,
    paddingHorizontal: 12,
  },
  centered: {
    textAlign: 'center',
  },
});

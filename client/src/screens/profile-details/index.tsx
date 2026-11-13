import { PROFILE_COUNTRIES, type UpdateProfileInput, type UserProfile } from '@closet-ai/shared';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';

import { forgetFirstPhoto } from '@/lib/first-photo';
import { cancelMornings } from '@/lib/morning';
import { Chip } from '@/components/chip';
import { Button, maison } from '@/components/maison';
import { PressableScale } from '@/components/pressable-scale';
import { BeadAcross } from '@/components/thread-stops';
import { useAnnounce } from '@/lib/announce';
import { getProfile, updateProfile } from '@/lib/api';
import { isOffline } from '@/lib/api-error';
import { authClient } from '@/lib/auth-client';
import { arrive, durations, STAGGER_STEP } from '@/motion';
import { colors, fonts } from '@/theme';

import { BodyShapes } from './body-shapes';

// What can be opened for editing; `where` is the country and the city together.
type Key =
  | 'name'
  | 'where'
  | 'heightCm'
  | 'sizeTop'
  | 'sizeBottom'
  | 'sizeShoes'
  | 'bodyShape'
  | 'birthYear';
// The ones typed as numbers.
const NUMERIC: Key[] = ['heightCm', 'birthYear'];
// A measurement's height and the thread lines around them: the waiting row is as tall.
const STAT_HEIGHT = 68;
const STATS_LINE = 1.2;

type Status = 'idle' | 'saving' | 'saved' | 'failed';

// A whole number, or null for an empty field; NaN tells the server's check to refuse it.
const whole = (value: string) => (value.trim() === '' ? null : Number(value.trim()));
const text = (value: string) => value.trim() || null;

// Profile → My profile as a model's comp card (decided 2026-10-29, prototype
// `~/Desktop/closet/wrinkle-lab/design-profile`, direction A): her name large, where she lives,
// then her measurements in one row between two thread lines. A tap opens a value in place, on the
// ground colour, with why the stylist wants it; each change is saved on its own, so there's no
// Save button. What isn't filled in yet is dashed ("+", "add"), as everything the app doesn't
// know yet. The name is on the account (Better Auth); the rest is in /api/profile.
export function ProfileDetails() {
  const { t } = useTranslation();
  const router = useRouter();
  const { data: session } = authClient.useSession();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  // The name she typed; until then the account's, which may come after the screen has opened.
  const [typedName, setTypedName] = useState<string | null>(null);
  const name = typedName ?? session?.user.name ?? '';
  const [loadFailed, setLoadFailed] = useState<{ offline: boolean } | null>(null);
  // Reading the profile again after a failure.
  const [attempt, setAttempt] = useState(0);
  const [open, setOpen] = useState<Key | null>(null);
  // The open field as typed: saved when she's done with it.
  const [draft, setDraft] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  // One save at a time: a tap while one is on its way is ignored, so the same value isn't sent
  // twice and the fields don't open and close in whichever order the answers come back.
  const saving = useRef(false);
  // The profile as saved so far, for the async handlers (state in their closures can be stale).
  const latest = useRef<UserProfile | null>(null);

  const failedText =
    !profile && loadFailed ? t(loadFailed.offline ? 'common.offline' : 'details.loadError') : null;
  useAnnounce(profile ? null : (failedText ?? t('common.loading')));

  useEffect(() => {
    // An effect can't be async itself, so the async work goes in an inner function.
    const load = async () => {
      try {
        const loaded = await getProfile();
        latest.current = loaded;
        setProfile(loaded);
      } catch (cause) {
        setLoadFailed({ offline: isOffline(cause) });
      }
    };
    void load();
  }, [attempt]);

  async function save(patch: UpdateProfileInput, rename?: string) {
    if (saving.current) return false;
    saving.current = true;
    setStatus('saving');
    try {
      if (rename !== undefined) {
        // Better Auth answers a refusal with `error` instead of throwing.
        const { error } = await authClient.updateUser({ name: rename });
        if (error) throw new Error(error.message ?? 'renaming failed');
      } else {
        const saved = await updateProfile(patch);
        // Only the fields sent are taken from the answer: the rest may have changed since.
        const sent = Object.fromEntries(
          Object.keys(patch).map((key) => [key, saved[key as keyof UserProfile]]),
        );
        latest.current = latest.current && { ...latest.current, ...sent };
        setProfile(latest.current);
      }
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setStatus('saved');
      return true;
    } catch (cause) {
      if (__DEV__) console.warn('Saving the profile failed', cause);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setStatus('failed');
      return false;
    } finally {
      saving.current = false;
    }
  }

  // What was typed into the open field, saved if it changed. false when the server refused it:
  // the field stays open with what she typed.
  // The value is passed in rather than read from `draft`: a field closing after another opened
  // would otherwise save the new field's text into the old one.
  async function commit(key: Key | null, value: string) {
    const profile = latest.current;
    if (!profile || key === null || key === 'bodyShape') return true;
    if (key === 'name') {
      const next = value.trim();
      if (!next || next === name) return true;
      if (!(await save({}, next))) return false;
      setTypedName(next);
      return true;
    }
    if (key === 'where') {
      const city = text(value);
      return city === profile.city || save({ city });
    }
    const next = NUMERIC.includes(key) ? whole(value) : text(value);
    return next === profile[key] || save({ [key]: next });
  }

  // Done with a field (the keyboard's Done, or tapping away): saved, then closed.
  async function finish(key: Key, value: string) {
    if (await commit(key, value)) setOpen((current) => (current === key ? null : current));
  }

  // Opening another value saves the open one first; tapping the open one closes it. Tapped again
  // after the server refused it, the value closes unsaved, so she's never stuck in a field.
  async function toggle(key: Key) {
    if (!profile || saving.current) return;
    if (open === key && status === 'failed') {
      setStatus('idle');
      setOpen(null);
      return;
    }
    if (!(await commit(open, draft))) return;
    setStatus((current) => (current === 'saving' ? current : 'idle'));
    if (open === key) {
      setOpen(null);
      return;
    }
    setOpen(key);
    if (key === 'name') setDraft(name);
    else if (key === 'where') setDraft(profile.city ?? '');
    else if (key !== 'bodyShape') setDraft(profile[key]?.toString() ?? '');
  }

  // One layout for every state (docs/design.md, "Waiting"): the intro, her name from the account and
  // the measurements' thread stay, and what's read settles in on them. Nothing dashed yet: until
  // it's read, a value isn't "not known", it's on its way.
  if (!profile) {
    return (
      <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
        <View>
          <Text style={maison.body}>{t('details.intro')}</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.caps}>{t('details.name')}</Text>
          <View style={styles.nameRow}>
            <Text style={styles.name}>{name}</Text>
          </View>
          {/* Where the open name and place go below: the measurements' row stays the same element,
              so the sign on it can fade as they come. */}
          {null}
          <View style={styles.whereRow} />
          {null}
          <View
            style={[styles.stats, styles.statsWaiting]}
            accessible={!failedText}
            accessibilityRole={failedText ? undefined : 'progressbar'}
            accessibilityLabel={failedText ? undefined : t('common.loading')}
          >
            <StatsSign waiting={!failedText} />
          </View>
          {failedText && (
            <Animated.View style={styles.loadFailed} entering={arrive}>
              <Text style={maison.body}>{failedText}</Text>
              <Button
                kind="outline"
                label={t('closet.retry')}
                onPress={() => {
                  setLoadFailed(null);
                  setAttempt((n) => n + 1);
                }}
              />
            </Animated.View>
          )}
        </View>
      </ScrollView>
    );
  }

  // The server checks only that it's a two-letter code; the app offers these.
  const code = profile.country as (typeof PROFILE_COUNTRIES)[number] | null;
  const country = code && t(`details.countries.${code}`, { defaultValue: code });
  const where = [profile.city, country].filter(Boolean).join(', ');
  const stats = [
    { key: 'heightCm', label: t('details.heightShort'), value: profile.heightCm?.toString() },
    { key: 'sizeTop', label: t('details.sizeTop'), value: profile.sizeTop },
    { key: 'sizeBottom', label: t('details.sizeBottom'), value: profile.sizeBottom },
    { key: 'sizeShoes', label: t('details.sizeShoes'), value: profile.sizeShoes },
  ] as const;
  const statOpen = stats.find((stat) => stat.key === open);

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      automaticallyAdjustKeyboardInsets
      keyboardDismissMode="interactive"
    >
      <View>
        <Text style={maison.body}>{t('details.intro')}</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.caps}>{t('details.name')}</Text>
        <Pressable
          style={styles.nameRow}
          onPress={() => void toggle('name')}
          accessibilityRole="button"
          accessibilityLabel={`${t('details.name')}, ${name || t('details.add')}`}
          accessibilityState={{ expanded: open === 'name' }}
        >
          <Text style={[styles.name, !name && styles.unknown]}>{name || '+'}</Text>
        </Pressable>
        {open === 'name' && (
          <Field
            key={'name'}
            label={t('details.name')}
            why={t('details.why.name')}
            value={draft}
            onChange={setDraft}
            onDone={(value) => void finish('name', value)}
            maxLength={80}
          />
        )}

        <Pressable
          style={styles.whereRow}
          onPress={() => void toggle('where')}
          accessibilityRole="button"
          accessibilityLabel={`${t('details.country')}, ${where || t('details.add')}`}
          accessibilityState={{ expanded: open === 'where' }}
        >
          <Animated.View entering={arrive}>
            {where ? (
              <Text style={styles.where}>
                {where}
                {profile.birthYear !== null &&
                  ` · ${t('details.born', { year: profile.birthYear })}`}
              </Text>
            ) : (
              <Text style={[styles.where, styles.unknown]}>
                {t('details.country')} · {t('details.add')}
              </Text>
            )}
          </Animated.View>
        </Pressable>
        {open === 'where' && (
          <Panel why={t('details.why.where')}>
            <View style={styles.chips}>
              {PROFILE_COUNTRIES.map((code) => (
                <Chip
                  key={code}
                  label={t(`details.countries.${code}`)}
                  selected={profile.country === code}
                  onPress={() => void save({ country: profile.country === code ? null : code })}
                />
              ))}
            </View>
            <TextInput
              style={styles.input}
              value={draft}
              onChangeText={setDraft}
              onEndEditing={(event) => void commit('where', event.nativeEvent.text)}
              placeholder={t('details.cityPlaceholder')}
              placeholderTextColor={colors.textMuted}
              returnKeyType="done"
              maxLength={80}
              accessibilityLabel={t('details.city')}
            />
          </Panel>
        )}

        {/* Her measurements between two thread lines, as on a model's card. */}
        <View style={styles.stats}>
          <StatsSign waiting={false} />
          {stats.map((stat, index) => (
            <PressableScale
              key={stat.key}
              style={[styles.stat, index < stats.length - 1 && styles.statDivider]}
              onPress={() => void toggle(stat.key)}
              accessibilityRole="button"
              accessibilityLabel={`${stat.label}, ${stat.value ?? t('details.add')}`}
              accessibilityState={{ expanded: open === stat.key }}
            >
              <Animated.View style={styles.statText} entering={arrive}>
                <Text style={[styles.statValue, !stat.value && styles.statUnknown]}>
                  {stat.value ?? '+'}
                </Text>
                <Text style={styles.caps}>{stat.label}</Text>
              </Animated.View>
            </PressableScale>
          ))}
        </View>
        {statOpen && (
          <Field
            key={statOpen.key}
            label={statOpen.key === 'heightCm' ? t('details.height') : statOpen.label}
            why={t(statOpen.key === 'heightCm' ? 'details.why.heightCm' : 'details.why.sizes')}
            value={draft}
            onChange={setDraft}
            onDone={(value) => void finish(statOpen.key, value)}
            numeric={NUMERIC.includes(statOpen.key)}
            maxLength={statOpen.key === 'heightCm' ? 4 : 12}
          />
        )}

        <Animated.View style={styles.rows} entering={arrive.delay(STAGGER_STEP)}>
          <Row
            label={t('details.bodyShape')}
            value={profile.bodyShape && t(`details.shapes.${profile.bodyShape}`)}
            open={open === 'bodyShape'}
            onPress={() => void toggle('bodyShape')}
          />
          {open === 'bodyShape' && (
            <Panel why={t('details.why.bodyShape')}>
              <BodyShapes
                value={profile.bodyShape}
                onChange={(bodyShape) => void save({ bodyShape })}
              />
            </Panel>
          )}
          <Row
            label={t('details.birthYear')}
            value={profile.birthYear?.toString() ?? null}
            open={open === 'birthYear'}
            onPress={() => void toggle('birthYear')}
          />
          {open === 'birthYear' && (
            <Field
              key={'birthYear'}
              label={t('details.birthYear')}
              why={t('details.why.birthYear')}
              value={draft}
              onChange={setDraft}
              onDone={(value) => void finish('birthYear', value)}
              numeric
              maxLength={4}
            />
          )}
        </Animated.View>

        <View style={styles.status} accessibilityLiveRegion="polite">
          {status === 'saved' && (
            <Animated.Text
              entering={FadeIn.duration(durations.state)}
              exiting={FadeOut.duration(durations.state)}
              style={styles.saved}
            >
              {t('details.saved')}
            </Animated.Text>
          )}
          {status === 'failed' && (
            <Text style={styles.error} accessibilityRole="alert">
              {t('details.failed')}
            </Text>
          )}
        </View>
      </View>

      <Animated.View entering={arrive.delay(2 * STAGGER_STEP)} style={styles.account}>
        <Pressable
          style={styles.accountRow}
          onPress={async () => {
            // Her mornings, with her city's weather, don't stay for whoever signs in next.
            await cancelMornings().catch(() => {});
            // And the first-photo hint is shown afresh to whoever signs in next.
            await forgetFirstPhoto();
            await authClient.signOut();
          }}
          accessibilityRole="button"
        >
          <Text style={styles.accountText}>{t('auth.signOut')}</Text>
        </Pressable>
        <Pressable
          style={styles.accountRow}
          onPress={() => router.push('/delete-account')}
          accessibilityRole="button"
        >
          <Text style={[styles.accountText, styles.delete]}>{t('deleteAccount.row')}</Text>
        </Pressable>
      </Animated.View>
    </ScrollView>
  );
}

// The sign of waiting, on the top line of the measurements: their thread. In both layouts, so it can
// fade as they come.
function StatsSign({ waiting }: { waiting: boolean }) {
  return (
    <View style={styles.statsSign}>
      <BeadAcross waiting={waiting} />
    </View>
  );
}

type FieldProps = {
  label: string;
  why: string;
  value: string;
  onChange: (value: string) => void;
  // With what she typed, when she's done (the keyboard's Done, or tapping away).
  onDone: (value: string) => void;
  numeric?: boolean;
  maxLength: number;
};

// A typed value, opened. Keyed by its field, so each one is a new input that takes the focus.
function Field({ label, why, value, onChange, onDone, numeric, maxLength }: FieldProps) {
  return (
    <Panel why={why}>
      <TextInput
        style={styles.input}
        value={value}
        onChangeText={onChange}
        onEndEditing={(event) => onDone(event.nativeEvent.text)}
        autoFocus
        returnKeyType="done"
        keyboardType={numeric ? 'number-pad' : 'default'}
        maxLength={maxLength}
        accessibilityLabel={label}
      />
    </Panel>
  );
}

// A value opened for editing: on the ground colour, with why the stylist wants it.
function Panel({ why, children }: { why: string; children: ReactNode }) {
  return (
    <Animated.View entering={FadeIn.duration(durations.state)} style={styles.panel}>
      {children}
      <Text style={maison.note}>{why}</Text>
    </Animated.View>
  );
}

type RowProps = {
  label: string;
  value: string | null;
  open: boolean;
  onPress: () => void;
};

function Row({ label, value, open, onPress }: RowProps) {
  const { t } = useTranslation();
  return (
    <PressableScale
      style={styles.row}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${label}, ${value ?? t('details.add')}`}
      accessibilityState={{ expanded: open }}
    >
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={[styles.rowValue, !value && styles.rowUnknown]} numberOfLines={1}>
        {value ?? t('details.add')}
      </Text>
    </PressableScale>
  );
}

// textAlign has no start/end in React Native: 'left' follows the layout direction, so it acts as start in RTL.
const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    padding: 20,
    paddingBottom: 48,
  },
  card: {
    marginTop: 22,
  },
  caps: {
    fontFamily: fonts.bodyMedium,
    fontSize: 10.5,
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: colors.textMuted,
    textAlign: 'left',
  },
  name: {
    // Set, not left out: iOS keeps a dashed border once it's been dashed.
    borderStyle: 'solid',
    fontFamily: fonts.displayLight,
    fontSize: 46,
    lineHeight: 52,
    color: colors.text,
    textAlign: 'left',
  },
  // Not known yet: dashed, as everything in the app that isn't hers or known yet.
  unknown: {
    color: colors.textMuted,
    alignSelf: 'flex-start',
    borderBottomWidth: 1,
    borderStyle: 'dashed',
    borderBottomColor: colors.textMuted,
  },
  nameRow: {
    minHeight: 44,
    justifyContent: 'center',
  },
  whereRow: {
    minHeight: 44,
    justifyContent: 'center',
  },
  where: {
    fontFamily: fonts.body,
    fontSize: 14,
    lineHeight: 20,
    color: colors.textSecondary,
    textAlign: 'left',
  },
  stats: {
    flexDirection: 'row',
    marginTop: 14,
    borderTopWidth: STATS_LINE,
    borderBottomWidth: STATS_LINE,
    borderColor: colors.text,
  },
  // As tall as the measurements will be, so nothing moves when they come.
  statsWaiting: {
    minHeight: STAT_HEIGHT + 2 * STATS_LINE,
  },
  // On the top line: the stats' border, which it sits just above.
  statsSign: {
    position: 'absolute',
    start: 0,
    end: 0,
    top: -STATS_LINE,
    height: STATS_LINE,
  },
  loadFailed: {
    marginTop: 18,
    gap: 12,
  },
  statText: {
    alignItems: 'center',
    gap: 4,
  },
  stat: {
    flex: 1,
    minHeight: STAT_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 10,
  },
  statDivider: {
    borderEndWidth: StyleSheet.hairlineWidth,
    borderEndColor: colors.divider,
  },
  statValue: {
    borderStyle: 'solid',
    fontFamily: fonts.displayLight,
    fontSize: 26,
    lineHeight: 30,
    color: colors.text,
  },
  statUnknown: {
    fontSize: 22,
    color: colors.textMuted,
    borderBottomWidth: 1,
    borderStyle: 'dashed',
    borderBottomColor: colors.textMuted,
  },
  panel: {
    marginTop: 8,
    padding: 14,
    gap: 8,
    backgroundColor: colors.ground,
  },
  input: {
    minHeight: 48,
    borderBottomWidth: 1.2,
    borderBottomColor: colors.text,
    fontFamily: fonts.displayLight,
    fontSize: 26,
    color: colors.text,
    textAlign: 'left',
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  rows: {
    marginTop: 18,
  },
  row: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.divider,
  },
  rowLabel: {
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'left',
  },
  rowValue: {
    borderStyle: 'solid',
    flexShrink: 1,
    fontFamily: fonts.displayLight,
    fontSize: 22,
    color: colors.text,
  },
  rowUnknown: {
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.textMuted,
    borderBottomWidth: 1,
    borderStyle: 'dashed',
    borderBottomColor: colors.textMuted,
  },
  status: {
    minHeight: 28,
    justifyContent: 'center',
  },
  saved: {
    fontFamily: fonts.bodyMedium,
    fontSize: 13,
    color: colors.textMuted,
    textAlign: 'left',
  },
  error: {
    fontFamily: fonts.bodyMedium,
    fontSize: 14,
    color: colors.error,
    textAlign: 'left',
  },
  // The account under the card, apart from it.
  account: {
    marginTop: 28,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.divider,
  },
  accountRow: {
    minHeight: 52,
    justifyContent: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.divider,
  },
  accountText: {
    fontFamily: fonts.body,
    fontSize: 15,
    color: colors.text,
    textAlign: 'left',
  },
  delete: {
    color: colors.error,
  },
});

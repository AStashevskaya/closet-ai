import type { LimitCode, Usage } from '@closet-ai/shared';
import { FREE_LIMITS, WANT_MORE_CODES } from '@closet-ai/shared';
import type { TFunction } from 'i18next';
import { useCallback, useEffect, useState } from 'react';
import { Alert } from 'react-native';

import { getUsage, wantMore } from './api';
import { ApiError, isOffline, limitReached } from './api-error';

// The server's months are calendar ones in UTC, so what's monthly opens again on the 1st.
export function nextMonthDate(lang: string) {
  const now = new Date();
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return next.toLocaleDateString(lang, { day: 'numeric', month: 'long' });
}

// What the user sees when a limit stops them: which limit, how many, and when it resets.
export function limitText(t: TFunction, lang: string, code: LimitCode, usage?: Usage | null) {
  if (code === 'want' || code === 'look') {
    const resetsAt = usage?.[code].resetsAt;
    const date = resetsAt
      ? new Date(resetsAt).toLocaleDateString(lang, { day: 'numeric', month: 'long' })
      : '';
    return t(`limits.${code}`, { limit: FREE_LIMITS[code].count, date });
  }
  // The first week has more room, so the server's number when the app has it.
  if (code === 'wear_with') {
    return t('limits.wear_with', { limit: usage?.wear_with.limit ?? FREE_LIMITS.wear_with.count });
  }
  if (code === 'monthly') return t('limits.monthly', { date: nextMonthDate(lang) });
  return t(`limits.${code}`);
}

// Why asking for outfits didn't start: a limit, the outfits switched off, or anything else.
export function askFailedText(t: TFunction, lang: string, cause: unknown, usage?: Usage | null) {
  const code = limitReached(cause);
  if (code) return limitText(t, lang, code, usage);
  if (cause instanceof ApiError && cause.status === 503) return t('wearWith.off');
  if (isOffline(cause)) return t('common.offline');
  return t('wearWith.failed');
}

// The same as an alert, offering "I want more" when it was a limit a plan could lift.
export function alertAskFailed(t: TFunction, lang: string, cause: unknown, usage?: Usage | null) {
  const text = askFailedText(t, lang, cause, usage);
  const code = limitReached(cause);
  if (!code || !(WANT_MORE_CODES as readonly string[]).includes(code)) {
    Alert.alert(text);
    return;
  }
  Alert.alert(text, undefined, [
    { text: t('common.close'), style: 'cancel' },
    {
      text: t('limits.wantMore'),
      onPress: () => {
        void wantMore(code).catch(() => undefined);
        Alert.alert(t('limits.wantMoreThanks'));
      },
    },
  ]);
}

// The free-tier usage, loaded once and reloaded after a counted action. null until it loads
// (or if it fails: the server still enforces the limits, the app just doesn't show them).
export function useUsage() {
  const [usage, setUsage] = useState<Usage | null>(null);
  const refresh = useCallback(async () => {
    try {
      setUsage(await getUsage());
    } catch {
      // Nice to show, not needed to work.
    }
  }, []);
  useEffect(() => {
    // An effect can't be async itself, so the async work goes in an inner function.
    const load = async () => {
      try {
        setUsage(await getUsage());
      } catch {
        // As above.
      }
    };
    void load();
  }, []);
  return { usage, refresh };
}

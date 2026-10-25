import type { LimitCode, Usage } from '@closet-ai/shared';
import { FREE_LIMITS } from '@closet-ai/shared';
import type { TFunction } from 'i18next';
import { useCallback, useEffect, useState } from 'react';

import { getUsage } from './api';

// What the user sees when a limit stops them: which limit, how many, and when it resets.
export function limitText(t: TFunction, lang: string, code: LimitCode, usage?: Usage | null) {
  if (code === 'want' || code === 'look') {
    const resetsAt = usage?.[code].resetsAt;
    const date = resetsAt
      ? new Date(resetsAt).toLocaleDateString(lang, { day: 'numeric', month: 'long' })
      : '';
    return t(`limits.${code}`, { limit: FREE_LIMITS[code].count, date });
  }
  if (code === 'wear_with') return t('limits.wear_with', { limit: FREE_LIMITS.wear_with.count });
  if (code === 'monthly') {
    // The server's months are calendar ones in UTC, so it opens again on the 1st.
    const now = new Date();
    const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
    const date = next.toLocaleDateString(lang, { day: 'numeric', month: 'long' });
    return t('limits.monthly', { date });
  }
  return t(`limits.${code}`);
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

import type { TFunction } from 'i18next';

// "today", "yesterday", else the date ("26 October", or "26 Oct" short), by the phone's days.
export function dayLabel(
  iso: string,
  t: TFunction,
  lang: string,
  month: 'long' | 'short' = 'long',
) {
  const day = (date: Date) =>
    new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const days = Math.round((day(new Date()) - day(new Date(iso))) / 86_400_000);
  if (days === 0) return t('common.today');
  if (days === 1) return t('common.yesterday');
  return new Date(iso).toLocaleDateString(lang, { day: 'numeric', month });
}

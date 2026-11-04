import { useEffect } from 'react';
import { AccessibilityInfo } from 'react-native';

// Says a state out loud once, whenever it changes (null: nothing to say). A screen's waiting bead is
// hidden from screen readers, and a live region only speaks on Android.
export function useAnnounce(text: string | null) {
  useEffect(() => {
    if (text) AccessibilityInfo.announceForAccessibility(text);
  }, [text]);
}

import { useEffect } from 'react';
import { AccessibilityInfo } from 'react-native';

// Says a state out loud once, whenever it changes (null: nothing to say). A screen's waiting bead is
// hidden from screen readers. This works on both platforms, so a state said here has no live region
// as well: that only speaks on Android, and would say it twice there.
export function useAnnounce(text: string | null) {
  useEffect(() => {
    if (text) AccessibilityInfo.announceForAccessibility(text);
  }, [text]);
}

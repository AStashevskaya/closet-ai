import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { type StyleProp, type TextStyle } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { durations } from '@/motion';

// The server doesn't report its stages, so these move on a timer. They say what a request does in
// general (the stylist reads the closet, then writes the looks), and stop on the last one instead of
// looping, so a slow answer never looks like starting over.
const STEP_MS = 5000;
const STEPS = ['wearWith.steps.closet', 'wearWith.steps.pairing', 'wearWith.composing'] as const;

export function ComposingSteps({ style }: { style?: StyleProp<TextStyle> }) {
  const { t } = useTranslation();
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (step >= STEPS.length - 1) return;
    const timer = setTimeout(() => setStep(step + 1), STEP_MS);
    return () => clearTimeout(timer);
  }, [step]);

  return (
    <Animated.Text key={step} style={style} entering={FadeIn.duration(durations.state)}>
      {t(STEPS[step]!)}
    </Animated.Text>
  );
}

import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import { HuaweiWear } from '@/wear';

/** Goal shown before a profile has been saved; the same default the profile form starts from. */
export const DEFAULT_STEP_GOAL = 8000;

export interface StepGoal {
  goal: number;
  /** No profile has been saved, so `goal` is the default and not something the person set. */
  isDefault: boolean;
}

function readGoal(): StepGoal {
  const goal = HuaweiWear.getUserProfile()?.dailyStepGoal;
  return goal === undefined ? { goal: DEFAULT_STEP_GOAL, isDefault: true } : { goal, isDefault: false };
}

/** The daily step goal from the saved profile, re-read whenever the screen gains focus. */
export function useStepGoal(): StepGoal {
  const [goal, setGoal] = useState(readGoal);
  useFocusEffect(
    useCallback(() => {
      setGoal((prev) => {
        const next = readGoal();
        return prev.goal === next.goal && prev.isDefault === next.isDefault ? prev : next;
      });
    }, []),
  );
  return goal;
}

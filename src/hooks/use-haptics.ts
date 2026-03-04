"use client";

import { useCallback, useEffect, useMemo } from "react";
import { WebHaptics } from "web-haptics";

type HapticStep = {
  duration: number;
  delay?: number;
  intensity?: number;
};

type HapticOptions = {
  intensity?: number;
};

type HapticPattern = {
  steps: HapticStep[];
  options?: HapticOptions;
};

export enum HapticPreset {
  Success = "success",
  Warning = "warning",
  Error = "error",
  Light = "light",
  Medium = "medium",
  Heavy = "heavy",
  Soft = "soft",
  Selection = "selection",
  Nudge = "nudge",
  Rigid = "rigid",
}

const HAPTIC_PATTERNS: Record<HapticPreset, HapticPattern> = {
  [HapticPreset.Success]: {
    steps: [{ duration: 30 }, { delay: 60, duration: 40, intensity: 1 }],
  },
  [HapticPreset.Warning]: {
    steps: [
      { duration: 40, intensity: 0.8 },
      { delay: 100, duration: 40, intensity: 0.6 },
    ],
  },
  [HapticPreset.Error]: {
    steps: [
      { duration: 40 },
      { delay: 40, duration: 40 },
      { delay: 40, duration: 40 },
    ],
    options: { intensity: 0.9 },
  },
  [HapticPreset.Light]: {
    steps: [{ duration: 15 }],
    options: { intensity: 0.4 },
  },
  [HapticPreset.Medium]: {
    steps: [{ duration: 25 }],
    options: { intensity: 0.7 },
  },
  [HapticPreset.Heavy]: {
    steps: [{ duration: 35 }],
    options: { intensity: 1 },
  },
  [HapticPreset.Soft]: {
    steps: [{ duration: 40 }],
  },
  [HapticPreset.Selection]: {
    steps: [{ duration: 8 }],
    options: { intensity: 0.3 },
  },
  [HapticPreset.Nudge]: {
    steps: [
      { duration: 80, intensity: 0.8 },
      { delay: 80, duration: 50, intensity: 0.3 },
    ],
  },
  [HapticPreset.Rigid]: {
    steps: [{ duration: 10 }],
    options: { intensity: 1 },
  },
};

export function useHaptics() {
  const haptics = useMemo(() => new WebHaptics(), []);

  useEffect(() => () => haptics.destroy(), [haptics]);

  const triggerHaptic = useCallback(
    (preset: HapticPreset) => {
      const pattern = HAPTIC_PATTERNS[preset];
      return haptics.trigger(pattern.steps, pattern.options);
    },
    [haptics]
  );

  return { triggerHaptic };
}

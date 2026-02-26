import { useMemo, useState } from "react";

export function useStepForm(steps = [], initialStepId = null) {
  const safeSteps = Array.isArray(steps) ? steps.filter(Boolean) : [];
  const initialIndex = useMemo(() => {
    if (safeSteps.length === 0) return 0;
    if (!initialStepId) return 0;
    const foundIndex = safeSteps.findIndex((step) => step.id === initialStepId);
    return foundIndex >= 0 ? foundIndex : 0;
  }, [safeSteps, initialStepId]);

  const [stepIndex, setStepIndex] = useState(initialIndex);

  const boundedIndex = Math.min(Math.max(stepIndex, 0), Math.max(safeSteps.length - 1, 0));
  const step = safeSteps[boundedIndex] ?? null;
  const isFirst = boundedIndex === 0;
  const isLast = safeSteps.length === 0 || boundedIndex === safeSteps.length - 1;
  const progressPercent = safeSteps.length <= 1 ? 100 : ((boundedIndex + 1) / safeSteps.length) * 100;

  const next = () => {
    if (isLast) return;
    setStepIndex((current) => current + 1);
  };

  const back = () => {
    if (isFirst) return;
    setStepIndex((current) => current - 1);
  };

  const goTo = (targetIndex) => {
    const nextIndex = Math.min(Math.max(Number(targetIndex) || 0, 0), Math.max(safeSteps.length - 1, 0));
    setStepIndex(nextIndex);
  };

  return {
    steps: safeSteps,
    step,
    stepIndex: boundedIndex,
    isFirst,
    isLast,
    progressPercent,
    next,
    back,
    goTo,
  };
}

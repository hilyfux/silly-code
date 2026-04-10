/** React hook that drives the proactive tick loop. */
import { useEffect, useRef } from 'react';
import { isProactiveActive, setNextTickAt } from './index.js';

const TICK_INTERVAL_MS = 60_000;
const TICK_PROMPT = '<tick>';

interface UseProactiveOptions {
  isLoading: boolean;
  queuedCommandsLength: number;
  hasActiveLocalJsxUI: boolean;
  isInPlanMode: boolean;
  onSubmitTick: (prompt: string) => void;
  onQueueTick: (prompt: string) => void;
}

export function useProactive({ isLoading, queuedCommandsLength, hasActiveLocalJsxUI, isInPlanMode, onSubmitTick, onQueueTick }: UseProactiveOptions): void {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const active = isProactiveActive();

  useEffect(() => {
    function schedule(): void {
      timerRef.current = setTimeout(() => {
        setNextTickAt(null);
        if (isProactiveActive() && !isLoading && queuedCommandsLength === 0 && !hasActiveLocalJsxUI && !isInPlanMode) {
          onSubmitTick(TICK_PROMPT);
        } else if (isProactiveActive()) {
          onQueueTick(TICK_PROMPT);
        }
        schedule();
      }, TICK_INTERVAL_MS);
      setNextTickAt(Date.now() + TICK_INTERVAL_MS);
    }

    if (active) schedule();

    return () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
        setNextTickAt(null);
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, isLoading, queuedCommandsLength, hasActiveLocalJsxUI, isInPlanMode]);
}

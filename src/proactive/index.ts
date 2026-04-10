/**
 * Proactive mode state machine.
 * Manages whether the AI is running autonomously (sending periodic tick prompts).
 */

type Listener = () => void;

type ProactiveSource = 'command' | 'flag' | 'env';

let _active = false;
let _paused = false;
let _contextBlocked = false;
let _nextTickAt: number | null = null;
const _listeners = new Set<Listener>();

function _notify(): void {
  for (const l of _listeners) l();
}

export function isProactiveActive(): boolean {
  return _active && !_paused && !_contextBlocked;
}

export function activateProactive(_source: ProactiveSource): void {
  _active = true;
  _paused = false;
  _notify();
}

export function pauseProactive(): void {
  _paused = true;
  _notify();
}

export function resumeProactive(): void {
  _paused = false;
  _notify();
}

export function setContextBlocked(blocked: boolean): void {
  _contextBlocked = blocked;
  _notify();
}

/** Called by useProactive to record when the next tick is scheduled. */
export function setNextTickAt(ts: number | null): void {
  _nextTickAt = ts;
  _notify();
}

export function getNextTickAt(): number | null {
  return _nextTickAt;
}

export function subscribeToProactiveChanges(listener: Listener): () => void {
  _listeners.add(listener);
  return () => _listeners.delete(listener);
}

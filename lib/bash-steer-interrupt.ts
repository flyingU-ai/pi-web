/** Lets Steer abort the bash tool's own signal without aborting the agent run. */

const interrupts = new Set<() => void>();

export function registerBashSteerInterrupt(interrupt: () => void): () => void {
  interrupts.add(interrupt);
  return () => {
    interrupts.delete(interrupt);
  };
}

export function interruptBashForSteer(): void {
  for (const interrupt of [...interrupts]) interrupt();
}

/** Abort when any of the signals abort. A missing signal is ignored. */
export function linkAbortSignals(signals: Array<AbortSignal | undefined>): AbortSignal {
  const controller = new AbortController();
  const abort = () => {
    if (!controller.signal.aborted) controller.abort();
  };
  for (const signal of signals) {
    if (!signal) continue;
    if (signal.aborted) {
      abort();
      break;
    }
    signal.addEventListener("abort", abort, { once: true });
  }
  return controller.signal;
}

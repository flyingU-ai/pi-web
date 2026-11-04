/** Same clock as pi-coding-agent `toolTimerText` / `formatToolDuration`. UI only. */

export function formatToolDuration(ms: number): string {
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const totalSeconds = Math.floor(seconds);
  const minutes = Math.floor(totalSeconds / 60);
  const remainder = totalSeconds % 60;
  if (minutes < 60) return `${minutes}m ${remainder}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m ${remainder}s`;
}

export function toolTimerLabel(options: {
  isPartial: boolean;
  startedAt?: number;
  endedAt?: number;
  durationMs?: number;
  now?: number;
}): string | null {
  if (!options.isPartial && options.durationMs !== undefined) {
    return `Took ${formatToolDuration(options.durationMs)}`;
  }
  if (options.startedAt === undefined) return null;
  const endTime = options.endedAt ?? options.now ?? Date.now();
  return `${options.isPartial ? "Elapsed" : "Took"} ${formatToolDuration(endTime - options.startedAt)}`;
}

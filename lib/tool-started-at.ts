/** In-flight tool clocks that survive ChatWindow remount when switching sessions. */

const inflight = new Map<string, number>();

function key(sessionId: string, toolCallId: string): string {
  return `${sessionId}\0${toolCallId}`;
}

/** First start wins. Later reconnects reuse that stamp instead of Date.now(). */
export function rememberToolStartedAt(
  sessionId: string,
  toolCallId: string,
  now = Date.now(),
): number {
  const id = key(sessionId, toolCallId);
  const existing = inflight.get(id);
  if (existing !== undefined) return existing;
  inflight.set(id, now);
  return now;
}

export function forgetToolStartedAt(sessionId: string, toolCallId: string): void {
  inflight.delete(key(sessionId, toolCallId));
}

export function forgetSessionToolStartedAt(sessionId: string): void {
  const prefix = `${sessionId}\0`;
  for (const id of inflight.keys()) {
    if (id.startsWith(prefix)) inflight.delete(id);
  }
}

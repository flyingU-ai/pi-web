/**
 * Sidebar state that should follow the person, not the machine.
 * localStorage stays the fast/offline copy; this is the shared one.
 */

export interface RemoteUiState {
  pins: Record<string, string[]>;
  unread: string[];
}

const NO_STORE = { credentials: "same-origin" as RequestCredentials, cache: "no-store" as RequestCache };

export async function readRemoteUiState(): Promise<RemoteUiState | null> {
  try {
    const res = await fetch("/api/ui-state", NO_STORE);
    if (!res.ok) return null;
    const data = (await res.json()) as Partial<RemoteUiState> & { persisted?: boolean };
    if (data.persisted === false) return null;
    const pins = data.pins && typeof data.pins === "object" && !Array.isArray(data.pins)
      ? data.pins
      : {};
    return { pins, unread: Array.isArray(data.unread) ? data.unread : [] };
  } catch {
    return null;
  }
}

export async function writeRemoteUiState(state: RemoteUiState): Promise<void> {
  try {
    await fetch("/api/ui-state", {
      ...NO_STORE,
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(state),
    });
  } catch {
    // Best effort: the local copy is still authoritative for this browser.
  }
}

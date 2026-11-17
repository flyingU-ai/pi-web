"use client";

import { useEffect, useState, type CSSProperties } from "react";
import type { AgentMessage, SessionInfo } from "@/lib/types";
import { getDraft, setDraft } from "@/lib/draft-store";
import { useI18n } from "@/hooks/useI18n";
import {
  PAIR_CHANGE_EVENT,
  notifyPairChange,
  otherSeat,
  packIntentConclusions,
  readPair,
  replaceUnsentPack,
  writePair,
  type SessionPair,
} from "@/lib/session-pair";

interface Props {
  scope: string;
  sessions: SessionInfo[];
  selectedSessionId: string | null;
  onSelectSession: (session: SessionInfo) => void;
}

function browserStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function titleOf(session: SessionInfo | undefined, fallback: string): string {
  if (!session) return fallback;
  return session.name || session.firstMessage.slice(0, 40) || session.id.slice(0, 8);
}

export function SessionPairBar({ scope, sessions, selectedSessionId, onSelectSession }: Props) {
  const { t } = useI18n();
  const [pair, setPair] = useState<SessionPair | null>(null);
  const [picking, setPicking] = useState(false);
  const [otherId, setOtherId] = useState("");
  const [role, setRole] = useState<"critic" | "worker">("critic");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [models, setModels] = useState<Record<string, string>>({});

  useEffect(() => {
    setPair(readPair(scope, browserStorage()));
    const refresh = () => setPair(readPair(scope, browserStorage()));
    window.addEventListener(PAIR_CHANGE_EVENT, refresh);
    return () => window.removeEventListener(PAIR_CHANGE_EVENT, refresh);
  }, [scope]);

  useEffect(() => {
    if (!pair) return;
    let cancelled = false;
    for (const id of [pair.criticId, pair.workerId]) {
      void fetch(`/api/sessions/${encodeURIComponent(id)}/context?tail=1&deferThinking=1`)
        .then((response) => response.json())
        .then((data: { context?: { model?: { provider?: string; modelId?: string } | null } }) => {
          const model = data.context?.model;
          if (cancelled || !model?.modelId) return;
          const label = model.provider ? `${model.provider}/${model.modelId}` : model.modelId;
          setModels((current) => current[id] === label ? current : { ...current, [id]: label });
        })
        .catch(() => {});
    }
    return () => {
      cancelled = true;
    };
  }, [pair]);

  const byId = new Map(sessions.map((session) => [session.id, session]));
  const selected = selectedSessionId ? byId.get(selectedSessionId) : undefined;
  const candidates = sessions.filter((session) => session.id !== selectedSessionId && session.relation?.kind !== "subagent");

  const savePair = () => {
    if (!selectedSessionId || !otherId || otherId === selectedSessionId) return;
    const next: SessionPair = {
      criticId: role === "critic" ? selectedSessionId : otherId,
      workerId: role === "worker" ? selectedSessionId : otherId,
      sentThrough: {},
      pending: null,
    };
    writePair(scope, next, browserStorage());
    notifyPairChange();
    setPair(next);
    setPicking(false);
    setNote(null);
  };

  const clearPair = () => {
    writePair(scope, null, browserStorage());
    notifyPairChange();
    setPair(null);
  };

  const jump = (id: string) => {
    const session = byId.get(id);
    if (session) onSelectSession(session);
  };

  const handoff = async () => {
    if (!pair || !selectedSessionId) return;
    const seat = otherSeat(pair, selectedSessionId);
    if (!seat) return;
    setBusy(true);
    setNote(null);
    try {
      const loaded = await loadVisibleMessages(selectedSessionId);
      const source = byId.get(selectedSessionId);
      const packId = Math.random().toString(36).slice(2, 8);
      const packed = packIntentConclusions(
        loaded.messages,
        loaded.entryIds,
        pair.sentThrough[selectedSessionId],
        titleOf(source, selectedSessionId),
        packId,
      );
      if (!packed.throughEntryId || packed.rounds === 0) {
        setNote(t("pair.nothingNew"));
        return;
      }
      const existing = getDraft(seat.id)?.value ?? "";
      setDraft(seat.id, {
        value: replaceUnsentPack(existing, packed.text),
        images: getDraft(seat.id)?.images ?? [],
      });
      const next: SessionPair = {
        ...pair,
        pending: {
          packId,
          sourceId: selectedSessionId,
          targetId: seat.id,
          throughEntryId: packed.throughEntryId,
        },
      };
      writePair(scope, next, browserStorage());
      notifyPairChange();
      setPair(next);
      setNote(t("pair.draftReady"));
    } catch (error) {
      setNote(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  if (!scope) return null;

  return (
    <div style={{ padding: "8px 10px 0", flexShrink: 0 }}>
      {pair ? (
        <div style={{ border: "1px solid var(--border)", borderRadius: 8, padding: 8, display: "flex", flexDirection: "column", gap: 6 }}>
          <PairRow
            label={t("pair.critic")}
            title={titleOf(byId.get(pair.criticId), pair.criticId)}
            model={models[pair.criticId]}
            onJump={() => jump(pair.criticId)}
          />
          <PairRow
            label={t("pair.worker")}
            title={titleOf(byId.get(pair.workerId), pair.workerId)}
            model={models[pair.workerId]}
            onJump={() => jump(pair.workerId)}
          />
          <div style={{ display: "flex", gap: 6 }}>
            <button type="button" disabled={busy || !selected || !otherSeat(pair, selectedSessionId || "")} onClick={() => void handoff()} style={tinyButton}>
              {busy ? t("pair.packing") : t("pair.handoff")}
            </button>
            <button type="button" onClick={clearPair} style={tinyButton}>{t("pair.clear")}</button>
          </div>
          {note ? <div style={{ fontSize: 11, color: "var(--text-dim)" }}>{note}</div> : null}
        </div>
      ) : (
        <div>
          <button type="button" disabled={!selected} onClick={() => setPicking((open) => !open)} style={tinyButton}>
            {t("pair.bind")}
          </button>
          {picking && selected ? (
            <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 6 }}>
              <select value={role} onChange={(event) => setRole(event.target.value === "worker" ? "worker" : "critic")} style={selectStyle}>
                <option value="critic">{t("pair.thisCritic")}</option>
                <option value="worker">{t("pair.thisWorker")}</option>
              </select>
              <select value={otherId} onChange={(event) => setOtherId(event.target.value)} style={selectStyle}>
                <option value="">{t("pair.pickOther")}</option>
                {candidates.map((session) => (
                  <option key={session.id} value={session.id}>{titleOf(session, session.id)}</option>
                ))}
              </select>
              <button type="button" disabled={!otherId} onClick={savePair} style={tinyButton}>{t("pair.save")}</button>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

function PairRow({ label, title, model, onJump }: { label: string; title: string; model?: string; onJump: () => void }) {
  const { t } = useI18n();
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0, fontSize: 12 }}>
      <span style={{ color: "var(--text-dim)", flexShrink: 0 }}>{label}</span>
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }} title={model || title}>{title}</span>
      {model ? <span style={{ color: "var(--text-dim)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{model}</span> : null}
      <button type="button" onClick={onJump} style={{ ...tinyButton, marginLeft: "auto" }}>{t("pair.jump")}</button>
    </div>
  );
}

async function loadVisibleMessages(sessionId: string): Promise<{ messages: AgentMessage[]; entryIds: string[] }> {
  const messages: AgentMessage[] = [];
  const entryIds: string[] = [];
  let before: string | undefined;
  for (let page = 0; page < 4; page += 1) {
    const query = new URLSearchParams({ tail: "1000", deferThinking: "1" });
    if (before) query.set("before", before);
    const response = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/context?${query}`);
    const data = await response.json() as {
      error?: string;
      context?: { messages?: AgentMessage[]; entryIds?: string[]; hasMore?: boolean; oldestEntryId?: string | null };
    };
    if (!response.ok || data.error) throw new Error(data.error || "session context failed");
    const pageMessages = data.context?.messages ?? [];
    const pageIds = data.context?.entryIds ?? [];
    messages.unshift(...pageMessages);
    entryIds.unshift(...pageIds);
    if (!data.context?.hasMore || !data.context.oldestEntryId) break;
    before = data.context.oldestEntryId;
  }
  return { messages, entryIds };
}

const tinyButton: CSSProperties = {
  border: "1px solid var(--border)",
  background: "var(--bg-hover)",
  color: "var(--text)",
  borderRadius: 6,
  fontSize: 11,
  padding: "3px 8px",
  cursor: "pointer",
};

const selectStyle: CSSProperties = {
  width: "100%",
  fontSize: 12,
  padding: "4px 6px",
  borderRadius: 6,
  border: "1px solid var(--border)",
  background: "var(--bg)",
  color: "var(--text)",
};

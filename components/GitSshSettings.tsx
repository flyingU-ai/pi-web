"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { adminFetchInit } from "@/lib/web-admin-client";
import { ConfigButton } from "./SettingsUi";

interface SshStatus {
  configured?: boolean;
  fingerprint?: string;
  host?: string;
  algorithm?: string;
  error?: string;
}

export function GitSshSettings() {
  const { t } = useI18n();
  const [status, setStatus] = useState<SshStatus | null>(null);
  const [host, setHost] = useState("");
  const [privateKey, setPrivateKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const load = () => {
    void fetch("/api/admin-ssh", adminFetchInit())
      .then(async (response) => {
        const data = await response.json() as SshStatus;
        if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
        setStatus(data);
        setHost(data.host && data.host !== "*" ? data.host : "");
      })
      .catch((cause) => {
        setError(cause instanceof Error ? cause.message : String(cause));
      });
  };

  useEffect(() => {
    load();
  }, []);

  const save = async () => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/admin-ssh", adminFetchInit({
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ privateKey, host }),
      }));
      const data = await response.json() as SshStatus;
      if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
      setStatus(data);
      setPrivateKey("");
      setNotice(t("settings.gitSshSaved"));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const clear = async () => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/admin-ssh", adminFetchInit({ method: "DELETE" }));
      const data = await response.json() as SshStatus;
      if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
      setStatus(data);
      setPrivateKey("");
      setHost("");
      setNotice(t("settings.gitSshCleared"));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="settings-general-section">
      <h3 className="settings-general-heading">{t("settings.gitSsh")}</h3>
      <p className="settings-general-description">{t("settings.gitSshDescription")}</p>
      <p className="settings-general-description">
        {status?.configured
          ? `${t("settings.gitSshFingerprint")}: ${status.algorithm || ""} ${status.fingerprint || ""}`
          : t("settings.gitSshEmpty")}
      </p>
      <label className="settings-ssh-label">
        <span>{t("settings.gitSshHost")}</span>
        <input
          className="settings-ssh-host"
          value={host}
          autoComplete="off"
          spellCheck={false}
          placeholder="gitlab.example.com"
          onChange={(event) => setHost(event.target.value)}
        />
      </label>
      <label className="settings-ssh-label">
        <span>{t("settings.gitSshKey")}</span>
        <textarea
          className="settings-ssh-key"
          value={privateKey}
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => setPrivateKey(event.target.value)}
        />
      </label>
      <div className="settings-ssh-actions">
        <ConfigButton disabled={busy || !privateKey.trim()} onClick={() => void save()}>
          {t("settings.gitSshSave")}
        </ConfigButton>
        <ConfigButton variant="secondary" disabled={busy || !status?.configured} onClick={() => void clear()}>
          {t("settings.gitSshClear")}
        </ConfigButton>
      </div>
      {notice ? <p className="settings-general-description">{notice}</p> : null}
      {error ? <p className="settings-general-error">{error}</p> : null}
    </section>
  );
}

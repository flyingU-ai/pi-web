"use client";

import { useEffect, useState } from "react";
import { adminFetchInit } from "@/lib/web-admin-client";
import { useI18n } from "@/hooks/useI18n";

function todayBeijing(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  return `${parts.find((part) => part.type === "year")?.value}-${parts.find((part) => part.type === "month")?.value}-${parts.find((part) => part.type === "day")?.value}`;
}

type UsageRow = {
  admin: string;
  day: string;
  input: number;
  output: number;
  cache: number;
  cost_usd: number;
  session_count: number;
};

export function AdminUsageCard() {
  const { t } = useI18n();
  const [rows, setRows] = useState<UsageRow[]>([]);
  const [note, setNote] = useState("");
  const day = todayBeijing();

  useEffect(() => {
    let cancelled = false;
    void fetch(`/api/admin-usage?from=${day}&to=${day}`, adminFetchInit())
      .then((res) => res.json())
      .then((body: { rows?: UsageRow[]; note?: string }) => {
        if (cancelled) return;
        setRows(Array.isArray(body.rows) ? body.rows : []);
        setNote(String(body.note || ""));
      })
      .catch(() => {
        if (!cancelled) setRows([]);
      });
    return () => {
      cancelled = true;
    };
  }, [day]);

  const mine = rows[0];
  const ranked = [...rows].sort((a, b) => b.cost_usd - a.cost_usd);
  return (
    <div
      title={note || t("adminUsage.estimate")}
      style={{ padding: "6px 8px", fontSize: 11, color: "var(--text-dim)", borderTop: "1px solid var(--border)" }}
    >
      <div style={{ fontWeight: 600, color: "var(--text)" }}>{t("adminUsage.today")}</div>
      <div>
        {mine
          ? `in ${mine.input} · out ${mine.output} · cache ${mine.cache} · $${mine.cost_usd.toFixed(4)}`
          : t("adminUsage.empty")}
      </div>
      {ranked.length > 1 ? (
        <div style={{ marginTop: 4 }}>
          {t("adminUsage.rank")}
          {ranked.slice(0, 5).map((row) => (
            <div key={row.admin}>{row.admin} ${row.cost_usd.toFixed(4)}</div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

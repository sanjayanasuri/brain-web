// frontend/components/OfflineControls.tsx
"use client";

import { useState } from "react";
import { getOfflineBootstrap } from "@/lib/offline/bootstrap";
import { ensureFreshOfflineCache } from "@/lib/offline/invalidate";
import { warmOfflineCache } from "@/lib/offline/warm";
import { isProbablyOnWifi } from "@/lib/offline/network";
import { useOfflineStatus } from "@/lib/offline/useOfflineStatus";

type Props = {
  graph_id: string;
  branch_id: string;
  trail_id?: string;
};

export default function OfflineControls(props: Props) {
  const { graph_id, branch_id, trail_id } = props;
  const { online, offlineReady, artifactCount } = useOfflineStatus(graph_id, branch_id);

  const [wifiOnly, setWifiOnly] = useState(true);
  const [offlineSearch, setOfflineSearch] = useState(() => {
    if (typeof window === 'undefined') return true;
    return localStorage.getItem('brainweb:offlineSearchEnabled') !== 'false';
  });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function downloadForOffline() {
    setBusy(true);
    setMsg(null);
    try {
      if (wifiOnly && !isProbablyOnWifi()) {
        setMsg("Wi-Fi only is enabled. Switch to Wi-Fi or disable the toggle.");
        return;
      }

      // Always do a fresh bootstrap first
      const boot = await getOfflineBootstrap({ graph_id, branch_id });
      if (!boot) {
        setMsg("Could not fetch bootstrap (network/server).");
        return;
      }

      // Then warm for trail if available
      if (trail_id) {
        await warmOfflineCache({ graph_id, branch_id, trail_id, limit: 80 });
      }

      setMsg("Offline cache updated.");
    } catch (e: any) {
      setMsg(e?.message ?? "Failed to download offline data");
    } finally {
      setBusy(false);
    }
  }

  async function refreshIfStale() {
    setBusy(true);
    setMsg(null);
    try {
      await ensureFreshOfflineCache({ graph_id, branch_id });
      setMsg("Cache checked.");
    } catch (e: any) {
      setMsg(e?.message ?? "Failed to validate cache");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-3 text-sm">
      <div className="flex items-center gap-2">
        <span className={online ? "text-green-600" : "text-amber-600"}>
          {online ? "Online" : "Offline"}
        </span>
        <span className="text-neutral-500">
          {offlineReady ? `Offline ready (${artifactCount})` : `Not cached (${artifactCount})`}
        </span>
      </div>

      <button
        className="px-3 py-1 rounded-md border border-neutral-300 hover:bg-neutral-50 disabled:opacity-60"
        onClick={downloadForOffline}
        disabled={busy || !online}
        title={!online ? "You are offline" : "Download for offline use"}
      >
        {busy ? "Working..." : "Download for offline"}
      </button>

      <button
        className="px-3 py-1 rounded-md border border-neutral-300 hover:bg-neutral-50 disabled:opacity-60"
        onClick={refreshIfStale}
        disabled={busy || !online}
        title="Validate cache freshness"
      >
        Validate cache
      </button>

      <label className="flex items-center gap-2 select-none">
        <input type="checkbox" checked={wifiOnly} onChange={(e) => setWifiOnly(e.target.checked)} />
        Wi-Fi only
      </label>

      <label className="flex items-center gap-2 select-none">
        <input
          type="checkbox"
          checked={offlineSearch}
          onChange={(e) => {
            const enabled = e.target.checked;
            setOfflineSearch(enabled);
            if (typeof window !== 'undefined') {
              localStorage.setItem('brainweb:offlineSearchEnabled', String(enabled));
            }
          }}
        />
        Offline search
      </label>

      {msg ? <span className="text-neutral-600">{msg}</span> : null}
    </div>
  );
}

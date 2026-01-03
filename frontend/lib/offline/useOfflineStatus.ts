// frontend/lib/offline/useOfflineStatus.ts
"use client";

import { useEffect, useMemo, useState } from "react";
import { listCachedArtifacts, readBootstrap } from "./cache_db";

export function useOfflineStatus(graph_id: string, branch_id: string) {
  const [online, setOnline] = useState<boolean>(true);
  const [artifactCount, setArtifactCount] = useState<number>(0);
  const [hasBootstrap, setHasBootstrap] = useState<boolean>(false);

  useEffect(() => {
    const update = () => setOnline(typeof navigator === "undefined" ? true : navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  useEffect(() => {
    (async () => {
      const b = await readBootstrap(graph_id, branch_id);
      setHasBootstrap(!!b);

      const arts = await listCachedArtifacts(graph_id, branch_id);
      setArtifactCount(arts.length);
    })();
  }, [graph_id, branch_id]);

  const offlineReady = useMemo(() => hasBootstrap && artifactCount > 0, [hasBootstrap, artifactCount]);

  return { online, offlineReady, artifactCount, hasBootstrap };
}

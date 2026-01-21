// frontend/lib/offline/network.ts
export function isProbablyOnWifi(): boolean {
    // Not perfect, but good enough for MVP.
    // @ts-expect-error - navigator.connection is not in standard types but exists in some browsers
    const conn = typeof navigator !== "undefined" ? navigator.connection : null;
    const effectiveType = conn?.effectiveType; // 'slow-2g' | '2g' | '3g' | '4g'
    const saveData = conn?.saveData;
  
    if (saveData) return false;
    if (effectiveType && effectiveType !== "4g") return false;
  
    return true;
  }
  
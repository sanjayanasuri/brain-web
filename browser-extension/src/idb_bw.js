// browser-extension/src/idb_bw.js
// Minimal IndexedDB helper for Brain Web offline-first event log.
// Stores immutable events and delivery state.

const DB_NAME = "brain_web";
const DB_VERSION = 1;

const STORES = {
  events: "events",
  meta: "meta"
};

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = () => {
      const db = req.result;

      // events store
      // keyPath: event_id
      // indexes: status, seq, created_at, graph_id
      if (!db.objectStoreNames.contains(STORES.events)) {
        const s = db.createObjectStore(STORES.events, { keyPath: "event_id" });
        s.createIndex("by_status", "status", { unique: false });
        s.createIndex("by_seq", ["device_id", "seq"], { unique: true });
        s.createIndex("by_created_at", "created_at", { unique: false });
        s.createIndex("by_graph_id", "graph_id", { unique: false });
      }

      // meta store
      // used for device_id, last_seq, last_ack, etc.
      if (!db.objectStoreNames.contains(STORES.meta)) {
        db.createObjectStore(STORES.meta, { keyPath: "key" });
      }
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function withTx(db, storeNames, mode, fn) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeNames, mode);
    const stores = storeNames.map((n) => tx.objectStore(n));

    let result;
    try {
      result = fn(tx, ...stores);
    } catch (e) {
      reject(e);
      return;
    }

    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

async function metaGet(key) {
  const db = await openDb();
  return withTx(db, [STORES.meta], "readonly", (_tx, meta) => {
    return new Promise((resolve, reject) => {
      const req = meta.get(key);
      req.onsuccess = () => resolve(req.result ? req.result.value : null);
      req.onerror = () => reject(req.error);
    });
  });
}

async function metaSet(key, value) {
  const db = await openDb();
  return withTx(db, [STORES.meta], "readwrite", (_tx, meta) => {
    return new Promise((resolve, reject) => {
      const req = meta.put({ key, value });
      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error);
    });
  });
}

async function metaSetMany(pairs) {
  const db = await openDb();
  return withTx(db, [STORES.meta], "readwrite", (_tx, meta) => {
    return Promise.all(
      pairs.map(
        ({ key, value }) =>
          new Promise((resolve, reject) => {
            const req = meta.put({ key, value });
            req.onsuccess = () => resolve(true);
            req.onerror = () => reject(req.error);
          })
      )
    );
  });
}

async function eventPut(evt) {
  const db = await openDb();
  return withTx(db, [STORES.events], "readwrite", (_tx, events) => {
    return new Promise((resolve, reject) => {
      const req = events.put(evt);
      req.onsuccess = () => resolve(evt);
      req.onerror = () => reject(req.error);
    });
  });
}

async function eventGet(event_id) {
  const db = await openDb();
  return withTx(db, [STORES.events], "readonly", (_tx, events) => {
    return new Promise((resolve, reject) => {
      const req = events.get(event_id);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  });
}

async function eventPatch(event_id, patch) {
  const db = await openDb();
  return withTx(db, [STORES.events], "readwrite", (_tx, events) => {
    return new Promise((resolve, reject) => {
      const getReq = events.get(event_id);
      getReq.onerror = () => reject(getReq.error);
      getReq.onsuccess = () => {
        const existing = getReq.result;
        if (!existing) return resolve(null);
        const updated = { ...existing, ...patch };
        const putReq = events.put(updated);
        putReq.onerror = () => reject(putReq.error);
        putReq.onsuccess = () => resolve(updated);
      };
    });
  });
}

async function eventsListByStatus(status, limit = 50) {
  const db = await openDb();
  return withTx(db, [STORES.events], "readonly", (_tx, events) => {
    return new Promise((resolve, reject) => {
      const idx = events.index("by_status");
      const req = idx.openCursor(IDBKeyRange.only(status));
      const out = [];
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor || out.length >= limit) return resolve(out);
        out.push(cursor.value);
        cursor.continue();
      };
    });
  });
}

async function eventsCountByStatus(status) {
  const db = await openDb();
  return withTx(db, [STORES.events], "readonly", (_tx, events) => {
    return new Promise((resolve, reject) => {
      const idx = events.index("by_status");
      const req = idx.count(IDBKeyRange.only(status));
      req.onerror = () => reject(req.error);
      req.onsuccess = () => resolve(req.result || 0);
    });
  });
}

async function eventsTrim(maxEvents = 500) {
  // Trim oldest by created_at if store grows too large.
  // This is a soft cap; you can set higher later.
  const db = await openDb();
  return withTx(db, [STORES.events], "readwrite", (_tx, events) => {
    return new Promise((resolve, reject) => {
      const countReq = events.count();
      countReq.onerror = () => reject(countReq.error);
      countReq.onsuccess = () => {
        const total = countReq.result || 0;
        if (total <= maxEvents) return resolve({ trimmed: 0, total });

        const toRemove = total - maxEvents;
        const idx = events.index("by_created_at");
        const cursorReq = idx.openCursor(); // ascending => oldest first
        let removed = 0;

        cursorReq.onerror = () => reject(cursorReq.error);
        cursorReq.onsuccess = () => {
          const cursor = cursorReq.result;
          if (!cursor || removed >= toRemove) return resolve({ trimmed: removed, total });
          const delReq = events.delete(cursor.primaryKey);
          delReq.onerror = () => reject(delReq.error);
          delReq.onsuccess = () => {
            removed += 1;
            cursor.continue();
          };
        };
      };
    });
  });
}

export const BW_IDB = {
  metaGet,
  metaSet,
  metaSetMany,
  eventPut,
  eventGet,
  eventPatch,
  eventsListByStatus,
  eventsCountByStatus,
  eventsTrim
};


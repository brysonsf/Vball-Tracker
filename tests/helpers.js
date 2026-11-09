const Core = require("../public/tracker-core.js");

const GAME_DATE = "2026-10-20";

function makePlayer(state, id, name) {
  return Core.addPlayer(state, { id, name });
}

function makeGame(state, id, playerIds, date = GAME_DATE) {
  return Core.recordGame(state, { id, playerIds, date, createdAt: `${date}T19:00:00.000Z` });
}

function makePayment(state, id, playerId, amount, date = GAME_DATE) {
  return Core.recordPayment(state, { id, playerId, amount, date, createdAt: `${date}T21:00:00.000Z` });
}

function makeInvoice(state, id, playerId, overrides = {}) {
  return Core.createInvoice(state, {
    id,
    playerId,
    category: "Equipment",
    name: "Team shirt",
    amount: 20,
    dueDate: "2026-11-01",
    description: "Custom group shirt order",
    date: GAME_DATE,
    createdAt: `${GAME_DATE}T18:00:00.000Z`,
    ...overrides
  });
}

function makeInvoicePayment(state, id, playerId, invoiceId, amount, date = GAME_DATE) {
  return Core.recordPayment(state, { id, playerId, invoiceId, amount, date, createdAt: `${date}T21:00:00.000Z` });
}

function makeStorage(initialValue = null) {
  const values = new Map();
  if (initialValue !== null) values.set("sideout-volleyball-tracker-v1", initialValue);
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    removeItem(key) {
      values.delete(key);
    },
    values
  };
}

function makeFirebase(initialDocuments = new Map()) {
  const documents = new Map(initialDocuments);
  const listeners = new Map();
  const collectionListeners = new Map();
  const serverTimestamp = { serverTimestamp: true };

  function reference(path) {
    return {
      id: path.split("/").pop(),
      path,
      collection: (collectionName) => collectionReference(`${path}/${collectionName}`),
      async get() {
        return {
          exists: documents.has(path),
          data: () => documents.get(path)
        };
      },
      async set(value) {
        documents.set(path, value);
        for (const listener of listeners.get(path) || []) {
          listener.next({ exists: true, data: () => value });
        }
        notifyCollection(path);
      },
      async delete() {
        documents.delete(path);
        for (const listener of listeners.get(path) || []) listener.next({ exists: false });
        notifyCollection(path);
      },
      onSnapshot(next, error) {
        const pathListeners = listeners.get(path) || [];
        const entry = { next, error };
        pathListeners.push(entry);
        listeners.set(path, pathListeners);
        if (documents.has(path)) next({ exists: true, data: () => documents.get(path) });
        return () => listeners.set(path, pathListeners.filter((listener) => listener !== entry));
      }
    };
  }

  function collectionReference(path) {
    return {
      doc: (documentId) => reference(`${path}/${documentId}`),
      async get() {
        return {
          docs: [...documents.entries()]
            .filter(([documentPath]) => documentPath.startsWith(`${path}/`) &&
              documentPath.slice(path.length + 1).split("/").length === 1)
            .map(([documentPath, value]) => ({
              id: documentPath.split("/").pop(),
              ref: reference(documentPath),
              data: () => value
            }))
        };
      },
      onSnapshot(next, error) {
        const collectionWatchers = collectionListeners.get(path) || [];
        const entry = { next, error };
        collectionWatchers.push(entry);
        collectionListeners.set(path, collectionWatchers);
        this.get().then(next, error);
        return () => collectionListeners.set(path,
          (collectionListeners.get(path) || []).filter((listener) => listener !== entry));
      }
    };
  }

  function notifyCollection(documentPath) {
    const segments = documentPath.split("/");
    for (let length = 1; length < segments.length; length += 2) {
      const collectionPath = segments.slice(0, length).join("/");
      const watchers = collectionListeners.get(collectionPath);
      if (!watchers?.length) continue;
      collectionReference(collectionPath).get().then((snapshot) => {
        watchers.forEach((watcher) => watcher.next(snapshot));
      });
    }
  }

  const firestore = () => ({
    collection: collectionReference,
    batch: () => {
      const writes = [];
      const batch = {
        set: (reference, value) => {
          writes.push({ type: "set", reference, value });
          return batch;
        },
        delete: (reference) => {
          writes.push({ type: "delete", reference });
          return batch;
        },
        commit: async () => {
          for (const write of writes) {
            if (write.type === "set") await write.reference.set(write.value);
            else await write.reference.delete();
          }
        }
      };
      return batch;
    },
    runTransaction: async (callback) => {
      const writes = [];
      const transaction = {
        get: (reference) => reference.get(),
        set: (reference, value) => {
          writes.push({ reference, value });
          return transaction;
        }
      };
      await callback(transaction);
      for (const write of writes) await write.reference.set(write.value);
    }
  });
  firestore.FieldValue = { serverTimestamp: () => serverTimestamp };

  return { firestore, documents, listeners, serverTimestamp };
}

module.exports = {
  Core, GAME_DATE, makePlayer, makeGame, makePayment, makeInvoice, makeInvoicePayment, makeStorage, makeFirebase
};

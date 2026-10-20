(() => {
  function createFirebaseStore(firebase, storage, storageKey, core) {
    function documentFor(user) {
      if (!user || typeof user.uid !== "string" || !user.uid) {
        throw new Error("Sign in before accessing saved group data.");
      }
      return firebase.firestore()
        .collection("users").doc(user.uid)
        .collection("tracker").doc("current");
    }

    async function load(user) {
      const reference = documentFor(user);
      const snapshot = await reference.get();
      if (snapshot.exists) {
        const data = snapshot.data();
        return core.migrateState(data.state);
      }

      const savedLocalData = storage.getItem(storageKey);
      if (savedLocalData === null) return null;
      const localState = core.loadState(storage, storageKey);
      const defaultState = core.createEmptyState();
      const isEmptyDefaultState = localState.players.length === 0 && localState.games.length === 0 &&
        localState.payments.length === 0 && localState.invoices.length === 0 &&
        localState.groupName === defaultState.groupName && localState.gameFeeCents === defaultState.gameFeeCents;
      if (isEmptyDefaultState) return null;
      await reference.set({
        state: localState,
        schemaVersion: 1,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      storage.removeItem(storageKey);
      return localState;
    }

    async function create(user, state) {
      core.validateState(state);
      const reference = documentFor(user);
      await firebase.firestore().runTransaction(async (transaction) => {
        const snapshot = await transaction.get(reference);
        if (snapshot.exists) {
          const error = new Error("A group already exists for this account.");
          error.code = "already-exists";
          throw error;
        }
        transaction.set(reference, {
          state,
          schemaVersion: 1,
          updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
      });
      storage.removeItem(storageKey);
    }

    async function save(user, state) {
      core.validateState(state);
      await documentFor(user).set({
        state,
        schemaVersion: 1,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      });
    }

    function watch(user, onState, onError) {
      return documentFor(user).onSnapshot((snapshot) => {
        if (!snapshot.exists) {
          onError(new Error("The saved group data was removed from Firebase."));
          return;
        }
        try {
          onState(core.migrateState(snapshot.data().state));
        } catch (error) {
          onError(error);
        }
      }, onError);
    }

    return { load, create, save, watch };
  }

  const api = { createFirebaseStore };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof globalThis !== "undefined") globalThis.SideoutFirebaseStore = api;
})();

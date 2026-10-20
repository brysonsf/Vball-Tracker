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

      const localState = core.loadState(storage, storageKey);
      await reference.set({
        state: localState,
        schemaVersion: 1,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      storage.removeItem(storageKey);
      return localState;
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

    return { load, save, watch };
  }

  const api = { createFirebaseStore };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof globalThis !== "undefined") globalThis.SideoutFirebaseStore = api;
})();

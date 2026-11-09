(() => {
  function createFirebaseStore(firebase, storage, storageKey, core) {
    const database = firebase.firestore();

    function userDocument(user) {
      if (!user || typeof user.uid !== "string" || !user.uid) {
        throw new Error("Sign in before accessing saved group data.");
      }
      return database.collection("users").doc(user.uid);
    }

    function trackerDocument(ownerUid) {
      return database.collection("users").doc(ownerUid)
        .collection("tracker").doc("current");
    }

    function groupDocument(ownerUid) {
      return database.collection("groups").doc(ownerUid);
    }

    function memberDocument(ownerUid, uid) {
      return groupDocument(ownerUid).collection("members").doc(uid);
    }

    function playerViewDocument(ownerUid, uid) {
      return groupDocument(ownerUid).collection("playerViews").doc(uid);
    }

    function membershipDocument(user) {
      return userDocument(user).collection("groupMembership").doc("current");
    }

    function registrationsCollection(ownerUid, uid) {
      return groupDocument(ownerUid).collection("registrations").doc(uid).collection("games");
    }

    function currentDate() {
      const date = new Date();
      return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    }

    function publicSchedule(state) {
      return state.games.filter((game) => game.date > currentDate() && game.isPublic !== false)
        .map(gameSchedule);
    }

    function gameSchedule(game) {
      return {
        id: game.id,
        date: game.date,
        teams: (game.teams || []).map((team) => ({ name: team.name }))
      };
    }

    async function memberFor(user) {
      const membershipSnapshot = await membershipDocument(user).get();
      if (!membershipSnapshot.exists) return null;
      const membership = membershipSnapshot.data();
      const snapshot = await memberDocument(membership.ownerUid, user.uid).get();
      if (!snapshot.exists) throw new Error("Your access to this group has been removed. Contact the group admin.");
      return { ownerUid: membership.ownerUid, ...snapshot.data() };
    }

    async function ensureOwnerMembership(user, state) {
      const ownerUid = user.uid;
      const group = groupDocument(ownerUid);
      const batch = database.batch();
      batch.set(group.collection("metadata").doc("current"), {
        ownerUid,
        groupName: state.groupName
      });
      batch.set(memberDocument(ownerUid, ownerUid), {
        uid: ownerUid,
        role: "owner",
        email: user.email || "",
        playerId: null
      });
      batch.set(membershipDocument(user), {
        ownerUid,
        role: "owner",
        playerId: null
      });
      await batch.commit();
    }

    async function getUserContext(user) {
      const member = await memberFor(user);
      if (member) return member;

      const snapshot = await trackerDocument(user.uid).get();
      if (!snapshot.exists) return null;
      const state = core.migrateState(snapshot.data().state);
      await ensureOwnerMembership(user, state);
      return { ownerUid: user.uid, uid: user.uid, role: "owner", playerId: null };
    }

    async function loadPlayer(user, member) {
      const [viewSnapshot, registrationSnapshot] = await Promise.all([
        playerViewDocument(member.ownerUid, user.uid).get(),
        registrationsCollection(member.ownerUid, user.uid).get()
      ]);
      if (!viewSnapshot.exists) {
        throw new Error("Your player profile is not available. Contact the group admin.");
      }
      const view = viewSnapshot.data();
      return {
        state: null,
        access: {
          role: "player",
          ownerUid: member.ownerUid,
          playerId: member.playerId,
          playerName: view.playerName,
          groupName: view.groupName,
          balanceCents: view.balanceCents,
          games: view.games || [],
          registrations: registrationSnapshot.docs.map((document) => document.data().schedule)
        }
      };
    }

    async function load(user) {
      const member = await getUserContext(user);
      if (!member) {
        const savedLocalData = storage.getItem(storageKey);
        if (savedLocalData === null) return null;
        const localState = core.loadState(storage, storageKey);
        const defaultState = core.createEmptyState();
        const isEmptyDefaultState = localState.players.length === 0 && localState.games.length === 0 &&
          localState.payments.length === 0 && localState.invoices.length === 0 && localState.tournaments.length === 0 &&
          localState.rosterActivity.length === 0 &&
          localState.groupName === defaultState.groupName && localState.gameFeeCents === defaultState.gameFeeCents;
        if (isEmptyDefaultState) return null;
        await create(user, localState);
        return { state: localState, access: { role: "owner", ownerUid: user.uid } };
      }

      if (member.role === "player") return loadPlayer(user, member);
      const snapshot = await trackerDocument(member.ownerUid).get();
      if (!snapshot.exists) throw new Error("The saved group data was removed from Firebase.");
      return {
        state: core.migrateState(snapshot.data().state),
        access: { role: member.role, ownerUid: member.ownerUid }
      };
    }

    async function create(user, state) {
      core.validateState(state);
      const tracker = trackerDocument(user.uid);
      const group = groupDocument(user.uid);
      await database.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(tracker);
        if (snapshot.exists) {
          const error = new Error("A group already exists for this account.");
          error.code = "already-exists";
          throw error;
        }
        transaction.set(tracker, {
          state,
          schemaVersion: 1,
          updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        transaction.set(group.collection("metadata").doc("current"), {
          ownerUid: user.uid,
          groupName: state.groupName
        });
        transaction.set(memberDocument(user.uid, user.uid), {
          uid: user.uid,
          role: "owner",
          email: user.email || "",
          playerId: null
        });
        transaction.set(membershipDocument(user), {
          ownerUid: user.uid,
          role: "owner",
          playerId: null
        });
      });
      storage.removeItem(storageKey);
    }

    async function save(user, state) {
      core.validateState(state);
      const member = await memberFor(user);
      if (!member || !["owner", "coadmin"].includes(member.role)) {
        throw new Error("Only group admins can change group data.");
      }
      const membersSnapshot = await groupDocument(member.ownerUid).collection("members").get();
      const playerMembers = membersSnapshot.docs.filter((document) => document.data().role === "player");
      const registrationSnapshots = await Promise.all(playerMembers.map((document) =>
        registrationsCollection(member.ownerUid, document.id).get()
      ));
      const batch = database.batch();
      batch.set(trackerDocument(member.ownerUid), {
        state,
        schemaVersion: 1,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      batch.set(groupDocument(member.ownerUid).collection("metadata").doc("current"), {
        ownerUid: member.ownerUid,
        groupName: state.groupName
      });

      membersSnapshot.docs.forEach((document) => {
        const groupMember = document.data();
        if (groupMember.role !== "player") return;
        const player = state.players.find((entry) => entry.id === groupMember.playerId);
        const games = publicSchedule(state);
        const view = player ? {
          playerId: player.id,
          playerName: player.name,
          groupName: state.groupName,
          balanceCents: core.getPlayerStats(state, player.id).balanceCents,
          games,
          publicGameIds: games.map((game) => game.id),
          publicGameDetails: Object.fromEntries(games.map((game) => [game.id, game]))
        } : null;
        if (view) batch.set(playerViewDocument(member.ownerUid, document.id), view);
        else {
          batch.delete(memberDocument(member.ownerUid, document.id));
          batch.delete(playerViewDocument(member.ownerUid, document.id));
        }
      });
      playerMembers.forEach((document, index) => {
        registrationSnapshots[index].docs.forEach((registration) => {
          const currentGame = state.games.find((game) => game.id === registration.data().gameId);
          if (!currentGame || !state.players.some((player) => player.id === document.data().playerId)) {
            batch.delete(registration.ref);
          } else {
            batch.set(registration.ref, {
              ...registration.data(),
              schedule: gameSchedule(currentGame)
            });
          }
        });
      });
      await batch.commit();
    }

    function watch(user, onState, onError) {
      let context = null;
      let viewReady = false;
      let registrationsReady = false;
      let latestView;
      let latestRegistrations = [];
      let stopView = () => {};
      let stopRegistrations = () => {};
      let stopped = false;

      async function start() {
        try {
          context = await getUserContext(user);
          if (stopped) return;
          if (!context) throw new Error("Your group membership could not be found.");
          if (context.role !== "player") {
            stopView = trackerDocument(context.ownerUid).onSnapshot((snapshot) => {
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
            return;
          }
          stopView = playerViewDocument(context.ownerUid, user.uid).onSnapshot((snapshot) => {
            if (!snapshot.exists) {
              onError(new Error("Your player profile is not available. Contact the group admin."));
              return;
            }
            latestView = snapshot.data();
            viewReady = true;
            notifyPlayer();
          }, onError);
          stopRegistrations = registrationsCollection(context.ownerUid, user.uid).onSnapshot((snapshot) => {
            latestRegistrations = snapshot.docs.map((document) => document.data().schedule);
            registrationsReady = true;
            notifyPlayer();
          }, onError);
        } catch (error) {
          onError(error);
        }
      }

      function notifyPlayer() {
        if (!viewReady || !registrationsReady) return;
        onState({
          role: "player",
          ownerUid: context.ownerUid,
          playerId: context.playerId,
          playerName: latestView.playerName,
          groupName: latestView.groupName,
          balanceCents: latestView.balanceCents,
          games: latestView.games || [],
          registrations: latestRegistrations
        });
      }

      start();
      return () => {
        stopped = true;
        stopView();
        stopRegistrations();
      };
    }

    async function createInvitation(user, { id, email, role, playerId = null, playerView = null }) {
      const member = await memberFor(user);
      if (!member || !["owner", "coadmin"].includes(member.role)) {
        throw new Error("Only group admins can invite members.");
      }
      if (!["coadmin", "player"].includes(role)) throw new Error("Choose a valid member role.");
      if (member.role === "coadmin" && role !== "player") {
        throw new Error("Co-admins can only invite players.");
      }
      if (!id || typeof email !== "string" || !email.trim()) throw new Error("Enter a valid email address.");
      if (role === "player" && (typeof playerId !== "string" || !playerView ||
        playerView.playerId !== playerId || !Array.isArray(playerView.games) ||
        !Array.isArray(playerView.publicGameIds) || !playerView.publicGameDetails)) {
        throw new Error("A player invitation needs a valid roster profile.");
      }
      const normalizedEmail = email.trim().toLocaleLowerCase();
      const [membersSnapshot, invitationsSnapshot] = await Promise.all([
        groupDocument(member.ownerUid).collection("members").get(),
        groupDocument(member.ownerUid).collection("invitations").get()
      ]);
      if (membersSnapshot.docs.some((document) =>
        (document.data().email || "").toLocaleLowerCase() === normalizedEmail)) {
        throw new Error("This email already has access to the group.");
      }
      if (invitationsSnapshot.docs.some((document) =>
        document.data().status === "pending" && document.data().email === normalizedEmail)) {
        throw new Error("There is already a pending invitation for this email.");
      }
      if (role === "player" && membersSnapshot.docs.some((document) =>
        document.data().role === "player" && document.data().playerId === playerId)) {
        throw new Error("This roster player already has group access.");
      }
      await groupDocument(member.ownerUid).collection("invitations").doc(id).set({
        email: normalizedEmail,
        role,
        playerId: role === "player" ? playerId : null,
        playerView: role === "player" ? playerView : null,
        status: "pending",
        invitedBy: user.uid,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      return member.ownerUid;
    }

    async function acceptInvitation(user, ownerUid, invitationId) {
      const invitation = groupDocument(ownerUid).collection("invitations").doc(invitationId);
      await database.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(invitation);
        if (!snapshot.exists) throw new Error("This invitation could not be found.");
        const data = snapshot.data();
        if (data.status !== "pending") throw new Error("This invitation is no longer available.");
        if (!user.email || data.email !== user.email.toLocaleLowerCase()) {
          throw new Error(`This invitation is for ${data.email}. Sign in with that email address.`);
        }
        if (!["coadmin", "player"].includes(data.role) ||
          data.role === "player" && (!data.playerView || data.playerView.playerId !== data.playerId)) {
          throw new Error("This invitation is incomplete. Ask the group admin to create a new one.");
        }
        transaction.set(memberDocument(ownerUid, user.uid), {
          uid: user.uid,
          role: data.role,
          email: data.email,
          playerId: data.playerId || null,
          invitationId
        });
        transaction.set(membershipDocument(user), {
          ownerUid,
          role: data.role,
          playerId: data.playerId || null
        });
        if (data.role === "player") {
          transaction.set(playerViewDocument(ownerUid, user.uid), data.playerView);
        }
        transaction.set(invitation, {
          ...data,
          status: "accepted",
          acceptedBy: user.uid
        });
      });
    }

    async function listMembers(user) {
      const member = await memberFor(user);
      if (!member || !["owner", "coadmin"].includes(member.role)) {
        throw new Error("Only group admins can view group members.");
      }
      const snapshot = await groupDocument(member.ownerUid).collection("members").get();
      return snapshot.docs.map((document) => ({ ...document.data(), uid: document.id }));
    }

    async function listInvitations(user) {
      const member = await memberFor(user);
      if (!member || !["owner", "coadmin"].includes(member.role)) {
        throw new Error("Only group admins can view invitations.");
      }
      const snapshot = await groupDocument(member.ownerUid).collection("invitations").get();
      return snapshot.docs
        .map((document) => ({ ...document.data(), id: document.id }))
        .filter((invitation) => invitation.status === "pending" &&
          (member.role === "owner" || invitation.role === "player"));
    }

    async function cancelInvitation(user, invitationId) {
      const member = await memberFor(user);
      if (!member || !["owner", "coadmin"].includes(member.role)) {
        throw new Error("Only group admins can cancel invitations.");
      }
      const invitation = groupDocument(member.ownerUid).collection("invitations").doc(invitationId);
      const snapshot = await invitation.get();
      if (!snapshot.exists || snapshot.data().status !== "pending") {
        throw new Error("That pending invitation could not be found.");
      }
      if (member.role === "coadmin" && snapshot.data().role !== "player") {
        throw new Error("Co-admins can only cancel player invitations.");
      }
      await invitation.delete();
    }

    async function listRegistrations(user, gameId) {
      const member = await memberFor(user);
      if (!member || !["owner", "coadmin"].includes(member.role)) {
        throw new Error("Only group admins can view game registrations.");
      }
      const membersSnapshot = await groupDocument(member.ownerUid).collection("members").get();
      const playerMembers = membersSnapshot.docs.filter((document) => document.data().role === "player");
      const registrations = await Promise.all(playerMembers.map(async (document) => {
        const snapshot = await registrationsCollection(member.ownerUid, document.id).get();
        return snapshot.docs
          .map((registration) => ({
            ...registration.data(),
            uid: document.id,
            playerId: document.data().playerId,
            email: document.data().email
          }))
          .filter((registration) => gameId === undefined || registration.gameId === gameId);
      }));
      return registrations.flat();
    }

    async function removeMember(user, uid) {
      const actor = await memberFor(user);
      if (!actor || !["owner", "coadmin"].includes(actor.role) || uid === actor.ownerUid) {
        throw new Error("You cannot remove this group member.");
      }
      const targetSnapshot = await memberDocument(actor.ownerUid, uid).get();
      if (!targetSnapshot.exists) throw new Error("That group member could not be found.");
      const target = targetSnapshot.data();
      if (actor.role === "coadmin" && target.role !== "player") {
        throw new Error("Co-admins can only remove players.");
      }
      const registrations = await registrationsCollection(actor.ownerUid, uid).get();
      const batch = database.batch();
      batch.delete(memberDocument(actor.ownerUid, uid));
      batch.delete(playerViewDocument(actor.ownerUid, uid));
      registrations.docs.forEach((document) => batch.delete(document.ref));
      await batch.commit();
    }

    async function setRegistration(user, gameId, shouldRegister) {
      const member = await memberFor(user);
      if (!member || member.role !== "player") throw new Error("Only players can register for games.");
      const viewSnapshot = await playerViewDocument(member.ownerUid, user.uid).get();
      if (!viewSnapshot.exists) throw new Error("Your player profile is not available.");
      const view = viewSnapshot.data();
      const schedule = view.publicGameDetails?.[gameId];
      const registration = registrationsCollection(member.ownerUid, user.uid).doc(gameId);
      if (shouldRegister) {
        if (!schedule) throw new Error("This game is not currently open for registration.");
        await registration.set({
          gameId,
          schedule,
          registeredAt: firebase.firestore.FieldValue.serverTimestamp()
        });
      } else {
        await registration.delete();
      }
    }

    return {
      load,
      create,
      save,
      watch,
      createInvitation,
      acceptInvitation,
      listMembers,
      listInvitations,
      cancelInvitation,
      listRegistrations,
      removeMember,
      setRegistration
    };
  }

  const api = { createFirebaseStore };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof globalThis !== "undefined") globalThis.SideoutFirebaseStore = api;
})();

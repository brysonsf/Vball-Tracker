const test = require("node:test");
const assert = require("node:assert/strict");
const {
  Core, GAME_DATE, makePlayer, makeGame, makePayment, makeInvoice, makeInvoicePayment,
  makeStorage, makeFirebase
} = require("./helpers.js");
const { createFirebaseStore } = require("../public/firebase-store.js");

const STORAGE_KEY = "sideout-volleyball-tracker-v1";

test("an empty browser store loads as a new tracker", () => {
  const state = Core.loadState(makeStorage(), "sideout-volleyball-tracker-v1");

  assert.deepEqual(state, { gameFeeCents: 500, players: [], games: [], payments: [], invoices: [] });
});

test("legacy saved data migrates with the original five-dollar rate and no invoices", () => {
  const legacy = JSON.stringify({
    players: [{ id: "p1", name: "Jordan Lee" }],
    games: [{ id: "g1", date: GAME_DATE, playerIds: ["p1"] }],
    payments: []
  });
  const restored = Core.loadState(makeStorage(legacy), "sideout-volleyball-tracker-v1");

  assert.equal(restored.gameFeeCents, 500);
  assert.deepEqual(restored.invoices, []);
  assert.equal(restored.games[0].rateCents, 500);
  assert.equal(Core.getPlayerStats(restored, "p1").balance, 5);
});

test("legacy invoices gain a player name when local data is upgraded for Firebase", () => {
  const legacy = JSON.stringify({
    players: [{ id: "p1", name: "Jordan Lee" }],
    games: [],
    payments: [],
    invoices: [{
      id: "i1", playerId: "p1", name: "Tournament entry", category: "Tournament",
      description: "Registration share", dueDate: "2026-11-01", date: GAME_DATE, amountCents: 3000
    }]
  });
  const restored = Core.loadState(makeStorage(legacy), STORAGE_KEY);

  assert.equal(restored.invoices[0].playerName, "Jordan Lee");
  assert.equal(restored.gameFeeCents, 500);
  assert.equal(Core.getSummary(restored).owed, 30);
});

test("saved state survives a complete browser-storage round trip", () => {
  const storage = makeStorage();
  let state = Core.createEmptyState();
  state = makePlayer(state, "p1", "Jordan Lee");
  state = makeGame(state, "g1", ["p1"]);
  state = makePayment(state, "pay1", "p1", 2.5);

  Core.saveState(state, storage, "sideout-volleyball-tracker-v1");
  const restored = Core.loadState(storage, "sideout-volleyball-tracker-v1");

  assert.deepEqual(restored, state);
  assert.equal(Core.getPlayerStats(restored, "p1").balance, 2.5);
});

test("stored JSON that is not valid tracker data fails explicitly", () => {
  for (const raw of ["{not json", "null", '{"players":[],"games":[],"payments":{}}']) {
    assert.throws(
      () => Core.loadState(makeStorage(raw), "sideout-volleyball-tracker-v1"),
      /JSON|unexpected format/
    );
  }
});

test("a storage write failure is reported and leaves the prior saved value intact", () => {
  const storage = makeStorage('{"players":[],"games":[],"payments":[]}');
  storage.setItem = () => { throw new Error("quota exceeded"); };
  const state = makePlayer(Core.createEmptyState(), "p1", "Jordan Lee");

  assert.throws(() => Core.saveState(state, storage, "sideout-volleyball-tracker-v1"), /quota exceeded/);
  assert.equal(storage.getItem("sideout-volleyball-tracker-v1"), '{"players":[],"games":[],"payments":[]}');
});

test("recording games and split payments persists correct balances after reload", () => {
  const storage = makeStorage();
  let state = Core.createEmptyState();
  state = makePlayer(state, "p1", "Jordan Lee");
  state = makePlayer(state, "p2", "Casey Smith");
  state = makeGame(state, "g1", ["p1", "p2"], GAME_DATE);
  state = makeGame(state, "g2", ["p1"], GAME_DATE);
  state = makePayment(state, "pay1", "p1", 2.5, GAME_DATE);
  state = makePayment(state, "pay2", "p1", 2.5, GAME_DATE);
  state = makePayment(state, "pay3", "p2", 5, GAME_DATE);
  Core.saveState(state, storage, "sideout-volleyball-tracker-v1");

  const restored = Core.loadState(storage, "sideout-volleyball-tracker-v1");
  assert.equal(Core.getPlayerStats(restored, "p1").balance, 5);
  assert.equal(Core.getPlayerStats(restored, "p2").balance, 0);
  assert.equal(Core.getSummary(restored).owed, 5);
});

test("custom fee and separately paid invoice persist through a storage round trip", () => {
  const storage = makeStorage();
  let state = Core.createEmptyState();
  state = makePlayer(state, "p1", "Jordan Lee");
  state = Core.setGameFee(state, 7.5);
  state = makeGame(state, "g1", ["p1"]);
  state = makeInvoice(state, "i1", "p1", { amount: 22.5, dueDate: "2026-11-10" });
  state = makeInvoicePayment(state, "pay1", "p1", "i1", 10);
  Core.saveState(state, storage, "sideout-volleyball-tracker-v1");

  const restored = Core.loadState(storage, "sideout-volleyball-tracker-v1");
  assert.equal(restored.gameFeeCents, 750);
  assert.equal(Core.getPlayerStats(restored, "p1").gameBalance, 7.5);
  assert.equal(Core.getInvoiceStats(restored, "i1").balance, 12.5);
  assert.equal(Core.getPlayerStats(restored, "p1").balance, 20);
  assert.equal(Core.getSummary(restored).collected, 10);
});

test("removing a player from the active roster does not erase their persisted history", () => {
  const storage = makeStorage();
  let state = makePlayer(Core.createEmptyState(), "p1", "Jordan Lee");
  state = makeGame(state, "g1", ["p1"]);
  state = Core.removePlayer(state, "p1");
  Core.saveState(state, storage, "sideout-volleyball-tracker-v1");
  const restored = Core.loadState(storage, "sideout-volleyball-tracker-v1");

  assert.equal(restored.players.length, 0);
  assert.equal(restored.games.length, 1);
  assert.deepEqual(restored.games[0].playerIds, ["p1"]);
});

test("an invoice issued to a former player can still be settled after reload", () => {
  const storage = makeStorage();
  let state = makePlayer(Core.createEmptyState(), "p1", "Jordan Lee");
  state = makeInvoice(state, "i1", "p1", { amount: 18 });
  state = Core.removePlayer(state, "p1");
  Core.saveState(state, storage, "sideout-volleyball-tracker-v1");

  let reopened = Core.loadState(storage, "sideout-volleyball-tracker-v1");
  assert.equal(reopened.invoices[0].playerName, "Jordan Lee");
  assert.equal(Core.getSummary(reopened).owed, 18);
  reopened = makeInvoicePayment(reopened, "pay1", "p1", "i1", 18);
  Core.saveState(reopened, storage, "sideout-volleyball-tracker-v1");

  assert.equal(Core.getSummary(Core.loadState(storage, "sideout-volleyball-tracker-v1")).owed, 0);
});

test("Firebase store imports existing local state into only the signed-in user's document", async () => {
  const state = makePlayer(Core.createEmptyState(), "p1", "Jordan Lee");
  const storage = makeStorage(JSON.stringify(state));
  const firebase = makeFirebase();
  const store = createFirebaseStore(firebase, storage, STORAGE_KEY, Core);

  const imported = await store.load({ uid: "organizer-a" });

  assert.deepEqual(imported, state);
  assert.equal(storage.getItem(STORAGE_KEY), null);
  assert.deepEqual([...firebase.documents.keys()], ["users/organizer-a/tracker/current"]);
  assert.deepEqual(firebase.documents.get("users/organizer-a/tracker/current").state, state);
});

test("Firebase store leaves corrupt local data intact if migration cannot be validated", async () => {
  const storage = makeStorage("{not json");
  const firebase = makeFirebase();
  const store = createFirebaseStore(firebase, storage, STORAGE_KEY, Core);

  await assert.rejects(store.load({ uid: "organizer-a" }));
  assert.equal(storage.getItem(STORAGE_KEY), "{not json");
  assert.equal(firebase.documents.size, 0);
});

test("Firebase account data is isolated by authenticated UID and loads cloud before local data", async () => {
  const cloudState = makePlayer(Core.createEmptyState(), "cloud-player", "Cloud Player");
  const localState = makePlayer(Core.createEmptyState(), "local-player", "Local Player");
  const path = "users/organizer-a/tracker/current";
  const firebase = makeFirebase(new Map([[path, { state: cloudState, schemaVersion: 1 }]]));
  const storage = makeStorage(JSON.stringify(localState));
  const store = createFirebaseStore(firebase, storage, STORAGE_KEY, Core);

  const loaded = await store.load({ uid: "organizer-a" });
  await store.save({ uid: "organizer-b" }, localState);

  assert.deepEqual(loaded.players, [{ id: "cloud-player", name: "Cloud Player" }]);
  assert.equal(storage.getItem(STORAGE_KEY) !== null, true);
  assert.deepEqual([...firebase.documents.keys()].sort(), [
    "users/organizer-a/tracker/current", "users/organizer-b/tracker/current"
  ]);
  assert.equal(firebase.documents.get("users/organizer-b/tracker/current").state.players[0].name, "Local Player");
});

test("Firebase store refuses reads and writes without an authenticated UID", async () => {
  const store = createFirebaseStore(makeFirebase(), makeStorage(), STORAGE_KEY, Core);

  await assert.rejects(store.load(null), /Sign in before accessing/);
  await assert.rejects(store.save({ uid: "" }, Core.createEmptyState()), /Sign in before accessing/);
});

test("Firebase snapshot listener receives validated updates and can unsubscribe", async () => {
  const firebase = makeFirebase();
  const storage = makeStorage();
  const store = createFirebaseStore(firebase, storage, STORAGE_KEY, Core);
  const state = makePlayer(Core.createEmptyState(), "p1", "Jordan Lee");
  await store.save({ uid: "organizer-a" }, state);
  const observed = [];
  const unsubscribe = store.watch({ uid: "organizer-a" }, (next) => observed.push(next), (error) => {
    throw error;
  });
  const updated = makePlayer(state, "p2", "Casey Smith");
  await store.save({ uid: "organizer-a" }, updated);
  unsubscribe();
  await store.save({ uid: "organizer-a" }, Core.createEmptyState());

  assert.equal(observed.length, 2);
  assert.equal(observed[1].players.length, 2);
});

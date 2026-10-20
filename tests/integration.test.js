const test = require("node:test");
const assert = require("node:assert/strict");
const {
  Core, GAME_DATE, makePlayer, makeGame, makePayment, makeInvoice, makeInvoicePayment, makeStorage
} = require("./helpers.js");

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

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  Core, makePlayer, makeGame, makePayment, makeInvoice, makeInvoicePayment, makeStorage
} = require("./helpers.js");

test("acceptance: organizer adds a rotating crew and sees an initially clear dashboard", () => {
  let state = Core.createEmptyState();
  state = makePlayer(state, "p1", "Jordan Lee");
  state = makePlayer(state, "p2", "Casey Smith");
  state = makePlayer(state, "p3", "Morgan Diaz");

  assert.equal(Core.getSummary(state).players, 3);
  assert.equal(Core.getSummary(state).owed, 0);
  assert.ok(state.players.some((player) => player.name === "Morgan Diaz"));
});

test("acceptance: organizer renames the group without changing its roster or dues", () => {
  let state = Core.createEmptyState();
  state = makePlayer(state, "p1", "Jordan Lee");
  state = makeGame(state, "g1", ["p1"]);
  state = Core.setGroupName(state, "Tuesday crew");

  assert.equal(state.groupName, "Tuesday crew");
  assert.equal(state.players.length, 1);
  assert.equal(Core.getPlayerStats(state, "p1").balance, 5);
});

test("acceptance: organizer logs only attendees and each attendee owes five dollars", () => {
  let state = Core.createEmptyState();
  state = makePlayer(state, "p1", "Jordan Lee");
  state = makePlayer(state, "p2", "Casey Smith");
  state = makePlayer(state, "p3", "Morgan Diaz");
  state = makeGame(state, "g1", ["p1", "p3"]);

  assert.equal(Core.getPlayerStats(state, "p1").balance, 5);
  assert.equal(Core.getPlayerStats(state, "p2").balance, 0);
  assert.equal(Core.getPlayerStats(state, "p3").balance, 5);
  assert.equal(Core.getSummary(state).owed, 10);
});

test("acceptance: a partial payment reduces but does not clear a player's balance", () => {
  let state = Core.createEmptyState();
  state = makePlayer(state, "p1", "Jordan Lee");
  state = makeGame(state, "g1", ["p1"]);
  state = makePayment(state, "pay1", "p1", 2);

  assert.equal(Core.getPlayerStats(state, "p1").paid, 2);
  assert.equal(Core.getPlayerStats(state, "p1").balance, 3);
  assert.equal(Core.getSummary(state).collected, 2);
});

test("acceptance: paying the rest clears dues and updates the dashboard total", () => {
  let state = Core.createEmptyState();
  state = makePlayer(state, "p1", "Jordan Lee");
  state = makeGame(state, "g1", ["p1"]);
  state = makePayment(state, "pay1", "p1", 2);
  state = makePayment(state, "pay2", "p1", 3);

  assert.equal(Core.getPlayerStats(state, "p1").balance, 0);
  assert.equal(Core.getSummary(state).collected, 5);
  assert.equal(Core.getSummary(state).owed, 0);
});

test("acceptance: saved dues remain correct after closing and reopening the browser", () => {
  const storage = makeStorage();
  let state = Core.createEmptyState();
  state = makePlayer(state, "p1", "Jordan Lee");
  state = makePlayer(state, "p2", "Casey Smith");
  state = makeGame(state, "g1", ["p1", "p2"]);
  state = makePayment(state, "pay1", "p1", 5);
  Core.saveState(state, storage, "sideout-volleyball-tracker-v1");

  const reopenedState = Core.loadState(storage, "sideout-volleyball-tracker-v1");

  assert.equal(Core.getPlayerStats(reopenedState, "p1").balance, 0);
  assert.equal(Core.getPlayerStats(reopenedState, "p2").balance, 5);
  assert.equal(Core.getSummary(reopenedState).collected, 5);
  assert.equal(Core.getSummary(reopenedState).owed, 5);
});

test("acceptance: organizer changes future game dues and invoices a player for a team expense", () => {
  let state = Core.createEmptyState();
  state = makePlayer(state, "p1", "Jordan Lee");
  state = makeGame(state, "g1", ["p1"]);
  state = Core.setGameFee(state, 7.5);
  state = makeGame(state, "g2", ["p1"]);
  state = makeInvoice(state, "i1", "p1", {
    category: "Tournament", name: "Regional entry", amount: 30,
    dueDate: "2026-11-10", description: "Player share of the tournament registration."
  });

  assert.equal(Core.getPlayerStats(state, "p1").balance, 42.5);
  assert.equal(Core.getPlayerStats(state, "p1").gameBalance, 12.5);
  assert.equal(Core.getInvoiceStats(state, "i1").balance, 30);

  state = makeInvoicePayment(state, "pay1", "p1", "i1", 30);
  assert.equal(Core.getInvoiceStats(state, "i1").balance, 0);
  assert.equal(Core.getPlayerStats(state, "p1").balance, 12.5);
});

test("acceptance: invoice charge remains understandable and payable after roster removal", () => {
  let state = Core.createEmptyState();
  state = makePlayer(state, "p1", "Jordan Lee");
  state = makeInvoice(state, "i1", "p1", {
    category: "Equipment", name: "New net share", amount: 24,
    dueDate: "2026-11-10", description: "One-sixth share of the replacement practice net."
  });
  state = Core.removePlayer(state, "p1");

  assert.equal(state.invoices[0].playerName, "Jordan Lee");
  assert.equal(state.invoices[0].description, "One-sixth share of the replacement practice net.");
  assert.equal(Core.getSummary(state).owed, 24);
  state = makeInvoicePayment(state, "pay1", "p1", "i1", 24);
  assert.equal(Core.getSummary(state).owed, 0);
});

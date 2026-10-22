const test = require("node:test");
const assert = require("node:assert/strict");
const {
  Core, GAME_DATE, makePlayer, makeGame, makePayment, makeInvoice, makeInvoicePayment
} = require("./helpers.js");

test("ID generation creates UUIDs using getRandomValues when randomUUID is unavailable", () => {
  let calls = 0;
  const cryptoApi = {
    getRandomValues(bytes) {
      calls += 1;
      bytes.fill(0);
      return bytes;
    }
  };
  const id = Core.createId(cryptoApi);

  assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(calls, 1);
});

test("ID generation remains available when the browser has no Web Crypto API", () => {
  const id = Core.createId(undefined);
  assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

test("empty state has independent player, game, and payment collections", () => {
  const first = Core.createEmptyState();
  const second = Core.createEmptyState();

  assert.deepEqual(first, {
    groupName: "Wednesday night", gameFeeCents: 500, players: [], games: [], payments: [], invoices: [], rosterActivity: []
  });
  assert.notStrictEqual(first.players, second.players);
});

test("group names are trimmed and must be nonblank and at most 60 characters", () => {
  const initial = Core.createEmptyState();
  const renamed = Core.setGroupName(initial, "  Tuesday crew  ");

  assert.equal(renamed.groupName, "Tuesday crew");
  assert.equal(initial.groupName, "Wednesday night");
  assert.throws(() => Core.setGroupName(initial, "  "), /Enter a group name/);
  assert.throws(() => Core.setGroupName(initial, "x".repeat(61)), /60 characters or fewer/);
});

test("new group setup captures its name and default fee without changing historical fees", () => {
  const state = Core.createGroupState("  Tuesday crew ", "8.50");
  const withPlayer = makePlayer(state, "p1", "Jordan Lee");
  const withGame = makeGame(withPlayer, "g1", ["p1"]);

  assert.equal(state.groupName, "Tuesday crew");
  assert.equal(state.gameFeeCents, 850);
  assert.equal(withGame.games[0].rateCents, 850);
  assert.throws(() => Core.createGroupState("  ", "5"), /Enter a group name/);
  assert.throws(() => Core.createGroupState("League", "10000.01"), /between \$0 and \$10,000/);
});

test("player names are trimmed before being stored", () => {
  const state = makePlayer(Core.createEmptyState(), "p1", "  Jordan Lee  ");

  assert.deepEqual(state.players, [{ id: "p1", name: "Jordan Lee" }]);
});

test("blank and duplicate player names are rejected without changing the roster", () => {
  const state = makePlayer(Core.createEmptyState(), "p1", "Jordan Lee");

  assert.throws(() => Core.addPlayer(state, { id: "p2", name: "   " }), /Enter a player name/);
  assert.throws(() => Core.addPlayer(state, { id: "p2", name: "jOrDaN lEe" }), /already on the roster/);
  assert.equal(state.players.length, 1);
});

test("renaming a player preserves their ID, attendance, payments, invoices, and balances", () => {
  let state = makePlayer(Core.createEmptyState(), "p1", "Jordan Lee");
  state = makePlayer(state, "p2", "Casey Smith");
  state = makeGame(state, "g1", ["p1"]);
  state = makePayment(state, "pay1", "p1", 2);
  state = makeInvoice(state, "i1", "p1", { amount: 12 });

  const renamed = Core.renamePlayer(state, "p1", "  Jordan Rivera  ");

  assert.equal(renamed.players[0].name, "Jordan Rivera");
  assert.equal(renamed.players[0].id, "p1");
  assert.equal(renamed.invoices[0].playerName, "Jordan Rivera");
  assert.equal(renamed.games[0].playerIds[0], "p1");
  assert.equal(renamed.payments[0].playerId, "p1");
  assert.equal(Core.getPlayerStats(renamed, "p1").balance, 15);
  assert.equal(state.players[0].name, "Jordan Lee");
  assert.equal(state.invoices[0].playerName, "Jordan Lee");
});

test("renaming rejects blank, too-long, duplicate, and missing player names", () => {
  let state = makePlayer(Core.createEmptyState(), "p1", "Jordan Lee");
  state = makePlayer(state, "p2", "Casey Smith");

  assert.throws(() => Core.renamePlayer(state, "p1", " "), /Enter a player name/);
  assert.throws(() => Core.renamePlayer(state, "p1", "x".repeat(49)), /48 characters or fewer/);
  assert.throws(() => Core.renamePlayer(state, "p1", " casey smith "), /already on the roster/);
  assert.throws(() => Core.renamePlayer(state, "missing", "Taylor"), /no longer on the roster/);
  assert.equal(Core.renamePlayer(state, "p1", "jOrDaN lEe").players[0].name, "jOrDaN lEe");
});

test("a player ID is required", () => {
  assert.throws(() => Core.addPlayer(Core.createEmptyState(), { id: "", name: "Jordan" }), /player ID is required/);
});

test("game dates must be real ISO calendar dates", () => {
  let state = makePlayer(Core.createEmptyState(), "p1", "Jordan Lee");

  assert.throws(() => makeGame(state, "g1", ["p1"], "2026-02-30"), /valid game date/);
  assert.throws(() => makeGame(state, "g1", ["p1"], "10/20/2026"), /valid game date/);
  assert.throws(() => makeGame(state, "g1", ["p1"], ""), /valid game date/);
});

test("a game needs at least one selected player", () => {
  const state = makePlayer(Core.createEmptyState(), "p1", "Jordan Lee");

  assert.throws(() => makeGame(state, "g1", []), /at least one player/);
});

test("a game accepts only current roster players and disallows duplicate selections", () => {
  const state = makePlayer(Core.createEmptyState(), "p1", "Jordan Lee");

  assert.throws(() => makeGame(state, "g1", ["missing"]), /current roster/);
  assert.throws(() => makeGame(state, "g1", ["p1", "p1"]), /only be selected once/);
});

test("recording a game does not mutate the previous state", () => {
  const state = makePlayer(Core.createEmptyState(), "p1", "Jordan Lee");
  const next = makeGame(state, "g1", ["p1"]);

  assert.equal(state.games.length, 0);
  assert.equal(next.games.length, 1);
  assert.deepEqual(next.games[0].playerIds, ["p1"]);
});

test("each recorded appearance contributes the configured game fee", () => {
  let state = makePlayer(Core.createEmptyState(), "p1", "Jordan Lee");
  state = makeGame(state, "g1", ["p1"]);
  state = makeGame(state, "g2", ["p1"]);
  state = makeGame(state, "g3", ["p1"]);

  assert.deepEqual(Core.getPlayerStats(state, "p1"), {
    plays: 3, paid: 0, balance: 15, balanceCents: 1500,
    gameBalance: 15, gameBalanceCents: 1500, invoiceBalance: 0, invoiceBalanceCents: 0
  });
});

test("balance severity is green at zero, red through three fees, and severe above three", () => {
  let state = makePlayer(Core.createGroupState("Dues", "5"), "p1", "Jordan Lee");
  assert.equal(Core.getBalanceSeverity(state, "p1"), "clear");

  state = makeGame(state, "g1", ["p1"]);
  assert.equal(Core.getBalanceSeverity(state, "p1"), "overdue");
  state = makeGame(state, "g2", ["p1"]);
  state = makeGame(state, "g3", ["p1"]);
  assert.equal(Core.getBalanceSeverity(state, "p1"), "overdue");
  state = makeGame(state, "g4", ["p1"]);
  assert.equal(Core.getBalanceSeverity(state, "p1"), "severe");
});

test("balance severity includes invoice balances and handles a zero default fee", () => {
  let state = makePlayer(Core.createGroupState("Dues", "5"), "p1", "Jordan Lee");
  state = makeInvoice(state, "i1", "p1", { amount: 16 });
  assert.equal(Core.getBalanceSeverity(state, "p1"), "severe");

  state = Core.setGameFee(state, 0);
  assert.equal(Core.getBalanceSeverity(state, "p1"), "overdue");
});

test("changing the game fee applies to new games without changing historic game rates", () => {
  let state = makePlayer(Core.createEmptyState(), "p1", "Jordan Lee");
  state = makeGame(state, "g1", ["p1"]);
  state = Core.setGameFee(state, 7.25);
  state = makeGame(state, "g2", ["p1"]);

  assert.deepEqual(state.games.map((game) => game.rateCents), [500, 725]);
  assert.equal(Core.getPlayerStats(state, "p1").balance, 12.25);
  assert.equal(Core.getSummary(state).gameFee, 7.25);
});

test("a game can override its fee without changing the group default or other games", () => {
  let state = makePlayer(Core.createGroupState("Thursday volleyball", "5"), "p1", "Jordan Lee");
  state = makeGame(state, "g1", ["p1"]);
  state = Core.recordGame(state, {
    id: "g2", date: GAME_DATE, playerIds: ["p1"], feeAmount: "8.25"
  });
  state = makeGame(state, "g3", ["p1"]);

  assert.deepEqual(state.games.map((game) => game.rateCents), [500, 825, 500]);
  assert.equal(state.gameFeeCents, 500);
  assert.equal(Core.getPlayerStats(state, "p1").balance, 18.25);
  assert.equal(Core.getSummary(state).gameFee, 5);
});

test("per-game fee override may be zero and rejects invalid or out-of-range amounts", () => {
  let state = makePlayer(Core.createEmptyState(), "p1", "Jordan Lee");
  state = Core.recordGame(state, { id: "free", date: GAME_DATE, playerIds: ["p1"], feeAmount: "0" });
  assert.equal(state.games[0].rateCents, 0);

  for (const feeAmount of ["nope", -0.01, 10000.01, Infinity]) {
    assert.throws(() => Core.recordGame(state, {
      id: `bad-${String(feeAmount)}`, date: GAME_DATE, playerIds: ["p1"], feeAmount
    }), /between \$0 and \$10,000/);
  }
});

test("future games are planned, do not accrue dues until their date, and keep editable team assignments", () => {
  let state = makePlayer(Core.createEmptyState(), "p1", "Jordan Lee");
  state = makePlayer(state, "p2", "Casey Smith");
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowDate = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, "0")}-${String(tomorrow.getDate()).padStart(2, "0")}`;
  state = Core.recordGame(state, {
    id: "planned",
    date: tomorrowDate,
    playerIds: ["p1", "p2"],
    teams: [
      { name: "Team 1", playerIds: ["p1"] },
      { name: "Team 2", playerIds: ["p2"] }
    ]
  });

  assert.equal(Core.getPlayerStats(state, "p1").plays, 0);
  assert.equal(Core.getPlayerStats(state, "p1").gameBalance, 0);
  assert.equal(Core.getSummary(state).games, 0);
  assert.throws(() => Core.updateGame(state, "planned", {
    date: tomorrowDate,
    playerIds: ["p1", "p2"],
    teams: [
      { name: "Team 1", playerIds: ["p1", "p2"] },
      { name: "Team 2", playerIds: ["p2"] }
    ]
  }), /exactly one team/);

  state = Core.updateGame(state, "planned", {
    date: `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}-${String(new Date().getDate()).padStart(2, "0")}`,
    playerIds: ["p1", "p2"],
    teams: [
      { name: "Team 1", playerIds: ["p2"] },
      { name: "Team 2", playerIds: ["p1"] }
    ]
  });
  assert.equal(Core.getPlayerStats(state, "p1").plays, 1);
  assert.equal(Core.getPlayerStats(state, "p1").gameBalance, 5);
  assert.equal(Core.getSummary(state).games, 1);
  assert.deepEqual(state.games[0].teams[0].playerIds, ["p2"]);
});

test("editing a previous game preserves participants who have left the roster", () => {
  let state = makePlayer(Core.createEmptyState(), "p1", "Jordan Lee");
  state = makePlayer(state, "p2", "Casey Smith");
  state = makeGame(state, "g1", ["p1", "p2"]);
  state = Core.removePlayer(state, "p1");

  state = Core.updateGame(state, "g1", {
    date: GAME_DATE,
    playerIds: ["p1", "p2"],
    teams: [
      { name: "Team 1", playerIds: ["p1"] },
      { name: "Team 2", playerIds: ["p2"] }
    ]
  });

  test("game position assignments must match participating players and supported positions", () => {
    let state = makePlayer(Core.createEmptyState(), "p1", "Jordan Lee");
    assert.throws(() => Core.recordGame(state, {
      id: "bad-position",
      date: GAME_DATE,
      playerIds: ["p1"],
      teams: [
        { name: "Team 1", playerIds: ["p1"], positions: [{ playerId: "p1", position: "Libero" }] },
        { name: "Team 2", playerIds: [] }
      ]
    }), /positions are invalid/);

    state = Core.recordGame(state, {
      id: "positioned",
      date: GAME_DATE,
      playerIds: ["p1"],
      teams: [
        { name: "Team 1", playerIds: ["p1"], positions: [{ playerId: "p1", position: "Setter" }] },
        { name: "Team 2", playerIds: [], positions: [] }
      ]
    });
    assert.equal(state.games[0].teams[0].positions[0].position, "Setter");
  });

  assert.deepEqual(state.games[0].playerIds, ["p1", "p2"]);
  assert.deepEqual(state.games[0].teams[0].playerIds, ["p1"]);
  assert.deepEqual(state.players.map((player) => player.id), ["p2"]);
});

test("player sorting supports name, total balance, and latest attendance", () => {
  let state = Core.createEmptyState();
  state = makePlayer(state, "p1", "Zoe");
  state = makePlayer(state, "p2", "Amy");
  state = makePlayer(state, "p3", "Ben");
  state = makeGame(state, "g1", ["p1"], "2026-10-18");
  state = makeGame(state, "g2", ["p2", "p3"], "2026-10-19");
  state = makeGame(state, "g3", ["p1"], "2026-10-20");

  assert.deepEqual(Core.sortPlayers(state, "name").map((player) => player.name), ["Amy", "Ben", "Zoe"]);
  assert.deepEqual(Core.sortPlayers(state, "balance").map((player) => player.name), ["Zoe", "Amy", "Ben"]);
  assert.deepEqual(Core.sortPlayers(state, "recent").map((player) => player.name), ["Zoe", "Amy", "Ben"]);
  assert.deepEqual(Core.sortPlayers(state, "unsupported").map((player) => player.name), ["Amy", "Ben", "Zoe"]);
});

test("one-click game-fee collection records no more than one default fee or the game balance", () => {
  let state = makePlayer(Core.createEmptyState(), "p1", "Jordan Lee");
  state = makeGame(state, "g1", ["p1"]);
  state = makeGame(state, "g2", ["p1"]);
  state = Core.recordGameFeePayment(state, {
    id: "pay1", playerId: "p1", date: GAME_DATE, createdAt: `${GAME_DATE}T21:00:00.000Z`
  });

  test("player payment can be allocated to a chosen invoice for any partial amount", () => {
    let state = makePlayer(Core.createEmptyState(), "p1", "Jordan Lee");
    state = makeInvoice(state, "i1", "p1", { amount: 18, name: "Tournament entry" });
    state = Core.recordPayment(state, {
      id: "pay1", playerId: "p1", invoiceId: "i1", amount: 7.5, date: GAME_DATE
    });

    assert.equal(Core.getInvoiceStats(state, "i1").paid, 7.5);
    assert.equal(Core.getInvoiceStats(state, "i1").balance, 10.5);
    assert.equal(Core.getPlayerStats(state, "p1").gameBalance, 0);
    assert.equal(Core.getPlayerStats(state, "p1").invoiceBalance, 10.5);
    assert.throws(() => Core.recordPayment(state, {
      id: "pay2", playerId: "p1", invoiceId: "i1", amount: 10.51, date: GAME_DATE
    }), /exceed the outstanding balance/);
  });
  assert.equal(state.payments[0].amount, 5);
  assert.equal(Core.getPlayerStats(state, "p1").gameBalance, 5);

  state = Core.recordGameFeePayment(state, {
    id: "pay2", playerId: "p1", date: GAME_DATE, createdAt: `${GAME_DATE}T21:05:00.000Z`
  });
  assert.equal(Core.getPlayerStats(state, "p1").gameBalance, 0);
  assert.throws(() => Core.recordGameFeePayment(state, {
    id: "pay3", playerId: "p1", date: GAME_DATE, createdAt: `${GAME_DATE}T21:10:00.000Z`
  }), /no game fee to collect/);
});

test("game fee can be zero and rejects invalid or out-of-range values", () => {
  assert.equal(Core.setGameFee(Core.createEmptyState(), 0).gameFeeCents, 0);
  for (const amount of ["", -0.01, 10000.01, NaN, Infinity, "fee"]) {
    assert.throws(() => Core.setGameFee(Core.createEmptyState(), amount), /between \$0 and \$10,000/);
  }
});

test("payments accept positive cent values and are normalized to cents", () => {
  let state = makePlayer(Core.createEmptyState(), "p1", "Jordan Lee");
  state = makeGame(state, "g1", ["p1"]);
  state = makePayment(state, "pay1", "p1", 2.345);

  assert.equal(state.payments[0].amount, 2.35);
  assert.equal(Core.getPlayerStats(state, "p1").balance, 2.65);
});

test("zero, negative, and non-numeric payments are rejected", () => {
  let state = makePlayer(Core.createEmptyState(), "p1", "Jordan Lee");
  state = makeGame(state, "g1", ["p1"]);

  for (const amount of [0, -1, NaN, Infinity, "not-money"]) {
    assert.throws(() => makePayment(state, `pay-${String(amount)}`, "p1", amount), /payment greater than \$0/);
  }
});

test("payments cannot exceed the outstanding balance, even by a fraction of a cent", () => {
  let state = makePlayer(Core.createEmptyState(), "p1", "Jordan Lee");
  state = makeGame(state, "g1", ["p1"]);
  state = makePayment(state, "pay1", "p1", 4.99);

  assert.throws(() => makePayment(state, "pay2", "p1", 0.02), /exceed the outstanding balance/);
  assert.throws(() => makePayment(state, "pay2", "p1", 0.015), /exceed the outstanding balance/);
  assert.equal(state.payments.length, 1);
});

test("payments require a roster player and a valid date", () => {
  const state = makePlayer(Core.createEmptyState(), "p1", "Jordan Lee");

  assert.throws(() => makePayment(state, "pay1", "missing", 1), /current roster/);
  state.games.push({ id: "g1", date: GAME_DATE, playerIds: ["p1"] });
  assert.throws(() => makePayment(state, "pay1", "p1", 1, "2026-13-01"), /valid payment date/);
});

test("payment corrections preserve identity while changing the player, amount, and date", () => {
  let state = makePlayer(Core.createEmptyState(), "p1", "Jordan Lee");
  state = makePlayer(state, "p2", "Casey Smith");
  state = makeGame(state, "g1", ["p1", "p2"]);
  state = makePayment(state, "pay1", "p1", 2, GAME_DATE);
  const originalCreatedAt = state.payments[0].createdAt;

  const corrected = Core.updatePayment(state, "pay1", {
    playerId: "p2", amount: 4, date: "2026-11-02"
  });

  assert.deepEqual(corrected.payments[0], {
    ...state.payments[0], playerId: "p2", amount: 4, date: "2026-11-02"
  });
  assert.equal(corrected.payments[0].id, "pay1");
  assert.equal(corrected.payments[0].createdAt, originalCreatedAt);
  assert.equal(Core.getPlayerStats(corrected, "p1").gameBalance, 5);
  assert.equal(Core.getPlayerStats(corrected, "p2").gameBalance, 1);
  assert.equal(Core.getPlayerStats(state, "p1").gameBalance, 3);
});

test("payment corrections can change allocation between game dues and an invoice", () => {
  let state = makePlayer(Core.createEmptyState(), "p1", "Jordan Lee");
  state = makeGame(state, "g1", ["p1"]);
  state = makeInvoice(state, "i1", "p1", { amount: 12 });
  state = makePayment(state, "pay1", "p1", 3, GAME_DATE);

  state = Core.updatePayment(state, "pay1", {
    playerId: "p1", amount: 8, date: "2026-11-02", invoiceId: "i1"
  });
  assert.equal(state.payments[0].invoiceId, "i1");
  assert.equal(Core.getPlayerStats(state, "p1").gameBalance, 5);
  assert.equal(Core.getInvoiceStats(state, "i1").balance, 4);

  assert.throws(() => Core.updatePayment(state, "pay1", {
    playerId: "p1", amount: 12.01, date: GAME_DATE, invoiceId: "i1"
  }), /exceed the outstanding balance/);
  assert.throws(() => Core.updatePayment(state, "pay1", {
    playerId: "p1", amount: 1, date: GAME_DATE, invoiceId: "missing"
  }), /invoice belonging to this player/);
});

test("payment correction allows retaining a former player but rejects reassignment to another former player", () => {
  let state = makePlayer(Core.createEmptyState(), "p1", "Jordan Lee");
  state = makePlayer(state, "p2", "Casey Smith");
  state = makeGame(state, "g1", ["p1", "p2"]);
  state = makePayment(state, "pay1", "p1", 2);
  state = Core.removePlayer(state, "p1");

  const corrected = Core.updatePayment(state, "pay1", {
    playerId: "p1", amount: 3, date: GAME_DATE
  });
  assert.equal(corrected.payments[0].amount, 3);
  assert.throws(() => Core.updatePayment(state, "pay1", {
    playerId: "p3", amount: 1, date: GAME_DATE
  }), /current roster/);
  assert.throws(() => Core.updatePayment(state, "pay1", {
    playerId: "p1", amount: 1, date: "2026-02-30"
  }), /valid payment date/);
});

test("deleting a payment restores its balance and unknown payment IDs are rejected", () => {
  let state = makePlayer(Core.createEmptyState(), "p1", "Jordan Lee");
  state = makeGame(state, "g1", ["p1"]);
  state = makePayment(state, "pay1", "p1", 2);

  const deleted = Core.removePayment(state, "pay1");
  assert.equal(deleted.payments.length, 0);
  assert.equal(Core.getPlayerStats(deleted, "p1").gameBalance, 5);
  assert.equal(state.payments.length, 1);
  assert.throws(() => Core.removePayment(state, "missing"), /could not be found/);
});

test("summary aggregates collection, outstanding balances, roster, games, and payments", () => {
  let state = Core.createEmptyState();
  state = makePlayer(state, "p1", "Jordan Lee");
  state = makePlayer(state, "p2", "Casey Smith");
  state = makeGame(state, "g1", ["p1", "p2"]);
  state = makeGame(state, "g2", ["p1"]);
  state = makePayment(state, "pay1", "p1", 7.5);
  state = makePayment(state, "pay2", "p2", 5);

  assert.deepEqual(Core.getSummary(state), {
    collected: 12.5, owed: 2.5, players: 2, games: 2, payments: 2, invoices: 0, gameFee: 5
  });
});

test("invoices require a roster player, name, type, description, positive amount, and valid dates", () => {
  const state = makePlayer(Core.createEmptyState(), "p1", "Jordan Lee");

  assert.throws(() => makeInvoice(state, "i1", "missing"), /current roster/);
  assert.throws(() => makeInvoice(state, "i1", "p1", { name: " " }), /invoice name/);
  assert.throws(() => makeInvoice(state, "i1", "p1", { category: "" }), /invoice type/);
  assert.throws(() => makeInvoice(state, "i1", "p1", { description: " " }), /description/);
  assert.throws(() => makeInvoice(state, "i1", "p1", { dueDate: "2026-02-30" }), /valid due date/);
  assert.throws(() => makeInvoice(state, "i1", "p1", { amount: 0 }), /invoice amount/);
});

test("invoice details are trimmed and its amount is added to the player balance", () => {
  let state = makePlayer(Core.createEmptyState(), "p1", "Jordan Lee");
  state = makeGame(state, "g1", ["p1"]);
  state = makeInvoice(state, "i1", "p1", {
    name: " Tournament entry ", description: " Regional bracket fee ", amount: 35.5
  });

  assert.equal(state.invoices[0].name, "Tournament entry");
  assert.equal(state.invoices[0].description, "Regional bracket fee");
  assert.deepEqual(Core.getInvoiceStats(state, "i1"), { paid: 0, balance: 35.5, balanceCents: 3550 });
  assert.equal(Core.getPlayerStats(state, "p1").balance, 40.5);
});

test("invoice payments apply only to the selected invoice", () => {
  let state = makePlayer(Core.createEmptyState(), "p1", "Jordan Lee");
  state = makeGame(state, "g1", ["p1"]);
  state = makeInvoice(state, "i1", "p1", { amount: 12 });
  state = makeInvoice(state, "i2", "p1", { amount: 8, name: "Equipment" });
  state = makeInvoicePayment(state, "pay1", "p1", "i1", 5);

  assert.equal(Core.getInvoiceStats(state, "i1").balance, 7);
  assert.equal(Core.getInvoiceStats(state, "i2").balance, 8);
  assert.equal(Core.getPlayerStats(state, "p1").gameBalance, 5);
  assert.equal(Core.getPlayerStats(state, "p1").balance, 20);
});

test("invoice payments require the correct player and cannot exceed the invoice balance", () => {
  let state = makePlayer(Core.createEmptyState(), "p1", "Jordan Lee");
  state = makePlayer(state, "p2", "Casey Smith");
  state = makeInvoice(state, "i1", "p1", { amount: 10 });

  assert.throws(() => makeInvoicePayment(state, "pay1", "p2", "i1", 1), /belonging to this player/);
  assert.throws(() => makeInvoicePayment(state, "pay1", "p1", "i1", 10.01), /outstanding balance/);
  assert.equal(state.payments.length, 0);
});

test("ordinary game-dues payments do not reduce invoice balances", () => {
  let state = makePlayer(Core.createEmptyState(), "p1", "Jordan Lee");
  state = makeGame(state, "g1", ["p1"]);
  state = makeInvoice(state, "i1", "p1", { amount: 10 });
  state = makePayment(state, "pay1", "p1", 5);

  assert.equal(Core.getPlayerStats(state, "p1").balance, 10);
  assert.equal(Core.getInvoiceStats(state, "i1").balance, 10);
});

test("removing a player preserves their historical games and payments", () => {
  let state = makePlayer(Core.createEmptyState(), "p1", "Jordan Lee");
  state = makeGame(state, "g1", ["p1"]);
  state = makePayment(state, "pay1", "p1", 2);
  const removed = Core.removePlayer(state, "p1");

  assert.equal(removed.players.length, 0);
  assert.equal(removed.games[0].playerIds[0], "p1");
  assert.equal(removed.payments[0].playerId, "p1");
  assert.equal(state.players.length, 1);
});

test("removing an unknown player is a no-op", () => {
  const state = Core.createEmptyState();

  assert.strictEqual(Core.removePlayer(state, "missing"), state);
});

test("an invoice remains payable and included in total owed after its player leaves the roster", () => {
  let state = makePlayer(Core.createEmptyState(), "p1", "Jordan Lee");
  state = makeInvoice(state, "i1", "p1", { amount: 12 });
  state = Core.removePlayer(state, "p1");
  assert.equal(Core.getSummary(state).owed, 12);

  state = makeInvoicePayment(state, "pay1", "p1", "i1", 12);
  assert.equal(Core.getInvoiceStats(state, "i1").balance, 0);
  assert.equal(Core.getSummary(state).owed, 0);
});

test("activity is sorted newest first and leaves source records intact", () => {
  let state = makePlayer(Core.createEmptyState(), "p1", "Jordan Lee");
  state = makeGame(state, "g1", ["p1"], "2026-10-18");
  state = makeGame(state, "g2", ["p1"], "2026-10-20");
  state = makePayment(state, "pay1", "p1", 1, "2026-10-19");
  state = makeInvoice(state, "i1", "p1", {
    amount: 1, date: "2026-10-20", createdAt: "2026-10-20T22:00:00.000Z"
  });
  const entries = Core.getActivityEntries(state);

  assert.deepEqual(entries.map((entry) => entry.id), ["i1", "g2", "pay1", "g1"]);
  assert.equal(state.games[0].type, undefined);
});

test("roster changes are retained in the activity feed with names and newest-first ordering", () => {
  let state = Core.addPlayer(Core.createEmptyState(), { id: "p1", name: "Jordan Lee" });
  state = Core.recordRosterActivity(state, {
    id: "a1", action: "added", playerId: "p1", playerName: "Jordan Lee",
    date: "2026-10-18", createdAt: "2026-10-18T18:00:00.000Z"
  });
  state = Core.renamePlayer(state, "p1", "Jordan Rivera");
  state = Core.recordRosterActivity(state, {
    id: "a2", action: "renamed", playerId: "p1", playerName: "Jordan Rivera",
    previousName: "Jordan Lee", date: "2026-10-20", createdAt: "2026-10-20T18:00:00.000Z"
  });
  const entries = Core.getActivityEntries(state);

  assert.deepEqual(entries.map((entry) => entry.id), ["a2", "a1"]);
  assert.equal(entries[0].type, "roster");
  assert.equal(entries[0].previousName, "Jordan Lee");
  assert.equal(state.players[0].name, "Jordan Rivera");
});

test("state validation rejects malformed roster, games, payments, and duplicate IDs", () => {
  const invalidStates = [
    null,
    { players: {}, games: [], payments: [], invoices: [], gameFeeCents: 500 },
    { players: [{ id: "", name: "Jordan" }], games: [], payments: [] },
    { players: [], games: [{ id: "g1", date: "2026-02-30", playerIds: [] }], payments: [] },
    { players: [], games: [], payments: [{ id: "pay1", playerId: "p1", date: GAME_DATE, amount: -1 }], invoices: [], gameFeeCents: 500 },
    { players: [{ id: "same", name: "Jordan" }], games: [{ id: "same", date: GAME_DATE, playerIds: [] }], payments: [] }
  ];

  invalidStates.forEach((state) => assert.throws(() => Core.validateState(state)));
});

test("state validation rejects orphaned invoice payments and duplicate invoice IDs", () => {
  const base = makePlayer(Core.createEmptyState(), "p1", "Jordan Lee");
  const invoice = makeInvoice(base, "i1", "p1").invoices[0];
  const orphanPayment = {
    id: "pay1", playerId: "p1", invoiceId: "missing", amount: 1, date: GAME_DATE
  };
  const duplicateInvoice = { ...invoice, id: "p1" };

  assert.throws(() => Core.validateState({ ...base, payments: [orphanPayment] }), /invalid invoice/);
  assert.throws(() => Core.validateState({ ...base, invoices: [invoice, duplicateInvoice] }), /duplicate IDs/);
});

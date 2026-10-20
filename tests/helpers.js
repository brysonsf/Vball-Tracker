const Core = require("../tracker-core.js");

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
    values
  };
}

module.exports = {
  Core, GAME_DATE, makePlayer, makeGame, makePayment, makeInvoice, makeInvoicePayment, makeStorage
};

(() => {
  const DEFAULT_RATE_CENTS = 500;

  function createEmptyState() {
    return { gameFeeCents: DEFAULT_RATE_CENTS, players: [], games: [], payments: [], invoices: [] };
  }

  function isValidDate(value) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
  }

  function validateState(state) {
    if (!state || !Array.isArray(state.players) || !Array.isArray(state.games) ||
      !Array.isArray(state.payments) || !Array.isArray(state.invoices) ||
      !Number.isInteger(state.gameFeeCents) || state.gameFeeCents < 0 || state.gameFeeCents > 1000000) {
      throw new Error("Saved tracker data has an unexpected format.");
    }

    const ids = new Set();
    for (const player of state.players) {
      if (!player || typeof player.id !== "string" || !player.id || typeof player.name !== "string" || !player.name.trim()) {
        throw new Error("Saved tracker data contains an invalid player.");
      }
      if (ids.has(player.id)) throw new Error("Saved tracker data contains duplicate IDs.");
      ids.add(player.id);
    }

    for (const game of state.games) {
      if (!game || typeof game.id !== "string" || !game.id || !isValidDate(game.date) ||
        !Array.isArray(game.playerIds) || game.playerIds.some((id) => typeof id !== "string") ||
        !Number.isInteger(game.rateCents) || game.rateCents < 0 || game.rateCents > 1000000) {
        throw new Error("Saved tracker data contains an invalid game.");
      }
      if (ids.has(game.id)) throw new Error("Saved tracker data contains duplicate IDs.");
      ids.add(game.id);
    }

    for (const payment of state.payments) {
      if (!payment || typeof payment.id !== "string" || !payment.id || typeof payment.playerId !== "string" ||
        !isValidDate(payment.date) || !Number.isFinite(payment.amount) || payment.amount <= 0 ||
        (payment.invoiceId !== undefined && payment.invoiceId !== null && typeof payment.invoiceId !== "string")) {
        throw new Error("Saved tracker data contains an invalid payment.");
      }
      if (ids.has(payment.id)) throw new Error("Saved tracker data contains duplicate IDs.");
      ids.add(payment.id);
    }

    for (const invoice of state.invoices) {
      if (!invoice || typeof invoice.id !== "string" || !invoice.id || typeof invoice.playerId !== "string" ||
        typeof invoice.playerName !== "string" || !invoice.playerName.trim() ||
        typeof invoice.name !== "string" || !invoice.name.trim() ||
        typeof invoice.category !== "string" || !invoice.category.trim() ||
        typeof invoice.description !== "string" || !invoice.description.trim() ||
        !isValidDate(invoice.dueDate) || !isValidDate(invoice.date) ||
        !Number.isInteger(invoice.amountCents) || invoice.amountCents <= 0 || invoice.amountCents > 100000000) {
        throw new Error("Saved tracker data contains an invalid invoice.");
      }
      if (ids.has(invoice.id)) throw new Error("Saved tracker data contains duplicate IDs.");
      ids.add(invoice.id);
    }

    for (const payment of state.payments) {
      if (!payment.invoiceId) continue;
      const invoice = state.invoices.find((entry) => entry.id === payment.invoiceId);
      if (!invoice || invoice.playerId !== payment.playerId) {
        throw new Error("Saved tracker data contains a payment for an invalid invoice.");
      }
    }

    return state;
  }

  function loadState(storage, key) {
    const raw = storage.getItem(key);
    if (raw === null) return createEmptyState();
    const state = JSON.parse(raw);
    if (!state || !Array.isArray(state.players) || !Array.isArray(state.games) || !Array.isArray(state.payments)) {
      throw new Error("Saved tracker data has an unexpected format.");
    }
    state.gameFeeCents = state.gameFeeCents === undefined ? DEFAULT_RATE_CENTS : state.gameFeeCents;
    state.invoices = state.invoices === undefined ? [] : state.invoices;
    state.games.forEach((game) => {
      if (game.rateCents === undefined) game.rateCents = DEFAULT_RATE_CENTS;
    });
    return validateState(state);
  }

  function saveState(state, storage, key) {
    validateState(state);
    storage.setItem(key, JSON.stringify(state));
  }

  function getPlayerStats(state, playerId) {
    const playerGames = state.games.filter((game) => game.playerIds.includes(playerId));
    const gameDueCents = playerGames.reduce((sum, game) => sum + game.rateCents, 0);
    const invoices = state.invoices.filter((invoice) => invoice.playerId === playerId);
    const invoiceDueCents = invoices.reduce((sum, invoice) => sum + getInvoiceStats(state, invoice.id).balanceCents, 0);
    const paidCents = state.payments.filter((payment) => !payment.invoiceId)
      .filter((payment) => payment.playerId === playerId)
      .reduce((sum, payment) => sum + Math.round(payment.amount * 100), 0);
    const gameBalanceCents = gameDueCents - paidCents;
    const totalPaidCents = state.payments
      .filter((payment) => payment.playerId === playerId)
      .reduce((sum, payment) => sum + Math.round(payment.amount * 100), 0);
    const balanceCents = gameBalanceCents + invoiceDueCents;
    return {
      plays: playerGames.length,
      paid: totalPaidCents / 100,
      balance: balanceCents / 100,
      balanceCents,
      gameBalance: gameBalanceCents / 100,
      gameBalanceCents,
      invoiceBalance: invoiceDueCents / 100,
      invoiceBalanceCents: invoiceDueCents
    };
  }

  function getInvoiceStats(state, invoiceId) {
    const invoice = state.invoices.find((entry) => entry.id === invoiceId);
    if (!invoice) throw new Error("Invoice was not found.");
    const paidCents = state.payments
      .filter((payment) => payment.invoiceId === invoiceId)
      .reduce((sum, payment) => sum + Math.round(payment.amount * 100), 0);
    const balanceCents = invoice.amountCents - paidCents;
    return { paid: paidCents / 100, balance: balanceCents / 100, balanceCents };
  }

  function getSummary(state) {
    const collectedCents = state.payments.reduce((sum, payment) => sum + Math.round(payment.amount * 100), 0);
    const gameOwedCents = state.players.reduce((sum, player) => sum + getPlayerStats(state, player.id).gameBalanceCents, 0);
    const invoiceOwedCents = state.invoices.reduce((sum, invoice) => sum + getInvoiceStats(state, invoice.id).balanceCents, 0);
    const owedCents = gameOwedCents + invoiceOwedCents;
    return {
      collected: collectedCents / 100,
      owed: owedCents / 100,
      players: state.players.length,
      games: state.games.length,
      payments: state.payments.length,
      invoices: state.invoices.length,
      gameFee: state.gameFeeCents / 100
    };
  }

  function setGameFee(state, amount) {
    const feeCents = Math.round(Number(amount) * 100);
    if (typeof amount === "string" && !amount.trim() || !Number.isFinite(Number(amount)) || feeCents < 0 || feeCents > 1000000) {
      throw new Error("Set a game fee between $0 and $10,000.");
    }
    return { ...state, gameFeeCents: feeCents };
  }

  function addPlayer(state, { id, name }) {
    if (typeof name !== "string" || !name.trim()) throw new Error("Enter a player name.");
    const trimmedName = name.trim();
    if (state.players.some((player) => player.name.toLocaleLowerCase() === trimmedName.toLocaleLowerCase())) {
      throw new Error("That player is already on the roster.");
    }
    if (typeof id !== "string" || !id) throw new Error("A player ID is required.");
    return { ...state, players: [...state.players, { id, name: trimmedName }] };
  }

  function recordGame(state, { id, date, playerIds, createdAt }) {
    if (!isValidDate(date)) throw new Error("Choose a valid game date.");
    if (!Array.isArray(playerIds) || playerIds.length === 0) throw new Error("Select at least one player who played.");
    if (new Set(playerIds).size !== playerIds.length) throw new Error("A player can only be selected once per game.");
    const playerIdsInRoster = new Set(state.players.map((player) => player.id));
    if (playerIds.some((playerId) => !playerIdsInRoster.has(playerId))) throw new Error("Select players from the current roster.");
    if (typeof id !== "string" || !id) throw new Error("A game ID is required.");
    return {
      ...state,
      games: [...state.games, { id, date, playerIds: [...playerIds], rateCents: state.gameFeeCents, createdAt }]
    };
  }

  function createInvoice(state, { id, playerId, name, category, description, amount, dueDate, date, createdAt }) {
    if (!state.players.some((player) => player.id === playerId)) throw new Error("Choose a player on the current roster.");
    if (typeof name !== "string" || !name.trim()) throw new Error("Enter an invoice name.");
    if (typeof category !== "string" || !category.trim()) throw new Error("Choose an invoice type.");
    if (typeof description !== "string" || !description.trim()) throw new Error("Enter a description for this charge.");
    if (!isValidDate(dueDate)) throw new Error("Choose a valid due date.");
    if (!isValidDate(date)) throw new Error("Choose a valid invoice date.");
    const amountCents = Math.round(Number(amount) * 100);
    if (!Number.isFinite(Number(amount)) || amountCents <= 0 || amountCents > 100000000) {
      throw new Error("Enter an invoice amount greater than $0 and no more than $1,000,000.");
    }
    if (typeof id !== "string" || !id) throw new Error("An invoice ID is required.");
    const player = state.players.find((entry) => entry.id === playerId);
    const invoice = {
      id, playerId, playerName: player.name, name: name.trim(), category: category.trim(),
      description: description.trim(), amountCents, dueDate, date, createdAt
    };
    return { ...state, invoices: [...state.invoices, invoice] };
  }

  function recordPayment(state, { id, playerId, amount, date, invoiceId, createdAt }) {
    const invoice = invoiceId && state.invoices.find((entry) => entry.id === invoiceId);
    if (invoiceId && invoice?.playerId !== playerId) {
      throw new Error("Choose an invoice belonging to this player.");
    }
    if (!invoiceId && !state.players.some((player) => player.id === playerId)) {
      throw new Error("Choose a player on the current roster.");
    }
    const amountCents = Math.round(Number(amount) * 100);
    if (!Number.isFinite(Number(amount)) || amountCents <= 0) throw new Error("Enter a payment greater than $0.");
    const targetBalanceCents = invoiceId
      ? getInvoiceStats(state, invoiceId).balanceCents
      : getPlayerStats(state, playerId).gameBalanceCents;
    if (amountCents > targetBalanceCents) throw new Error("Payment can't exceed the outstanding balance.");
    if (!isValidDate(date)) throw new Error("Choose a valid payment date.");
    if (typeof id !== "string" || !id) throw new Error("A payment ID is required.");
    const payment = { id, playerId, amount: amountCents / 100, date, invoiceId: invoiceId || null, createdAt };
    return { ...state, payments: [...state.payments, payment] };
  }

  function removePlayer(state, playerId) {
    if (!state.players.some((player) => player.id === playerId)) return state;
    return { ...state, players: state.players.filter((player) => player.id !== playerId) };
  }

  function getActivityEntries(state) {
    return [
      ...state.games.map((game) => ({ ...game, type: "game", sortDate: game.createdAt || `${game.date}T12:00:00` })),
      ...state.invoices.map((invoice) => ({ ...invoice, type: "invoice", sortDate: invoice.createdAt || `${invoice.date}T12:00:00` })),
      ...state.payments.map((payment) => ({ ...payment, type: "payment", sortDate: payment.createdAt || `${payment.date}T12:00:00` }))
    ].sort((a, b) => b.sortDate.localeCompare(a.sortDate));
  }

  const api = {
    DEFAULT_RATE_CENTS,
    createEmptyState,
    validateState,
    loadState,
    saveState,
    getPlayerStats,
    getInvoiceStats,
    getSummary,
    addPlayer,
    setGameFee,
    recordGame,
    createInvoice,
    recordPayment,
    removePlayer,
    getActivityEntries
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof globalThis !== "undefined") globalThis.SideoutCore = api;
})();

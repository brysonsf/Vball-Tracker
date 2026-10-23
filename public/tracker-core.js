(() => {
  const DEFAULT_RATE_CENTS = 500;
  const DEFAULT_GROUP_NAME = "Wednesday night";
  const GAME_POSITIONS = ["Setter", "Left", "Right", "Middle"];

  function createEmptyState() {
    return {
      groupName: DEFAULT_GROUP_NAME,
      gameFeeCents: DEFAULT_RATE_CENTS,
      players: [],
      games: [],
      payments: [],
      invoices: [],
      rosterActivity: []
    };
  }

  function isValidDate(value) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
  }

  function currentDate() {
    const date = new Date();
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }

  function validateGameTeams(playerIds, teams) {
    if (!Array.isArray(teams)) throw new Error("Game teams must be a list.");
    const assignedPlayers = new Set();
    for (const team of teams) {
      if (!team || typeof team.name !== "string" || !team.name.trim() ||
        !Array.isArray(team.playerIds) || team.playerIds.some((id) => typeof id !== "string")) {
        throw new Error("Game team details are invalid.");
      }
      if (team.positions !== undefined &&
        (!Array.isArray(team.positions) ||
          team.positions.some((slot) => !slot || !GAME_POSITIONS.includes(slot.position) ||
            typeof slot.playerId !== "string" || !team.playerIds.includes(slot.playerId)))) {
        throw new Error("Game team positions are invalid.");
      }
      if (team.positions) {
        const positionPlayerIds = team.positions.map((slot) => slot.playerId);
        if (new Set(positionPlayerIds).size !== positionPlayerIds.length) {
          throw new Error("Each player can have only one position per team.");
        }
      }
      for (const playerId of team.playerIds) {
        if (!playerIds.includes(playerId) || assignedPlayers.has(playerId)) {
          throw new Error("Assign each participating player to exactly one team.");
        }
        assignedPlayers.add(playerId);
      }
    }
    if (teams.length && assignedPlayers.size !== playerIds.length) {
      throw new Error("Assign each participating player to exactly one team.");
    }
  }

  function createId(cryptoApi) {
    const bytes = new Uint8Array(16);
    if (cryptoApi && typeof cryptoApi.getRandomValues === "function") {
      cryptoApi.getRandomValues(bytes);
    } else {
      for (let index = 0; index < bytes.length; index += 1) {
        bytes[index] = Math.floor(Math.random() * 256);
      }
    }
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0"));
    return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10).join("")}`;
  }

  function validateState(state) {
    if (!state || !Array.isArray(state.players) || !Array.isArray(state.games) ||
      !Array.isArray(state.payments) || !Array.isArray(state.invoices) || !Array.isArray(state.rosterActivity) ||
      typeof state.groupName !== "string" || !state.groupName.trim() || state.groupName.length > 60 ||
      !Number.isInteger(state.gameFeeCents) || state.gameFeeCents < 0 || state.gameFeeCents > 1000000) {
      throw new Error("Saved tracker data has an unexpected format.");
    }

    const ids = new Set();
    for (const player of state.players) {
      if (!player || typeof player.id !== "string" || !player.id || typeof player.name !== "string" || !player.name.trim()) {
        throw new Error("Saved tracker data contains an invalid player.");
      }
      if ((player.primaryPosition !== undefined && player.primaryPosition !== null &&
          !GAME_POSITIONS.includes(player.primaryPosition)) ||
        (player.secondaryPosition !== undefined && player.secondaryPosition !== null &&
          !GAME_POSITIONS.includes(player.secondaryPosition)) ||
        (player.primaryPosition && player.primaryPosition === player.secondaryPosition)) {
        throw new Error("Saved tracker data contains invalid player positions.");
      }
      if (ids.has(player.id)) throw new Error("Saved tracker data contains duplicate IDs.");
      ids.add(player.id);
    }

    for (const game of state.games) {
      if (!game || typeof game.id !== "string" || !game.id || !isValidDate(game.date) ||
        !Array.isArray(game.playerIds) || game.playerIds.some((id) => typeof id !== "string") ||
        new Set(game.playerIds).size !== game.playerIds.length ||
        !Number.isInteger(game.rateCents) || game.rateCents < 0 || game.rateCents > 1000000 ||
        (game.teams !== undefined && !Array.isArray(game.teams))) {
        throw new Error("Saved tracker data contains an invalid game.");
      }
      if (game.teams) validateGameTeams(game.playerIds, game.teams);
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

    for (const activity of state.rosterActivity) {
      if (!activity || typeof activity.id !== "string" || !activity.id ||
        !["added", "renamed", "removed"].includes(activity.action) ||
        typeof activity.playerId !== "string" || !activity.playerId ||
        typeof activity.playerName !== "string" || !activity.playerName.trim() ||
        !isValidDate(activity.date) ||
        (activity.action === "renamed" &&
          (typeof activity.previousName !== "string" || !activity.previousName.trim()))) {
        throw new Error("Saved tracker data contains invalid roster activity.");
      }
      if (ids.has(activity.id)) throw new Error("Saved tracker data contains duplicate IDs.");
      ids.add(activity.id);
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

  function migrateState(savedState) {
    let state = savedState;
    if (!state || !Array.isArray(state.players) || !Array.isArray(state.games) || !Array.isArray(state.payments)) {
      throw new Error("Saved tracker data has an unexpected format.");
    }
    if (state.invoices !== undefined && !Array.isArray(state.invoices)) {
      throw new Error("Saved tracker data has an unexpected format.");
    }
    if (state.rosterActivity !== undefined && !Array.isArray(state.rosterActivity)) {
      throw new Error("Saved tracker data has an unexpected format.");
    }
    state = {
      ...state,
      players: state.players.map((player) => {
        if (!player || typeof player !== "object") return player;
        if (player.positions !== undefined &&
          (!Array.isArray(player.positions) || player.positions.some((position) => !GAME_POSITIONS.includes(position)) ||
            new Set(player.positions).size !== player.positions.length)) {
          throw new Error("Saved tracker data contains invalid player positions.");
        }
        const legacyPositions = player.positions || [];
        const migratedPlayer = { ...player };
        delete migratedPlayer.positions;
        return {
          ...migratedPlayer,
          primaryPosition: player.primaryPosition ?? legacyPositions[0] ?? null,
          secondaryPosition: player.secondaryPosition ?? legacyPositions.find((position) =>
            position !== (player.primaryPosition ?? legacyPositions[0])) ?? null
        };
      }),
      games: state.games.map((game) => ({ ...game })),
      invoices: Array.isArray(state.invoices) ? state.invoices.map((invoice) => ({ ...invoice })) : state.invoices,
      rosterActivity: Array.isArray(state.rosterActivity) ? state.rosterActivity.map((activity) => ({ ...activity })) : []
    };
    state.gameFeeCents = state.gameFeeCents === undefined ? DEFAULT_RATE_CENTS : state.gameFeeCents;
    state.groupName = state.groupName === undefined ? DEFAULT_GROUP_NAME : state.groupName;
    state.invoices = state.invoices === undefined ? [] : state.invoices;
    state.games.forEach((game) => {
      if (game.rateCents === undefined) game.rateCents = DEFAULT_RATE_CENTS;
      if (game.teams === undefined) game.teams = [];
    });
    state.invoices.forEach((invoice) => {
      if (invoice.playerName === undefined) {
        invoice.playerName = state.players.find((player) => player.id === invoice.playerId)?.name || "Former player";
      }
    });
    return validateState(state);
  }

  function loadState(storage, key) {
    const raw = storage.getItem(key);
    if (raw === null) return createEmptyState();
    return migrateState(JSON.parse(raw));
  }

  function saveState(state, storage, key) {
    validateState(state);
    storage.setItem(key, JSON.stringify(state));
  }

  function getPlayerStats(state, playerId) {
    const playerGames = state.games.filter((game) => game.date <= currentDate() && game.playerIds.includes(playerId));
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
      games: state.games.filter((game) => game.date <= currentDate()).length,
      payments: state.payments.length,
      invoices: state.invoices.length,
      gameFee: state.gameFeeCents / 100
    };
  }

  function getBalanceSeverity(state, playerId) {
    const balanceCents = getPlayerStats(state, playerId).balanceCents;
    if (balanceCents <= 0) return "clear";
    if (state.gameFeeCents <= 0 || balanceCents <= state.gameFeeCents * 3) return "overdue";
    return "severe";
  }

  function setGameFee(state, amount) {
    const feeCents = Math.round(Number(amount) * 100);
    if (typeof amount === "string" && !amount.trim() || !Number.isFinite(Number(amount)) || feeCents < 0 || feeCents > 1000000) {
      throw new Error("Set a game fee between $0 and $10,000.");
    }
    return { ...state, gameFeeCents: feeCents };
  }

  function setGroupName(state, name) {
    if (typeof name !== "string" || !name.trim()) throw new Error("Enter a group name.");
    const trimmedName = name.trim();
    if (trimmedName.length > 60) throw new Error("Group names must be 60 characters or fewer.");
    return { ...state, groupName: trimmedName };
  }

  function createGroupState(name, defaultFee) {
    return setGameFee(setGroupName(createEmptyState(), name), defaultFee);
  }

  function validatePlayerPositions(primaryPosition, secondaryPosition) {
    if ((primaryPosition !== undefined && primaryPosition !== null && primaryPosition !== "" &&
        !GAME_POSITIONS.includes(primaryPosition)) ||
      (secondaryPosition !== undefined && secondaryPosition !== null && secondaryPosition !== "" &&
        !GAME_POSITIONS.includes(secondaryPosition)) ||
      (primaryPosition && primaryPosition === secondaryPosition)) {
      throw new Error("Choose different primary and secondary positions.");
    }
    return {
      primaryPosition: primaryPosition || null,
      secondaryPosition: secondaryPosition || null
    };
  }

  function getPreferredPosition(state, playerId) {
    const player = state.players.find((entry) => entry.id === playerId);
    return player?.primaryPosition || player?.secondaryPosition || "";
  }

  function addPlayer(state, { id, name, primaryPosition, secondaryPosition }) {
    if (typeof name !== "string" || !name.trim()) throw new Error("Enter a player name.");
    const trimmedName = name.trim();
    if (trimmedName.length > 48) throw new Error("Player names must be 48 characters or fewer.");
    if (state.players.some((player) => player.name.toLocaleLowerCase() === trimmedName.toLocaleLowerCase())) {
      throw new Error("That player is already on the roster.");
    }
    if (typeof id !== "string" || !id) throw new Error("A player ID is required.");
    const positions = validatePlayerPositions(primaryPosition, secondaryPosition);
    return {
      ...state,
      players: [...state.players, { id, name: trimmedName, ...positions }]
    };
  }

  function renamePlayer(state, playerId, name, positions) {
    const player = state.players.find((entry) => entry.id === playerId);
    if (!player) throw new Error("That player is no longer on the roster.");
    if (typeof name !== "string" || !name.trim()) throw new Error("Enter a player name.");
    const trimmedName = name.trim();
    if (trimmedName.length > 48) throw new Error("Player names must be 48 characters or fewer.");
    if (state.players.some((entry) => entry.id !== playerId &&
      entry.name.toLocaleLowerCase() === trimmedName.toLocaleLowerCase())) {
      throw new Error("That player is already on the roster.");
    }
    const updatedPositions = validatePlayerPositions(
      positions === undefined ? player.primaryPosition : positions.primaryPosition,
      positions === undefined ? player.secondaryPosition : positions.secondaryPosition
    );
    return {
      ...state,
      players: state.players.map((entry) => entry.id === playerId
        ? { ...entry, name: trimmedName, ...updatedPositions }
        : entry),
      invoices: state.invoices.map((invoice) => invoice.playerId === playerId
        ? { ...invoice, playerName: trimmedName }
        : invoice)
    };
  }

  function recordGame(state, { id, date, playerIds, feeAmount, createdAt, teams = [] }) {
    if (!isValidDate(date)) throw new Error("Choose a valid game date.");
    if (!Array.isArray(playerIds) || (playerIds.length === 0 && date <= currentDate())) {
      throw new Error("Select at least one player who played.");
    }
    if (new Set(playerIds).size !== playerIds.length) throw new Error("A player can only be selected once per game.");
    const playerIdsInRoster = new Set(state.players.map((player) => player.id));
    if (playerIds.some((playerId) => !playerIdsInRoster.has(playerId))) throw new Error("Select players from the current roster.");
    if (typeof id !== "string" || !id) throw new Error("A game ID is required.");
    validateGameTeams(playerIds, teams);
    const rateCents = feeAmount === undefined || feeAmount === null ||
      (typeof feeAmount === "string" && !feeAmount.trim())
      ? state.gameFeeCents
      : setGameFee(state, feeAmount).gameFeeCents;
    return {
      ...state,
      games: [...state.games, {
        id, date, playerIds: [...playerIds], rateCents, createdAt,
        teams: teams.map((team) => ({
          name: team.name.trim(),
          playerIds: [...team.playerIds],
          ...(team.positions ? { positions: team.positions.map((slot) => ({ ...slot })) } : {})
        }))
      }]
    };
  }

  function updateGame(state, gameId, { date, playerIds, feeAmount, teams }) {
    const game = state.games.find((entry) => entry.id === gameId);
    if (!game) throw new Error("That game could not be found.");
    const withoutGame = { ...state, games: state.games.filter((entry) => entry.id !== gameId) };
    const formerPlayers = game.playerIds
      .filter((playerId) => !state.players.some((player) => player.id === playerId))
      .map((playerId) => ({ id: playerId, name: "Former player" }));
    const editableState = { ...withoutGame, players: [...state.players, ...formerPlayers] };
    const updated = recordGame(editableState, {
      id: game.id,
      date,
      playerIds,
      feeAmount: feeAmount === undefined || feeAmount === null ||
        (typeof feeAmount === "string" && !feeAmount.trim())
        ? game.rateCents / 100
        : feeAmount,
      createdAt: game.createdAt,
      teams
    });
    return { ...updated, players: state.players };
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

  function updatePayment(state, paymentId, { playerId, amount, date, invoiceId }) {
    const existingPayment = state.payments.find((payment) => payment.id === paymentId);
    if (!existingPayment) throw new Error("That payment could not be found.");
    if (typeof playerId !== "string" || !playerId) throw new Error("Choose a player for this payment.");
    if (invoiceId && typeof invoiceId !== "string") throw new Error("Choose a valid invoice.");
    const invoice = invoiceId ? state.invoices.find((entry) => entry.id === invoiceId) : null;
    if (invoiceId && (!invoice || invoice.playerId !== playerId)) {
      throw new Error("Choose an invoice belonging to this player.");
    }
    if (!invoiceId && !state.players.some((player) => player.id === playerId) &&
      playerId !== existingPayment.playerId) {
      throw new Error("Choose a player on the current roster.");
    }
    const amountCents = Math.round(Number(amount) * 100);
    if (!Number.isFinite(Number(amount)) || amountCents <= 0) throw new Error("Enter a payment greater than $0.");
    if (!isValidDate(date)) throw new Error("Choose a valid payment date.");

    const withoutPayment = {
      ...state,
      payments: state.payments.filter((payment) => payment.id !== paymentId)
    };
    const targetBalanceCents = invoiceId
      ? getInvoiceStats(withoutPayment, invoiceId).balanceCents
      : getPlayerStats(withoutPayment, playerId).gameBalanceCents;
    if (amountCents > targetBalanceCents) throw new Error("Payment can't exceed the outstanding balance.");

    const updatedPayment = {
      ...existingPayment,
      playerId,
      amount: amountCents / 100,
      date,
      invoiceId: invoiceId || null
    };
    const nextState = {
      ...state,
      payments: state.payments.map((payment) => payment.id === paymentId ? updatedPayment : payment)
    };
    return validateState(nextState);
  }

  function removePayment(state, paymentId) {
    if (!state.payments.some((payment) => payment.id === paymentId)) {
      throw new Error("That payment could not be found.");
    }
    return { ...state, payments: state.payments.filter((payment) => payment.id !== paymentId) };
  }

  function recordGameFeePayment(state, { id, playerId, date, createdAt }) {
    const stats = getPlayerStats(state, playerId);
    const amountCents = Math.min(state.gameFeeCents, stats.gameBalanceCents);
    if (amountCents <= 0) throw new Error("There is no game fee to collect from this player.");
    return recordPayment(state, { id, playerId, amount: amountCents / 100, date, createdAt });
  }

  function sortPlayers(state, sortBy = "name") {
    const latestAttendance = new Map();
    state.games.forEach((game) => {
      if (game.date > currentDate()) return;
      game.playerIds.forEach((playerId) => {
        const latestDate = latestAttendance.get(playerId) || "";
        if (game.date > latestDate) latestAttendance.set(playerId, game.date);
      });
    });
    const compareName = (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
    const players = [...state.players];
    if (sortBy === "balance") {
      return players.sort((a, b) =>
        getPlayerStats(state, b.id).balanceCents - getPlayerStats(state, a.id).balanceCents || compareName(a, b));
    }
    if (sortBy === "recent") {
      return players.sort((a, b) =>
        (latestAttendance.get(b.id) || "").localeCompare(latestAttendance.get(a.id) || "") || compareName(a, b));
    }
    if (sortBy === "position") {
      const positionOrder = new Map(GAME_POSITIONS.map((position, index) => [position, index]));
      return players.sort((a, b) => {
        const aPosition = getPreferredPosition(state, a.id);
        const bPosition = getPreferredPosition(state, b.id);
        const aOrder = positionOrder.get(aPosition) ?? GAME_POSITIONS.length;
        const bOrder = positionOrder.get(bPosition) ?? GAME_POSITIONS.length;
        return aOrder - bOrder || compareName(a, b);
      });
    }
    return players.sort(compareName);
  }

  function removePlayer(state, playerId) {
    if (!state.players.some((player) => player.id === playerId)) return state;
    return { ...state, players: state.players.filter((player) => player.id !== playerId) };
  }

  function recordRosterActivity(state, activity) {
    const { id, action, playerId, playerName, previousName, date, createdAt } = activity;
    if (typeof id !== "string" || !id || !["added", "renamed", "removed"].includes(action) ||
      typeof playerId !== "string" || !playerId || typeof playerName !== "string" || !playerName.trim() ||
      !isValidDate(date) ||
      (action === "renamed" && (typeof previousName !== "string" || !previousName.trim()))) {
      throw new Error("Roster activity is incomplete.");
    }
    if (state.rosterActivity.some((entry) => entry.id === id) ||
      state.players.some((entry) => entry.id === id) ||
      state.games.some((entry) => entry.id === id) ||
      state.payments.some((entry) => entry.id === id) ||
      state.invoices.some((entry) => entry.id === id)) {
      throw new Error("Roster activity ID is already in use.");
    }
    const entry = { id, action, playerId, playerName: playerName.trim(), date, createdAt };
    if (action === "renamed") entry.previousName = previousName.trim();
    return { ...state, rosterActivity: [...state.rosterActivity, entry] };
  }

  function getActivityEntries(state) {
    return [
      ...state.games.map((game) => ({ ...game, type: "game", sortDate: game.createdAt || `${game.date}T12:00:00` })),
      ...state.invoices.map((invoice) => ({ ...invoice, type: "invoice", sortDate: invoice.createdAt || `${invoice.date}T12:00:00` })),
      ...state.payments.map((payment) => ({ ...payment, type: "payment", sortDate: payment.createdAt || `${payment.date}T12:00:00` })),
      ...state.rosterActivity.map((activity) => ({ ...activity, type: "roster", sortDate: activity.createdAt || `${activity.date}T12:00:00` }))
    ].sort((a, b) => b.sortDate.localeCompare(a.sortDate));
  }

  const api = {
    DEFAULT_RATE_CENTS,
    GAME_POSITIONS,
    createId,
    createEmptyState,
    validateState,
    migrateState,
    loadState,
    saveState,
    getPlayerStats,
    getInvoiceStats,
    getSummary,
    getBalanceSeverity,
    getPreferredPosition,
    addPlayer,
    renamePlayer,
    setGameFee,
    setGroupName,
    createGroupState,
    recordGame,
    updateGame,
    createInvoice,
    recordPayment,
    updatePayment,
    removePayment,
    recordGameFeePayment,
    sortPlayers,
    removePlayer,
    recordRosterActivity,
    getActivityEntries
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof globalThis !== "undefined") globalThis.SideoutCore = api;
})();

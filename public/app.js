(() => {
  const Core = window.SideoutCore;
  const STORAGE_KEY = "sideout-volleyball-tracker-v1";
  const FirebaseStore = window.SideoutFirebaseStore;
  const palette = [
    ["#e7eee8", "#4f7457"], ["#f3ece2", "#9c7142"], ["#e8edf4", "#5c7899"],
    ["#f1e9ed", "#976879"], ["#e9eef0", "#5e7b83"], ["#f0ece3", "#89774b"],
    ["#ece9f3", "#786995"], ["#e6efeb", "#4f8170"]
  ];
  const $ = (selector) => document.querySelector(selector);
  const createId = () => Core.createId(window.crypto);
  const money = (amount) => new Intl.NumberFormat("en-US", {
    style: "currency", currency: "USD", maximumFractionDigits: 2
  }).format(amount);
  const dateLabel = (date, options = { month: "short", day: "numeric", year: "numeric" }) =>
    new Intl.DateTimeFormat("en-US", options).format(new Date(`${date}T12:00:00`));
  const today = () => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  };

  let state = Core.createEmptyState();
  let currentUser = null;
  let unsubscribeFromCloud = null;
  let firebaseAuth = null;
  let firebaseStore = null;
  let authMode = "signin";
  let playerSort = "name";
  const dashboardCollapsed = new Set();
  let calendarMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  const views = {
    overview: {
      title: "Overview",
      layout: "dashboard",
      sections: ["overview"]
    },
    players: {
      title: "Players",
      layout: "roster",
      sections: ["players"]
    },
    games: {
      title: "Games",
      layout: "single",
      sections: ["games"]
    },
    invoices: {
      title: "Invoices",
      layout: "single",
      sections: ["invoices"]
    },
    tournaments: {
      title: "Tournaments",
      layout: "single",
      sections: ["tournaments"]
    },
    calendar: {
      title: "Calendar",
      layout: "single",
      sections: ["calendar"]
    },
    activity: {
      title: "Activity",
      layout: "single",
      sections: ["activity"]
    }
  };
  const selectedForBatch = new Set();
  let noticeResolver = null;
  let gameEditorAddPlayerTeam = null;
  let tournamentPlayerIntent = null;

  function isPlannedGame(game) {
    return game.date > today();
  }

  function renderGames() {
    const upcoming = $("#upcoming-games");
    const previous = $("#previous-games");
    const homeUpcoming = $("#home-upcoming-games");
    upcoming.replaceChildren();
    previous.replaceChildren();
    homeUpcoming.replaceChildren();
    const plannedGames = state.games.filter(isPlannedGame).sort((a, b) => a.date.localeCompare(b.date));
    const previousGames = state.games.filter((game) => !isPlannedGame(game))
      .sort((a, b) => b.date.localeCompare(a.date));
    $("#games-empty").hidden = state.games.length > 0;
    $("#upcoming-games-empty").hidden = plannedGames.length > 0 || state.games.length === 0;
    $("#previous-games-empty").hidden = previousGames.length > 0 || state.games.length === 0;
    $("#home-upcoming-games-empty").hidden = plannedGames.length > 0;

    const appendGame = (container, game) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `game-card${isPlannedGame(game) ? " planned" : ""}`;
      button.dataset.editGame = game.id;
      const date = document.createElement("span");
      date.className = "game-card-date";
      date.textContent = dateLabel(game.date, { month: "short", day: "numeric", year: "numeric" });
      const status = document.createElement("span");
      status.className = "game-card-status";
      status.textContent = isPlannedGame(game) ? "Planned" : "Previous";
      const teams = document.createElement("span");
      teams.className = "game-card-teams";
      teams.textContent = game.teams?.length
        ? game.teams.map((team) => `${team.name}: ${team.playerIds.map((id) =>
          state.players.find((player) => player.id === id)?.name || "Former player").join(", ") || "No players"}`).join(" · ")
        : `${game.playerIds.length} player${game.playerIds.length === 1 ? "" : "s"}`;
      button.append(date, status, teams);
      button.setAttribute("aria-label", `${status.textContent} game on ${date.textContent}. ${teams.textContent}. Edit teams`);
      container.append(button);
    };

    plannedGames.forEach((game) => appendGame(upcoming, game));
    previousGames.forEach((game) => appendGame(previous, game));
    plannedGames.forEach((game) => {
      const item = document.createElement("article");
      item.className = "home-upcoming-game";
      const details = document.createElement("div");
      const date = document.createElement("strong");
      date.textContent = dateLabel(game.date, { month: "short", day: "numeric", year: "numeric" });
      const playerCount = document.createElement("span");
      playerCount.textContent = `${game.playerIds.length} player${game.playerIds.length === 1 ? "" : "s"} added`;
      details.append(date, playerCount);
      const addPlayersButton = document.createElement("button");
      addPlayersButton.type = "button";
      addPlayersButton.className = "home-inline-action";
      addPlayersButton.dataset.homeAddPlayers = game.id;
      addPlayersButton.textContent = "Add players";
      addPlayersButton.setAttribute("aria-label", `Add players to game on ${date.textContent}`);
      item.append(details, addPlayersButton);
      homeUpcoming.append(item);
    });
  }

  function showNotice(message, options = {}) {
    const dialog = $("#notice-dialog");
    const isConfirm = Boolean(options.confirm);
    $("#notice-title").textContent = options.title || (isConfirm ? "Please confirm" : "Something needs attention");
    $("#notice-message").textContent = message;
    $("#notice-icon").textContent = isConfirm ? "?" : "!";
    $("#notice-icon").classList.toggle("notice-icon-danger", Boolean(options.destructive));
    $("#notice-cancel").hidden = !isConfirm;
    $("#notice-cancel").textContent = options.cancelLabel || "Cancel";
    $("#notice-confirm").textContent = options.confirmLabel || (isConfirm ? "Continue" : "Okay");
    $("#notice-confirm").classList.toggle("button-danger", Boolean(options.destructive));
    if (dialog.open) finishNotice(false);
    return new Promise((resolve) => {
      noticeResolver = resolve;
      dialog.showModal();
      $("#notice-confirm").focus();
    });
  }

  function finishNotice(result) {
    const dialog = $("#notice-dialog");
    if (dialog.open) dialog.close();
    if (noticeResolver) {
      const resolve = noticeResolver;
      noticeResolver = null;
      resolve(result);
    }
  }

  function setSyncStatus(message, isError = false) {
    const status = $("#sync-status");
    status.textContent = message;
    status.classList.toggle("error", isError);
  }

  function showAuthError(message) {
    $("#auth-error").textContent = message;
    $("#auth-error").hidden = false;
  }

  function friendlyAuthError(error) {
    const messages = {
      "auth/email-already-in-use": "An account already uses this email. Try signing in instead.",
      "auth/invalid-email": "Enter a valid email address.",
      "auth/invalid-credential": "Email or password is incorrect.",
      "auth/user-disabled": "This account has been disabled.",
      "auth/user-not-found": "No account was found for this email.",
      "auth/wrong-password": "Email or password is incorrect.",
      "auth/weak-password": "Choose a password with at least 6 characters.",
      "auth/popup-blocked": "The sign-in popup was blocked. Allow popups and try again.",
      "auth/popup-closed-by-user": "The sign-in popup was closed before completing.",
      "auth/operation-not-allowed": "This sign-in method is not enabled in Firebase Authentication settings.",
      "auth/unauthorized-domain": "This site is not authorized in Firebase Authentication. Add its hostname under Authentication settings.",
      "permission-denied": "Firebase denied access. Check the deployed Firestore rules.",
      "already-exists": "A group already exists for this account. Reloading its saved data.",
      "unavailable": "Firebase is temporarily unavailable. Check your connection and retry."
    };
    return messages[error.code] || error.message || "Something went wrong. Please try again.";
  }

  function setAuthMode(mode) {
    authMode = mode;
    const isSignIn = mode === "signin";
    $("#auth-heading").textContent = isSignIn ? "Welcome back." : "Join your group.";
    $("#auth-copy").textContent = isSignIn
      ? "Sign in to access your group and keep your records in sync."
      : "Create an organizer account to keep your group records safe and in sync.";
    $("#auth-submit").textContent = isSignIn ? "Sign in" : "Create account";
    $("#auth-password").autocomplete = isSignIn ? "current-password" : "new-password";
    $("#reset-password-button").hidden = !isSignIn;
    $("#sign-in-tab").classList.toggle("active", isSignIn);
    $("#sign-in-tab").setAttribute("aria-selected", String(isSignIn));
    $("#create-account-tab").classList.toggle("active", !isSignIn);
    $("#create-account-tab").setAttribute("aria-selected", String(!isSignIn));
    $("#auth-error").hidden = true;
  }

  function updateAuthButtons() {
    const signedIn = Boolean(currentUser);
    $("#auth-sign-out-button").hidden = !signedIn;
    $("#retry-load-button").hidden = !signedIn;
  }

  function activateGroup(user, loadedState) {
    state = loadedState;
    $("#app-shell").hidden = false;
    $("#auth-screen").hidden = true;
    $("#group-setup-screen").hidden = true;
    $("#user-avatar").textContent = (user.email || user.displayName || "U").trim().slice(0, 1).toUpperCase();
    setSyncStatus("Synced");
    render();
    if (unsubscribeFromCloud) unsubscribeFromCloud();
    unsubscribeFromCloud = firebaseStore.watch(user, (remoteState) => {
      if (!currentUser || currentUser.uid !== user.uid) return;
      state = remoteState;
      setSyncStatus("Synced");
      render();
    }, (error) => {
      console.error("Could not receive Firebase updates.", error);
      setSyncStatus("Sync error", true);
    });
  }

  async function loadUserData(user) {
    setSyncStatus("Loading…");
    $("#auth-error").hidden = true;
    $("#auth-screen").hidden = true;
    $("#group-setup-screen").hidden = true;
    $("#app-shell").hidden = true;
    try {
      const loadedState = await firebaseStore.load(user);
      if (!currentUser || currentUser.uid !== user.uid) return;
      if (!loadedState) {
        $("#group-setup-account").textContent = user.email || user.displayName || "your account";
        $("#auth-screen").hidden = true;
        $("#group-setup-screen").hidden = false;
        setSyncStatus("Create a group");
        return;
      }
      activateGroup(user, loadedState);
    } catch (error) {
      console.error("Could not load the signed-in group from Firebase.", error);
      $("#app-shell").hidden = true;
      $("#group-setup-screen").hidden = true;
      $("#auth-screen").hidden = false;
      updateAuthButtons();
      showAuthError(`Could not load your group data. ${friendlyAuthError(error)}`);
    }
  }

  async function saveState(nextState) {
    try {
      if (!currentUser || !firebaseStore) throw new Error("Sign in before saving group data.");
      await firebaseStore.save(currentUser, nextState);
      setSyncStatus("Synced");
      return true;
    } catch (error) {
      console.error("Could not save volleyball tracker data to Firebase.", error);
      setSyncStatus("Not saved", true);
      await showNotice(`Your change could not be saved to Firebase. ${friendlyAuthError(error)}`, {
        title: "Change not saved"
      });
      return false;
    }
  }

  function initializeFirebase() {
    if (!window.firebase || !window.SIDEOUT_FIREBASE_CONFIG || !FirebaseStore) {
      $("#auth-screen").hidden = false;
      showAuthError("Firebase could not load. Check your internet connection and reload the page.");
      return;
    }
    try {
      if (!firebase.apps.length) firebase.initializeApp(window.SIDEOUT_FIREBASE_CONFIG);
      firebaseAuth = firebase.auth();
      firebaseStore = FirebaseStore.createFirebaseStore(firebase, localStorage, STORAGE_KEY, Core);
    } catch (error) {
      console.error("Could not initialize Firebase.", error);
      $("#auth-screen").hidden = false;
      showAuthError(`Firebase could not be initialized. ${friendlyAuthError(error)}`);
      return;
    }

    firebaseAuth.onAuthStateChanged(async (user) => {
      currentUser = user;
      if (unsubscribeFromCloud) {
        unsubscribeFromCloud();
        unsubscribeFromCloud = null;
      }
      updateAuthButtons();
      if (!user) {
        state = Core.createEmptyState();
        $("#app-shell").hidden = true;
        $("#group-setup-screen").hidden = true;
        $("#auth-screen").hidden = false;
        $("#auth-error").hidden = true;
        setSyncStatus("Signed out");
        return;
      }
      await loadUserData(user);
    }, (error) => {
      console.error("Firebase authentication state could not be read.", error);
      $("#auth-screen").hidden = false;
      showAuthError(`Could not check your sign-in status. ${friendlyAuthError(error)}`);
    });
  }

  function playerStats(playerId) {
    return Core.getPlayerStats(state, playerId);
  }

  function playerColor(playerId) {
    const index = state.players.findIndex((player) => player.id === playerId);
    return palette[Math.max(0, index) % palette.length];
  }

  function initials(name) {
    return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
  }

  function avatarElement(player, extraClass = "") {
    const [background, color] = playerColor(player.id);
    const avatar = document.createElement("span");
    avatar.className = `avatar player-avatar ${extraClass}`;
    avatar.style.background = background;
    avatar.style.color = color;
    avatar.setAttribute("aria-hidden", "true");
    avatar.textContent = initials(player.name);
    return avatar;
  }

  function avatarMarkup(player, extraClass = "") {
    return avatarElement(player, extraClass).outerHTML;
  }

  function renderStats() {
    const summary = Core.getSummary(state);
    $("#sidebar-group-name").textContent = state.groupName;
    $("#breadcrumb-group-name").textContent = state.groupName;
    $("#collected-total").textContent = money(summary.collected);
    $("#owed-total").textContent = money(summary.owed);
    $("#player-total").textContent = String(summary.players);
    $("#game-total").textContent = String(summary.games);
    $("#collected-foot").textContent = `${state.payments.length} payment${state.payments.length === 1 ? "" : "s"} recorded`;
    $("#owed-foot").textContent = summary.owed > 0 ? "Across the whole crew" : "Everyone is all caught up";
    $("#roster-count").textContent = `${state.players.length} player${state.players.length === 1 ? "" : "s"}`;
    $("#game-fee-label").textContent = `${money(summary.gameFee)} per game, per player`;
    $("#sidebar-fee-label").textContent = `${money(summary.gameFee)} per player`;
    $("#game-rate-footer").textContent = `${money(summary.gameFee)} / player / game`;
  }

  function renderPlayers() {
    const tbody = $("#player-rows");
    const showPaidColumn = $("#show-paid-column").checked;
    tbody.replaceChildren();
    $("#players-empty").hidden = state.players.length > 0;
    $("#player-table").hidden = state.players.length === 0;
    $("#roster-count").parentElement.hidden = state.players.length === 0;
    $("#player-table [data-paid-column]").hidden = !showPaidColumn;

    const payableIds = new Set(state.players.filter((player) => {
      const stats = playerStats(player.id);
      return stats.gameBalance > 0 && state.gameFeeCents > 0;
    }).map((player) => player.id));
    [...selectedForBatch].forEach((playerId) => {
      if (!payableIds.has(playerId)) selectedForBatch.delete(playerId);
    });
    const players = Core.sortPlayers(state, playerSort);
    let previousPositionGroup;
    players.forEach((player) => {
      const groupPosition = Core.getPreferredPosition(state, player.id) || "";
      if (playerSort === "position" && groupPosition !== previousPositionGroup) {
        const groupRow = document.createElement("tr");
        groupRow.className = "position-group-row";
        const groupCell = document.createElement("td");
        groupCell.colSpan = showPaidColumn ? 6 : 5;
        groupCell.textContent = groupPosition || "No position set";
        if (groupPosition) groupCell.classList.add(`position-${groupPosition.toLocaleLowerCase()}`);
        groupRow.append(groupCell);
        tbody.append(groupRow);
        previousPositionGroup = groupPosition;
      }
      const stats = playerStats(player.id);
      const row = document.createElement("tr");
      const playerCell = document.createElement("td");
      playerCell.dataset.label = "Player";
      playerCell.innerHTML = `<div class="player-cell">${avatarMarkup(player)}<span class="player-name"></span></div>`;
      const selectCheckbox = document.createElement("input");
      selectCheckbox.type = "checkbox";
      selectCheckbox.dataset.selectPlayer = player.id;
      selectCheckbox.setAttribute("aria-label", `Select ${player.name} for batch game-fee collection`);
      selectCheckbox.disabled = stats.gameBalance <= 0 || state.gameFeeCents <= 0;
      selectCheckbox.checked = selectedForBatch.has(player.id);
      playerCell.querySelector(".player-cell").prepend(selectCheckbox);
      playerCell.querySelector(".player-name").textContent = player.name;
      const positionsCell = document.createElement("td");
      positionsCell.dataset.label = "Positions";
      const positionLabel = document.createElement("div");
      positionLabel.className = "player-positions";
      [
        ["Primary", player.primaryPosition],
        ["Secondary", player.secondaryPosition]
      ].filter(([, position]) => position).forEach(([label, position]) => {
        const badge = document.createElement("span");
        badge.className = `position-badge position-${position.toLocaleLowerCase()} ${label.toLocaleLowerCase()}-position-badge`;
        badge.setAttribute("aria-label", `${label} position: ${position}`);
        const badgeMark = document.createElement("span");
        badgeMark.className = "position-badge-mark";
        badgeMark.setAttribute("aria-hidden", "true");
        badgeMark.textContent = position.slice(0, 1);
        const badgeDetails = document.createElement("span");
        badgeDetails.className = "position-badge-details";
        const badgeLabel = document.createElement("small");
        badgeLabel.textContent = label;
        const badgePosition = document.createElement("strong");
        badgePosition.textContent = position;
        badgeDetails.append(badgeLabel, badgePosition);
        badge.append(badgeMark, badgeDetails);
        positionLabel.append(badge);
      });
      if (!positionLabel.childElementCount) {
        const noPosition = document.createElement("span");
        noPosition.className = "no-position-label";
        noPosition.textContent = "Not set";
        positionLabel.append(noPosition);
      }
      positionsCell.append(positionLabel);

      const playedCell = document.createElement("td");
      playedCell.dataset.label = "Played";
      playedCell.innerHTML = `<span class="played-count">${stats.plays}</span>`;
      const rowCells = [playerCell, positionsCell, playedCell];
      if (showPaidColumn) {
        const paidCell = document.createElement("td");
        paidCell.dataset.paidColumn = "";
        paidCell.dataset.label = "Paid";
        paidCell.textContent = money(stats.paid);
        rowCells.push(paidCell);
      }
      const balanceCell = document.createElement("td");
      balanceCell.dataset.label = "Balance";
      const severity = Core.getBalanceSeverity(state, player.id);
      const balance = document.createElement("span");
      balance.className = `balance-chip ${severity}`;
      balance.textContent = stats.balance > 0 ? money(stats.balance) : "Clear";
      balanceCell.append(balance);
      if (severity !== "clear") {
        const balanceStatus = document.createElement("small");
        balanceStatus.className = `balance-status ${severity}`;
        balanceStatus.textContent = severity === "severe" ? "3+ fees due" : "1–3 fees due";
        balanceStatus.title = "Includes game dues and unpaid invoices.";
        balanceCell.append(balanceStatus);
      }

      const actionCell = document.createElement("td");
      actionCell.dataset.label = "Actions";
      const actions = document.createElement("div");
      actions.className = "row-actions";
      if (stats.balance > 0) {
        const paymentButton = document.createElement("button");
        paymentButton.className = "edit-player-button";
        paymentButton.dataset.recordPayment = player.id;
        paymentButton.textContent = "Record payment";
        actions.append(paymentButton);
      }
      const deleteButton = document.createElement("button");
      deleteButton.className = "delete-player-button";
      deleteButton.dataset.remove = player.id;
      deleteButton.setAttribute("aria-label", `Delete ${player.name}`);
      deleteButton.title = `Delete ${player.name}`;
      const deleteIcon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      deleteIcon.setAttribute("viewBox", "0 0 16 16");
      deleteIcon.setAttribute("aria-hidden", "true");
      deleteIcon.setAttribute("focusable", "false");
      const deletePath = document.createElementNS("http://www.w3.org/2000/svg", "path");
      deletePath.setAttribute("d", "M3 4.5h10M6 4.5V3h4v1.5m2-0.5-.6 9H4.6L4 4m2.5 2v5m3-5v5");
      deleteIcon.append(deletePath);
      deleteButton.append(deleteIcon);
      const editButton = document.createElement("button");
      editButton.className = "edit-player-button";
      editButton.dataset.editPlayer = player.id;
      editButton.setAttribute("aria-label", `Edit ${player.name}`);
      editButton.title = `Edit ${player.name}`;
      editButton.textContent = "Edit";
      actions.append(editButton, deleteButton);
      actionCell.append(actions);
      rowCells.push(balanceCell, actionCell);
      row.append(...rowCells);
      tbody.append(row);
    });
    updateBulkCollectControls();
  }

  function updateBulkCollectControls() {
    const selectable = state.players.filter((player) => {
      const stats = playerStats(player.id);
      return stats.gameBalance > 0 && state.gameFeeCents > 0;
    });
    const selectedCount = selectedForBatch.size;
    $("#bulk-collect-button").disabled = selectedCount === 0;
    $("#bulk-collect-button").textContent = selectedCount
      ? `Collect one fee each (${selectedCount})`
      : "Collect one fee each";
    $("#select-all-players").disabled = selectable.length === 0;
    $("#select-all-players").textContent = selectable.length > 0 && selectedCount === selectable.length
      ? "Deselect all"
      : "Select payable";
  }

  function renderInvoices() {
    const list = $("#invoice-list");
    list.replaceChildren();
    $("#invoice-empty").hidden = state.invoices.length > 0;

    [...state.invoices]
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
      .forEach((invoice) => {
        const player = state.players.find((candidate) => candidate.id === invoice.playerId);
        const stats = Core.getInvoiceStats(state, invoice.id);
        const item = document.createElement("article");
        item.className = "invoice-item";

        const icon = document.createElement("span");
        icon.className = "invoice-type";
        icon.setAttribute("aria-hidden", "true");
        icon.textContent = "$";

        const detail = document.createElement("div");
        detail.className = "invoice-detail";
        const name = document.createElement("div");
        name.className = "invoice-name";
        name.textContent = invoice.name;
        const meta = document.createElement("div");
        meta.className = "invoice-meta";
        meta.textContent = `${invoice.category} · ${player ? player.name : invoice.playerName}`;
        const description = document.createElement("div");
        description.className = "invoice-description";
        description.textContent = invoice.description;
        const due = document.createElement("div");
        due.className = `invoice-due ${stats.balance > 0 && invoice.dueDate < today() ? "overdue" : ""}`;
        due.textContent = stats.balance > 0
          ? `${invoice.dueDate < today() ? "Overdue" : "Due"} ${dateLabel(invoice.dueDate)}`
          : `Paid · due ${dateLabel(invoice.dueDate)}`;
        detail.append(name, meta, description, due);

        const amount = document.createElement("div");
        amount.className = "invoice-amount";
        amount.textContent = money(invoice.amountCents / 100);
        const remaining = document.createElement("small");
        remaining.textContent = stats.balance > 0 ? `${money(stats.balance)} remaining` : "Paid";
        amount.append(remaining);
        item.append(icon, detail, amount);

        if (stats.balance > 0) {
          const payButton = document.createElement("button");
          payButton.className = "invoice-pay";
          payButton.dataset.invoicePay = invoice.id;
          payButton.textContent = "Record payment";
          item.append(payButton);
        }
        list.append(item);
      });
  }

  function renderTournaments() {
    const list = $("#tournament-list");
    const homeUpcoming = $("#home-upcoming-tournaments");
    list.replaceChildren();
    homeUpcoming.replaceChildren();
    $("#tournament-empty").hidden = state.tournaments.length > 0;
    const playerNameFor = (playerId) => state.players.find((player) => player.id === playerId)?.name ||
      [...state.rosterActivity].reverse().find((activity) => activity.playerId === playerId)?.playerName || "Former player";
    const tournaments = [...state.tournaments].sort((a, b) => a.date.localeCompare(b.date));
    const upcomingTournaments = tournaments.filter((tournament) => tournament.date > today());
    $("#home-upcoming-tournaments-empty").hidden = upcomingTournaments.length > 0;
    upcomingTournaments.forEach((tournament) => {
      const item = document.createElement("article");
      item.className = "home-upcoming-tournament";
      const details = document.createElement("div");
      const name = document.createElement("strong");
      name.textContent = tournament.name;
      const date = document.createElement("span");
      date.textContent = `${dateLabel(tournament.date)} · ${tournament.teams.length} team${tournament.teams.length === 1 ? "" : "s"}`;
      details.append(name, date);
      const viewButton = document.createElement("button");
      viewButton.type = "button";
      viewButton.className = "home-inline-action";
      viewButton.dataset.homeViewTournament = tournament.id;
      viewButton.textContent = "View teams";
      viewButton.setAttribute("aria-label", `View teams for ${tournament.name}`);
      item.append(details, viewButton);
      homeUpcoming.append(item);
    });
    tournaments.forEach((tournament) => {
      const card = document.createElement("article");
      card.className = "tournament-card";
      const heading = document.createElement("div");
      heading.className = "tournament-card-heading";
      const details = document.createElement("div");
      const title = document.createElement("h3");
      title.textContent = tournament.name;
      const meta = document.createElement("p");
      meta.textContent = `${dateLabel(tournament.date)} · ${money(tournament.amountCents / 100)} per team · invoices due ${dateLabel(tournament.dueDate)}`;
      details.append(title, meta);
      heading.append(details);
      const viewButton = document.createElement("button");
      viewButton.type = "button";
      viewButton.className = "button button-secondary";
      viewButton.dataset.viewTournament = tournament.id;
      viewButton.textContent = "View teams";
      heading.append(viewButton);
      card.append(heading);

      tournament.teams.forEach((team) => {
        const row = document.createElement("section");
        row.className = "tournament-team-card";
        const teamHeading = document.createElement("div");
        teamHeading.className = "tournament-team-card-heading";
        const teamName = document.createElement("h4");
        teamName.textContent = team.name;
        const captainName = playerNameFor(team.captainId);
        const captain = document.createElement("span");
        captain.className = "tournament-captain";
        captain.textContent = `Captain · ${captainName}`;
        teamHeading.append(teamName, captain);
        const members = document.createElement("p");
        members.className = "tournament-members";
        members.textContent = team.playerIds.map(playerNameFor).join(", ");
        const invoiceStats = Core.getInvoiceStats(state, team.invoiceId);
        const invoiceStatus = document.createElement("div");
        invoiceStatus.className = "tournament-invoice-status";
        const statusText = document.createElement("span");
        statusText.textContent = invoiceStats.balanceCents > 0
          ? `${money(invoiceStats.balance)} outstanding`
          : "Team invoice paid";
        invoiceStatus.append(statusText);
        if (invoiceStats.balanceCents > 0) {
          const payButton = document.createElement("button");
          payButton.type = "button";
          payButton.className = "button button-secondary";
          payButton.dataset.tournamentInvoicePay = team.invoiceId;
          payButton.textContent = "Record captain payment";
          payButton.setAttribute("aria-label", `Record ${captainName}'s payment for ${team.name}`);
          invoiceStatus.append(payButton);
        }
        const viewButton = document.createElement("button");
        viewButton.type = "button";
        viewButton.className = "tournament-team-view";
        viewButton.dataset.viewTournamentTeam = team.id;
        viewButton.dataset.tournamentId = tournament.id;
        viewButton.textContent = "View team";
        row.append(teamHeading, members, invoiceStatus, viewButton);
        card.append(row);
      });
      list.append(card);
    });
  }

  function activityEntries() {
    return Core.getActivityEntries(state);
  }

  function renderActivity(showAll = false) {
    const list = $("#activity-list");
    const entries = activityEntries();
    list.replaceChildren();
    $("#activity-empty").hidden = entries.length > 0;
    const visibleEntries = showAll ? entries : entries.slice(0, 5);

    visibleEntries.forEach((entry) => {
      const item = document.createElement("article");
      item.className = "activity-item";
      const detailButton = document.createElement("button");
      detailButton.type = "button";
      detailButton.className = "activity-open";
      detailButton.dataset.activityDetail = entry.id;
      detailButton.setAttribute("aria-label", `View details: ${activityDescription(entry)}`);
      const icon = document.createElement("span");
      icon.className = `activity-icon ${entry.type}`;
      icon.setAttribute("aria-hidden", "true");
      icon.textContent = entry.type === "game" ? "⌁" : entry.type === "roster" ? "♙" : entry.type === "payment" ? "$" : "＋";
      const text = document.createElement("div");
      text.className = "activity-text";
      const description = document.createElement("div");
      if (entry.type === "game") {
        const lead = document.createElement("strong");
        const planned = isPlannedGame(entry);
        lead.textContent = planned ? "Planned game" : "Game night";
        description.append(lead, document.createTextNode(
          ` · ${entry.playerIds.length} player${entry.playerIds.length === 1 ? "" : "s"} ${planned ? "assigned" : "played"}`
        ));
      } else if (entry.type === "invoice") {
        const lead = document.createElement("strong");
        lead.textContent = entry.name;
        description.append(lead, document.createTextNode(` · invoice for ${money(entry.amountCents / 100)}`));
      } else if (entry.type === "roster") {
        const lead = document.createElement("strong");
        lead.textContent = entry.playerName;
        const actionText = entry.action === "added"
          ? " added to the roster"
          : entry.action === "renamed"
            ? ` renamed from ${entry.previousName}`
            : " removed from the roster";
        description.append(lead, document.createTextNode(actionText));
      } else {
        const lead = document.createElement("strong");
        const player = state.players.find((candidate) => candidate.id === entry.playerId);
        const invoice = entry.invoiceId && state.invoices.find((candidate) => candidate.id === entry.invoiceId);
        lead.textContent = player ? player.name : (invoice ? invoice.playerName : "Player");
        description.append(lead, document.createTextNode(invoice ? ` paid ${invoice.name}` : " paid game dues"));
      }
      const meta = document.createElement("div");
      meta.className = "activity-meta";
      meta.textContent = dateLabel(entry.date);
      text.append(description, meta);
      detailButton.append(icon, text);
      if (entry.type === "payment") {
        const amount = document.createElement("span");
        amount.className = "activity-amount";
        amount.textContent = `+${money(entry.amount)}`;
        detailButton.append(amount);
      }
      item.append(detailButton);
      if (entry.type === "payment") {
        const actions = document.createElement("div");
        actions.className = "activity-actions";
        const editButton = document.createElement("button");
        editButton.type = "button";
        editButton.dataset.editPayment = entry.id;
        editButton.textContent = "Edit";
        editButton.setAttribute("aria-label", `Edit ${money(entry.amount)} payment`);
        const removeButton = document.createElement("button");
        removeButton.type = "button";
        removeButton.dataset.removePayment = entry.id;
        removeButton.textContent = "Delete";
        removeButton.setAttribute("aria-label", `Delete ${money(entry.amount)} payment`);
        actions.append(editButton, removeButton);
        item.append(actions);
      }
      list.append(item);
    });
    const toggle = $("#activity-toggle");
    toggle.hidden = entries.length <= 5;
    toggle.innerHTML = showAll ? 'Show recent activity <span aria-hidden="true">↑</span>' : 'Show all activity <span aria-hidden="true">→</span>';
    toggle.dataset.showAll = String(showAll);
  }

  function renderCalendar() {
    const grid = $("#calendar-grid");
    grid.replaceChildren();
    $("#calendar-month").textContent = new Intl.DateTimeFormat("en-US", {
      month: "long", year: "numeric"
    }).format(calendarMonth);

    const gamesByDate = new Map();
    state.games.forEach((game) => {
      if (!gamesByDate.has(game.date)) gamesByDate.set(game.date, []);
      gamesByDate.get(game.date).push(game);
    });
    const tournamentsByDate = new Map();
    state.tournaments.forEach((tournament) => {
      if (!tournamentsByDate.has(tournament.date)) tournamentsByDate.set(tournament.date, []);
      tournamentsByDate.get(tournament.date).push(tournament);
    });
    $("#calendar-empty").hidden = state.games.length + state.tournaments.length > 0;

    const firstDay = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth(), 1);
    const gridStart = new Date(firstDay);
    gridStart.setDate(firstDay.getDate() - firstDay.getDay());
    for (let index = 0; index < 42; index += 1) {
      const day = new Date(gridStart);
      day.setDate(gridStart.getDate() + index);
      const date = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
      const cell = document.createElement("div");
      cell.className = `calendar-day${day.getMonth() === calendarMonth.getMonth() ? "" : " outside-month"}`;
      cell.setAttribute("role", "gridcell");
      cell.dataset.calendarDate = date;
      const dateLabel = document.createElement("span");
      dateLabel.className = "calendar-date";
      dateLabel.textContent = String(day.getDate());
      cell.append(dateLabel);
      (gamesByDate.get(date) || []).forEach((game) => {
        const gameButton = document.createElement("button");
        gameButton.type = "button";
        gameButton.className = `calendar-game${game.date > today() ? " planned-game" : ""}`;
        gameButton.dataset.calendarGame = game.id;
        const playerNames = game.playerIds.map((playerId) =>
          state.players.find((player) => player.id === playerId)?.name || "Former player");
        const label = document.createElement("span");
        label.className = "calendar-game-label";
        label.textContent = `Game · ${game.playerIds.length} player${game.playerIds.length === 1 ? "" : "s"}`;
        const tooltip = document.createElement("span");
        tooltip.className = "calendar-game-tooltip";
        tooltip.setAttribute("aria-hidden", "true");
        tooltip.textContent = playerNames.join(", ");
        gameButton.append(label, tooltip);
        gameButton.setAttribute(
          "aria-label",
          `View game on ${dateLabelText(date)} with ${game.playerIds.length} players: ${playerNames.join(", ")}`
        );
        cell.append(gameButton);
      });
      (tournamentsByDate.get(date) || []).forEach((tournament) => {
        const tournamentButton = document.createElement("button");
        tournamentButton.type = "button";
        tournamentButton.className = "calendar-game calendar-tournament";
        tournamentButton.dataset.calendarTournament = tournament.id;
        const label = document.createElement("span");
        label.className = "calendar-game-label";
        label.textContent = `🏆 ${tournament.name}`;
        tournamentButton.append(label);
        tournamentButton.setAttribute(
          "aria-label",
          `View tournament ${tournament.name} on ${dateLabelText(date)}`
        );
        cell.append(tournamentButton);
      });
      grid.append(cell);
    }
  }

  function dateLabelText(date) {
    return new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric" })
      .format(new Date(`${date}T12:00:00`));
  }

  function activityDescription(entry) {
    if (entry.type === "game") {
      return isPlannedGame(entry)
        ? `Planned game, ${entry.playerIds.length} players assigned`
        : `Game night, ${entry.playerIds.length} players played`;
    }
    if (entry.type === "roster") {
      const action = entry.action === "added" ? "added to the roster"
        : entry.action === "renamed" ? `renamed from ${entry.previousName}`
          : "removed from the roster";
      return `${entry.playerName} ${action}`;
    }
    if (entry.type === "invoice") return `${entry.name}, invoice for ${money(entry.amountCents / 100)}`;
    const player = state.players.find((candidate) => candidate.id === entry.playerId);
    return `${player ? player.name : "Player"} paid ${money(entry.amount)}`;
  }

  function showActivityDetails(entry) {
    const title = $("#activity-detail-title");
    const content = $("#activity-detail-content");
    content.replaceChildren();
    const addDetail = (label, value) => {
      const row = document.createElement("p");
      const strong = document.createElement("strong");
      strong.textContent = `${label}: `;
      row.append(strong, document.createTextNode(value));
      content.append(row);
    };

    if (entry.type === "game") {
      openGameDialog(entry);
      return;
    } else if (entry.type === "roster") {
      title.textContent = entry.action === "added" ? "Player added"
        : entry.action === "renamed" ? "Player renamed"
          : "Player removed";
      addDetail("Player", entry.playerName);
      if (entry.action === "renamed") addDetail("Previous name", entry.previousName);
      addDetail("Activity date", dateLabel(entry.date));
    } else if (entry.type === "invoice") {
      title.textContent = entry.name;
      addDetail("Player", state.players.find((player) => player.id === entry.playerId)?.name || entry.playerName);
      addDetail("Category", entry.category);
      addDetail("Amount", money(entry.amountCents / 100));
      addDetail("Due date", dateLabel(entry.dueDate));
      addDetail("Description", entry.description);
    } else {
      const player = state.players.find((candidate) => candidate.id === entry.playerId);
      const invoice = entry.invoiceId && state.invoices.find((candidate) => candidate.id === entry.invoiceId);
      title.textContent = "Payment";
      addDetail("Player", player ? player.name : invoice ? invoice.playerName : "Former player");
      addDetail("Amount", money(entry.amount));
      addDetail("Applied to", invoice ? invoice.name : "Game dues");
      addDetail("Payment date", dateLabel(entry.date));
    }
    $("#activity-detail-dialog").showModal();
  }

  function render() {
    renderStats();
    renderPlayers();
    renderInvoices();
    renderTournaments();
    renderActivity();
    renderCalendar();
    renderGames();
  }

  function updateDashboardCollapse(viewName) {
    const isOverview = viewName === "overview";
    document.querySelectorAll("[data-dashboard-collapse]").forEach((button) => {
      const section = button.dataset.dashboardCollapse;
      const isCollapsed = isOverview && dashboardCollapsed.has(section);
      const content = document.getElementById(button.getAttribute("aria-controls"));
      button.hidden = !isOverview;
      content.hidden = isCollapsed;
      button.setAttribute("aria-expanded", String(!isCollapsed));
      button.textContent = isCollapsed ? "Expand" : "Minimize";
      button.setAttribute("aria-label", `${isCollapsed ? "Expand" : "Minimize"} ${section === "roster" ? "player section" : `${section} section`}`);
    });
  }

  function setActiveView(viewName) {
    const view = views[viewName] || views.overview;
    const activeSections = new Set(view.sections);
    $("#main-content").dataset.viewLayout = view.layout;
    $("#view-title").textContent = view.title;
    document.querySelectorAll("[data-view-section]").forEach((section) => {
      const sectionViews = section.dataset.viewSection.split(/\s+/);
      section.hidden = !sectionViews.some((sectionView) => activeSections.has(sectionView));
    });
    document.querySelectorAll("[data-view-link]").forEach((link) => {
      const isActive = link.dataset.viewLink === (views[viewName] ? viewName : "overview");
      link.classList.toggle("active", isActive);
      if (isActive) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    });
    updateDashboardCollapse(views[viewName] ? viewName : "overview");
  }

  function syncViewFromHash() {
    const viewName = window.location.hash.slice(1);
    setActiveView(views[viewName] ? viewName : "overview");
  }

  function openSettingsMenu() {
    const menu = $("#settings-menu");
    const isOpen = !menu.hidden;
    menu.hidden = isOpen;
    $("#settings-menu-button").setAttribute("aria-expanded", String(!isOpen));
  }

  function closeSettingsMenu() {
    $("#settings-menu").hidden = true;
    $("#settings-menu-button").setAttribute("aria-expanded", "false");
  }

  function showError(selector, message) {
    const element = $(selector);
    element.textContent = message;
    element.hidden = false;
  }

  function openPlayerDialog() {
    $("#player-error").hidden = true;
    $("#player-form").reset();
    $("#player-form").dataset.editPlayerId = "";
    $("#player-dialog-title").textContent = "Add a player";
    $("#player-dialog-submit").textContent = "Add player";
    refreshPlayerPositionChoices();
    $("#player-dialog").showModal();
    $("#player-name").focus();
  }

  function openEditPlayerDialog(player) {
    $("#player-error").hidden = true;
    $("#player-form").dataset.editPlayerId = player.id;
    $("#player-name").value = player.name;
    $("#player-position-options").querySelector(`input[name="primaryPosition"][value="${player.primaryPosition || ""}"]`).checked = true;
    $("#player-position-options").querySelector(`input[name="secondaryPosition"][value="${player.secondaryPosition || ""}"]`).checked = true;
    refreshPlayerPositionChoices();
    $("#player-dialog-title").textContent = "Edit player";
    $("#player-dialog-submit").textContent = "Save changes";
    $("#player-dialog").showModal();
    $("#player-name").focus();
    $("#player-name").select();
  }

  function openGameDialog(game = null, scheduled = false, gameDate = null) {
    $("#game-error").hidden = true;
    $("#game-form").dataset.gameId = game?.id || "";
    $("#game-dialog-title").textContent = game
      ? `Edit game · ${isPlannedGame(game) ? "planned" : "previous"}`
      : scheduled ? "Plan a game" : "Record a game";
    $("#game-submit").textContent = game ? "Save game changes" : scheduled ? "Plan game" : "Save game";
    $("#game-date").value = game?.date || gameDate || (scheduled ? dateOffset(7) : today());
    $("#game-fee-override").value = game && game.rateCents !== state.gameFeeCents
      ? (game.rateCents / 100).toFixed(2)
      : "";
    $("#game-default-fee").textContent = money(Core.getSummary(state).gameFee);
    $("#game-fee-note").textContent = money(Core.getSummary(state).gameFee);
    const teamAssignments = [[], []];
    if (game?.teams?.length) {
      if (game.teams.length <= 2) game.teams.forEach((team, teamIndex) => {
        const savedPositions = team.positions || [];
        savedPositions.forEach((assignment) => teamAssignments[teamIndex].push({ ...assignment }));
        team.playerIds
          .filter((playerId) => !savedPositions.some((assignment) => assignment.playerId === playerId))
          .forEach((playerId) => teamAssignments[teamIndex].push({
            playerId,
            position: getPreferredGamePosition(playerId)
          }));
      });
      else game.playerIds.forEach((playerId, index) => {
        const teamIndex = index % 2;
        teamAssignments[teamIndex].push({
          playerId,
          position: getPreferredGamePosition(playerId)
        });
      });
    } else if (game) {
      game.playerIds.forEach((playerId, index) => {
        const teamIndex = index % 2;
        teamAssignments[teamIndex].push({
          playerId,
          position: getPreferredGamePosition(playerId)
        });
      });
    }
    renderGameTeams(teamAssignments, game);
    $("#game-dialog").showModal();
    $("#game-date").focus();
  }

  function getPreferredGamePosition(playerId) {
    return Core.getPreferredPosition(state, playerId);
  }

  function refreshPlayerPositionChoices() {
    const options = $("#player-position-options");
    const primaryPosition = options.querySelector('input[name="primaryPosition"]:checked')?.value;
    const secondaryChoices = options.querySelectorAll('input[name="secondaryPosition"]');
    secondaryChoices.forEach((choice) => {
      const isDuplicate = Boolean(primaryPosition && choice.value === primaryPosition);
      choice.disabled = isDuplicate;
      choice.closest("label").classList.toggle("disabled", isDuplicate);
      if (isDuplicate && choice.checked) {
        options.querySelector('input[name="secondaryPosition"][value=""]').checked = true;
      }
    });
  }

  function dateOffset(days) {
    const date = new Date();
    date.setDate(date.getDate() + days);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }

  function renderGameTeams(teamAssignments = [[], []], game = null) {
    const lists = $("#game-team-lists");
    lists.replaceChildren();
    const rosterIds = new Set(state.players.map((player) => player.id));
    const formerPlayers = (game?.playerIds || [])
      .filter((playerId) => !rosterIds.has(playerId))
      .map((playerId) => {
        const history = [...state.rosterActivity].reverse().find((activity) => activity.playerId === playerId);
        return { id: playerId, name: history?.playerName || "Former player" };
      });
    const editablePlayers = [...state.players, ...formerPlayers];
    [0, 1].forEach((teamIndex) => {
      const section = document.createElement("section");
      section.className = "game-team-column";
      const heading = document.createElement("div");
      heading.className = "game-team-heading";
      const title = document.createElement("h3");
      title.textContent = `Team ${teamIndex + 1}`;
      const addButton = document.createElement("button");
      addButton.type = "button";
      addButton.className = "text-button";
      addButton.dataset.addTeamPlayer = String(teamIndex);
      addButton.textContent = "＋ Add player";
      const addRosterButton = document.createElement("button");
      addRosterButton.type = "button";
      addRosterButton.className = "text-button";
      addRosterButton.dataset.addRosterPlayer = String(teamIndex);
      addRosterButton.textContent = "＋ New roster player";
      const actions = document.createElement("div");
      actions.className = "game-team-actions";
      actions.append(addButton, addRosterButton);
      heading.append(title, actions);
      const rows = document.createElement("div");
      rows.className = "game-team-rows";
      (teamAssignments[teamIndex] || []).forEach((assignment, assignmentIndex) => {
        rows.append(createGameTeamPlayerRow(
          assignment,
          teamIndex,
          assignmentIndex,
          editablePlayers,
          rosterIds,
          teamAssignments
        ));
      });
      if (!rows.childElementCount) {
        const empty = document.createElement("p");
        empty.className = "game-team-empty";
        empty.textContent = editablePlayers.length ? "No players assigned." : "Add players to the roster first.";
        rows.append(empty);
      }
      section.append(heading, rows);
      lists.append(section);
    });
  }

  function createGameTeamPlayerRow(assignment, teamIndex, assignmentIndex, players, rosterIds, teamAssignments) {
    const row = document.createElement("div");
    row.className = "game-team-player";
    const selectedPlayer = players.find((player) => player.id === assignment.playerId);
    const picker = document.createElement("div");
    picker.className = "game-player-picker";
    picker.dataset.playerPicker = "";
    picker.dataset.teamPlayer = String(teamIndex);
    picker.dataset.assignmentIndex = String(assignmentIndex);
    picker.dataset.playerId = assignment.playerId || "";
    const pickerButton = document.createElement("button");
    pickerButton.type = "button";
    pickerButton.className = "game-player-picker-button";
    pickerButton.dataset.playerPickerToggle = "";
    pickerButton.setAttribute("aria-haspopup", "listbox");
    pickerButton.setAttribute("aria-expanded", "false");
    pickerButton.textContent = selectedPlayer
      ? `${selectedPlayer.name}${rosterIds.has(selectedPlayer.id) ? "" : " (former player)"}`
      : "Choose player";
    pickerButton.setAttribute("aria-label", selectedPlayer
      ? `${selectedPlayer.name} on team ${teamIndex + 1}. Change player`
      : `Choose player for team ${teamIndex + 1}`);

    const alreadyAssigned = new Set(teamAssignments.flat().map((entry) => entry.playerId).filter(Boolean));
    const dropdown = document.createElement("div");
    dropdown.className = "game-player-picker-menu";
    dropdown.hidden = true;
    const search = document.createElement("input");
    search.type = "search";
    search.className = "game-player-picker-search";
    search.placeholder = "Search players";
    search.setAttribute("aria-label", `Search players for team ${teamIndex + 1}`);
    const options = document.createElement("div");
    options.id = `game-player-options-${teamIndex}-${assignmentIndex}`;
    pickerButton.setAttribute("aria-controls", options.id);
    options.className = "game-player-picker-options";
    options.setAttribute("role", "listbox");
    options.setAttribute("aria-label", `Players for team ${teamIndex + 1}`);
    const empty = document.createElement("p");
    empty.className = "game-player-picker-empty";
    empty.textContent = players.length ? "No matching players." : "Add players to the roster first.";
    players.forEach((player) => {
      const option = document.createElement("button");
      option.type = "button";
      option.className = "game-player-picker-option";
      option.dataset.playerOption = player.id;
      option.setAttribute("role", "option");
      option.setAttribute("aria-selected", String(assignment.playerId === player.id));
      option.disabled = alreadyAssigned.has(player.id) && assignment.playerId !== player.id;
      const name = document.createElement("span");
      name.textContent = `${player.name}${rosterIds.has(player.id) ? "" : " (former player)"}`;
      option.append(name);
      const preferences = [player.primaryPosition, player.secondaryPosition].filter(Boolean);
      if (preferences.length) {
        const preferenceLabel = document.createElement("small");
        preferenceLabel.className = "game-player-picker-preferences";
        preferenceLabel.textContent = preferences.join(" · ");
        option.append(preferenceLabel);
      }
      options.append(option);
    });
    options.append(empty);
    dropdown.append(search, options);
    picker.append(pickerButton, dropdown);

    const positionSelect = document.createElement("select");
    positionSelect.dataset.teamPosition = String(teamIndex);
    positionSelect.setAttribute("aria-label", `Position for ${selectedPlayer?.name || "player"} on team ${teamIndex + 1}`);
    const positionPlaceholder = document.createElement("option");
    positionPlaceholder.value = "";
    positionPlaceholder.textContent = "Position (optional)";
    positionSelect.append(positionPlaceholder);
    Core.GAME_POSITIONS.forEach((position, index) => {
      const option = document.createElement("option");
      option.value = `${position.toLocaleLowerCase()}-${index}`;
      option.textContent = position;
      option.dataset.positionName = position;
      positionSelect.append(option);
    });
    const savedPositionIndex = assignment.position
      ? Core.GAME_POSITIONS.findIndex((position) => position === assignment.position)
      : -1;
    if (savedPositionIndex >= 0) {
      positionSelect.value = `${assignment.position.toLocaleLowerCase()}-${savedPositionIndex}`;
    }
    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.className = "game-team-remove";
    removeButton.dataset.removeTeamPlayer = String(teamIndex);
    removeButton.textContent = "×";
    removeButton.setAttribute("aria-label", "Remove player from this team");
    row.append(picker, positionSelect, removeButton);
    return row;
  }

  function readGameTeamAssignments() {
    const assignments = [[], []];
    document.querySelectorAll("#game-team-lists .game-team-column").forEach((section, teamIndex) => {
      section.querySelectorAll(".game-team-player").forEach((row) => {
        const playerId = row.querySelector("[data-player-picker]").dataset.playerId;
        const positionOption = row.querySelector("[data-team-position]").selectedOptions[0];
        const position = positionOption?.dataset.positionName || "";
        assignments[teamIndex].push({ playerId, position });
      });
    });
    return assignments;
  }

  function showGameTeamAssignmentsError() {
    const assignments = readGameTeamAssignments();
    const seen = new Set();
    for (const team of assignments) {
      for (const assignment of team) {
        if (!assignment.playerId && !assignment.position) continue;
        if (!assignment.playerId) {
          throw new Error("Choose a player or remove the empty team row.");
        }
        if (seen.has(assignment.playerId)) {
          throw new Error("A player can only be assigned to one team.");
        }
        seen.add(assignment.playerId);
      }
    }
    return assignments;
  }

  function populatePaymentInvoices(playerId, selectedInvoiceId = "") {
    const invoiceSelect = $("#payment-invoice-id");
    const existingPaymentId = $("#payment-form").dataset.editPaymentId;
    const existingPayment = state.payments.find((payment) => payment.id === existingPaymentId);
    const invoices = state.invoices.filter((invoice) => invoice.playerId === playerId &&
      (Core.getInvoiceStats(state, invoice.id).balanceCents > 0 ||
        (existingPayment && invoice.id === existingPayment.invoiceId)));
    invoiceSelect.replaceChildren();
    invoices.forEach((invoice) => {
      const option = document.createElement("option");
      option.value = invoice.id;
      option.textContent = `${invoice.name} · ${money(Core.getInvoiceStats(state, invoice.id).balance)}`;
      invoiceSelect.append(option);
    });
    invoiceSelect.value = invoices.some((invoice) => invoice.id === selectedInvoiceId)
      ? selectedInvoiceId
      : (invoices[0]?.id || "");
    return invoices;
  }

  function updatePaymentForm(resetAmount = false) {
    const playerId = $("#payment-player-id").value;
    const player = state.players.find((candidate) => candidate.id === playerId);
    const stats = playerStats(playerId);
    const isInvoicePayment = $("#payment-type").value === "invoice";
    $("#payment-invoice-field").hidden = !isInvoicePayment;
    const existingPayment = state.payments.find((payment) => payment.id === $("#payment-form").dataset.editPaymentId);
    const invoice = isInvoicePayment
      ? state.invoices.find((candidate) => candidate.id === $("#payment-invoice-id").value && candidate.playerId === playerId)
      : null;
    if (!player && !invoice && !existingPayment) return;
    const playerName = player?.name || invoice?.playerName || "former player";
    $("#payment-title").textContent = existingPayment ? `Correct payment · ${playerName}` : `Payment from ${playerName}`;
    let balanceCents = invoice ? Core.getInvoiceStats(state, invoice.id).balanceCents : stats.gameBalanceCents;
    if (existingPayment && existingPayment.playerId === playerId &&
      (invoice ? existingPayment.invoiceId === invoice.id : !existingPayment.invoiceId)) {
      balanceCents += Math.round(existingPayment.amount * 100);
    }
    const defaultAmountCents = isInvoicePayment
    ? balanceCents
    : Math.min(state.gameFeeCents > 0 ? state.gameFeeCents : balanceCents, balanceCents);
    $("#payment-amount").max = String(Math.max(balanceCents, 0) / 100);
    if (resetAmount || !$("#payment-amount").value) {
      const amountCents = existingPayment ? Math.round(existingPayment.amount * 100) : defaultAmountCents;
      $("#payment-amount").value = (Math.min(amountCents, balanceCents) / 100).toFixed(2);
    }
    $("#payment-date").value = $("#payment-date").value || today();
    $("#payment-context").textContent = invoice
      ? `${invoice.name} · ${money(balanceCents / 100)} available. Edit the player, amount, or date as needed.`
      : `Game dues: ${money(balanceCents / 100)} available. Edit the player, amount, or date as needed.`;
    $("#payment-submit").textContent = existingPayment ? "Save changes" : "Save payment";
  }

  function openPaymentDialog(playerId, invoiceId = null, paymentId = null) {
    const player = state.players.find((candidate) => candidate.id === playerId);
    const existingPayment = state.payments.find((payment) => payment.id === paymentId);
    const unpaidInvoices = state.invoices.filter((invoice) => invoice.playerId === playerId &&
      (Core.getInvoiceStats(state, invoice.id).balanceCents > 0 ||
        (existingPayment && invoice.id === existingPayment.invoiceId)));
    if (!player && !unpaidInvoices.length && !existingPayment) return;
    const stats = player ? playerStats(playerId) : { gameBalanceCents: 0 };
    $("#payment-error").hidden = true;
    $("#payment-form").reset();
    $("#payment-form").dataset.editPaymentId = paymentId || "";
    $("#payment-title").textContent = paymentId ? "Correct payment" : "Record payment";
    $("#payment-player-id").replaceChildren();
    state.players.forEach((candidate) => {
      const option = document.createElement("option");
      option.value = candidate.id;
      option.textContent = candidate.name;
      $("#payment-player-id").append(option);
    });
    if (!player) {
      const formerPlayerOption = document.createElement("option");
      formerPlayerOption.value = playerId;
      const invoice = unpaidInvoices.find((entry) => entry.playerId === playerId);
      formerPlayerOption.textContent = `${invoice?.playerName || existingPayment?.playerId || "Former player"} (former player)`;
      $("#payment-player-id").append(formerPlayerOption);
    }
    $("#payment-player-id").value = playerId;
    $("#payment-date").value = existingPayment?.date || today();
    const invoices = populatePaymentInvoices(playerId, invoiceId || existingPayment?.invoiceId);
    const typeSelect = $("#payment-type");
    typeSelect.querySelector('option[value="game"]').disabled = stats.gameBalanceCents <= 0 &&
      !(existingPayment && !existingPayment.invoiceId && existingPayment.playerId === playerId);
    typeSelect.querySelector('option[value="invoice"]').disabled = invoices.length === 0;
    const shouldUseInvoice = invoiceId
      ? true
      : existingPayment
        ? Boolean(existingPayment.invoiceId)
        : stats.gameBalanceCents <= 0;
    typeSelect.value = shouldUseInvoice ? "invoice" : "game";
    if (!invoices.length && stats.gameBalanceCents <= 0 && !existingPayment) return;
    $("#payment-amount").value = existingPayment ? String(existingPayment.amount) : "";
    updatePaymentForm(Boolean(existingPayment));
    $("#payment-dialog").showModal();
    $("#payment-amount").focus();
  }

  function changePaymentPlayer() {
    const playerId = $("#payment-player-id").value;
    const previousInvoiceId = $("#payment-invoice-id").value;
    const invoices = populatePaymentInvoices(playerId, previousInvoiceId);
    const stats = playerStats(playerId);
    const existingPayment = state.payments.find((payment) => payment.id === $("#payment-form").dataset.editPaymentId);
    const canRetainGamePayment = existingPayment?.playerId === playerId && !existingPayment.invoiceId;
    const typeSelect = $("#payment-type");
    typeSelect.querySelector('option[value="game"]').disabled =
      stats.gameBalanceCents + (canRetainGamePayment ? Math.round(existingPayment.amount * 100) : 0) <= 0;
    typeSelect.querySelector('option[value="invoice"]').disabled = invoices.length === 0;
    if (typeSelect.value === "invoice" && !invoices.length) typeSelect.value = "game";
    else if (typeSelect.value === "game" && stats.gameBalanceCents <= 0) typeSelect.value = "invoice";
    updatePaymentForm(true);
  }

  function openInvoicePaymentDialog(invoiceId) {
    const invoice = state.invoices.find((candidate) => candidate.id === invoiceId);
    if (!invoice) return;
    openPaymentDialog(invoice.playerId, invoiceId);
  }

  function openInvoiceDialog() {
    $("#invoice-error").hidden = true;
    $("#invoice-form").reset();
    const select = $("#invoice-player");
    select.replaceChildren();
    state.players.forEach((player) => {
      const option = document.createElement("option");
      option.value = player.id;
      option.textContent = player.name;
      select.append(option);
    });
    $("#invoice-due-date").value = today();
    if (state.players.length === 0) {
      $("#invoice-error").textContent = "Add a player to the roster before creating an invoice.";
      $("#invoice-error").hidden = false;
      return;
    }
    $("#invoice-dialog").showModal();
    $("#invoice-player").focus();
  }

  function readTournamentEditorTeams() {
    return [...$("#tournament-team-editor").querySelectorAll(".tournament-team-editor-card")].map((card) => ({
      name: card.querySelector("[data-tournament-team-name]").value,
      captainId: card.querySelector("[data-tournament-captain-picker] [data-tournament-player-picker]")
        .dataset.selectedPlayerId || "",
      playerIds: []
    }));
  }

  function createTournamentPlayerSearch(container, {
    players, selectedIds, assignedIds, lockedIds = new Set(), mode, label
  }) {
    const selected = new Set(selectedIds);
    const picker = document.createElement("div");
    picker.className = "game-player-picker tournament-player-picker";
    picker.dataset.tournamentPlayerPicker = "";
    picker.dataset.mode = mode;
    picker.dataset.selectedPlayerId = mode === "single" ? (selectedIds[0] || "") : "";
    const selectedNames = players.filter((player) => selected.has(player.id)).map((player) => player.name);
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "game-player-picker-button";
    toggle.dataset.playerPickerToggle = "";
    toggle.setAttribute("aria-haspopup", "listbox");
    toggle.setAttribute("aria-expanded", "false");
    toggle.textContent = mode === "single" ? selectedNames[0] || "Choose a captain"
      : selectedNames.length ? `${selectedNames.length} player${selectedNames.length === 1 ? "" : "s"} selected`
        : "Choose players";
    toggle.setAttribute("aria-label", label);
    const menu = document.createElement("div");
    menu.className = "game-player-picker-menu";
    menu.hidden = true;
    const search = document.createElement("input");
    search.type = "search";
    search.className = "game-player-picker-search";
    search.placeholder = "Search players";
    search.setAttribute("aria-label", `Search ${label.toLocaleLowerCase()}`);
    const options = document.createElement("div");
    options.className = "game-player-picker-options";
    options.setAttribute("role", "listbox");
    options.setAttribute("aria-label", label);
    options.setAttribute("aria-multiselectable", String(mode === "multiple"));
    players.forEach((player) => {
      const option = document.createElement("button");
      option.type = "button";
      option.className = "game-player-picker-option";
      option.dataset.tournamentPlayerOption = player.id;
      option.setAttribute("role", "option");
      option.setAttribute("aria-selected", String(selected.has(player.id)));
      option.disabled = lockedIds.has(player.id) || assignedIds.has(player.id) && !selected.has(player.id);
      option.textContent = player.name;
      options.append(option);
    });
    const empty = document.createElement("p");
    empty.className = "game-player-picker-empty";
    empty.textContent = players.length ? "No matching players." : "Add players to the roster first.";
    options.append(empty);
    menu.append(search, options);
    picker.append(toggle, menu);
    container.replaceChildren(picker);
    if (mode === "multiple") {
      const summary = document.createElement("p");
      summary.className = "tournament-selected-player-names";
      summary.textContent = selectedNames.join(", ") || "No players assigned yet.";
      container.append(summary);
    }
  }

  function readTournamentSelectedPlayers(container) {
    return [...container.querySelectorAll('[data-tournament-player-option][aria-selected="true"]')]
      .map((option) => option.dataset.tournamentPlayerOption);
  }

  function selectTournamentPlayer(container, playerId) {
    const picker = container.querySelector("[data-tournament-player-picker]");
    if (!picker) return;
    picker.dataset.selectedPlayerId = playerId;
    const player = state.players.find((entry) => entry.id === playerId);
    picker.querySelector("[data-player-picker-toggle]").textContent = player?.name || "Choose a captain";
    picker.querySelectorAll("[data-tournament-player-option]").forEach((option) => {
      option.setAttribute("aria-selected", String(option.dataset.tournamentPlayerOption === playerId));
    });
  }

  function refreshTournamentCaptainAvailability() {
    const cards = [...$("#tournament-team-editor").querySelectorAll(".tournament-team-editor-card")];
    const selected = cards.map((card) =>
      card.querySelector("[data-tournament-captain-picker] [data-tournament-player-picker]").dataset.selectedPlayerId
    );
    cards.forEach((card, index) => {
      card.querySelectorAll("[data-tournament-player-option]").forEach((option) => {
        option.disabled = selected.some((playerId, otherIndex) =>
          otherIndex !== index && playerId === option.dataset.tournamentPlayerOption
        );
      });
    });
  }

  function renderTournamentEditor(teams) {
    const editor = $("#tournament-team-editor");
    editor.replaceChildren();
    const selectedCaptains = new Set(teams.map((team) => team.captainId).filter(Boolean));
    teams.forEach((team, index) => {
      const card = document.createElement("section");
      card.className = "tournament-team-editor-card";
      card.dataset.teamIndex = String(index);
      const heading = document.createElement("div");
      heading.className = "tournament-team-editor-card-heading";
      const title = document.createElement("h4");
      title.textContent = `Team ${index + 1}`;
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "text-button";
      remove.dataset.removeTournamentTeam = "";
      remove.textContent = "Remove team";
      remove.hidden = false;
      heading.append(title, remove);
      const nameLabel = document.createElement("label");
      nameLabel.className = "field-label";
      nameLabel.textContent = "Team name (optional)";
      const nameInput = document.createElement("input");
      nameInput.type = "text";
      nameInput.maxLength = 60;
      nameInput.value = team.name || "";
      nameInput.placeholder = team.captainId
        ? `${state.players.find((player) => player.id === team.captainId)?.name || "Captain"} Team`
        : "Defaults to the captain's name";
      nameInput.dataset.tournamentTeamName = "";
      nameLabel.append(nameInput);
      const captainLabel = document.createElement("label");
      captainLabel.className = "field-label";
      captainLabel.textContent = "Captain";
      const captainPicker = document.createElement("div");
      captainPicker.dataset.tournamentCaptainPicker = "";
      const assignedCaptains = new Set([...selectedCaptains].filter((id) => id !== team.captainId));
      createTournamentPlayerSearch(captainPicker, {
        players: state.players,
        selectedIds: team.captainId ? [team.captainId] : [],
        assignedIds: assignedCaptains,
        mode: "single",
        label: `Captain for team ${index + 1}`
      });
      captainLabel.append(captainPicker);
      const addPlayer = document.createElement("button");
      addPlayer.type = "button";
      addPlayer.className = "text-button tournament-add-roster-player";
      addPlayer.dataset.createTournamentPlayer = "setup";
      addPlayer.textContent = "＋ New roster player";
      card.append(heading, captainLabel, nameLabel, addPlayer);
      editor.append(card);
    });
  }

  function openTournamentDialog() {
    $("#tournament-error").hidden = true;
    $("#tournament-form").reset();
    $("#tournament-date").value = dateOffset(14);
    $("#tournament-due-date").value = dateOffset(7);
    $("#tournament-team-editor").replaceChildren();
    renderTournamentEditor([]);
    $("#tournament-dialog").showModal();
    $("#tournament-name").focus();
  }

  function openAddTournamentTeamDialog(tournamentId) {
    const tournament = state.tournaments.find((entry) => entry.id === tournamentId);
    if (!tournament) return;
    const form = $("#tournament-add-team-form");
    form.dataset.tournamentId = tournamentId;
    form.reset();
    $("#tournament-add-team-name").placeholder = "Defaults to the captain's name";
    $("#tournament-add-team-error").hidden = true;
    const assignedPlayers = new Set(tournament.teams.flatMap((team) => team.playerIds));
    createTournamentPlayerSearch($("#tournament-add-team-captain-picker"), {
      players: state.players,
      selectedIds: [],
      assignedIds: assignedPlayers,
      mode: "single",
      label: "Tournament team captain"
    });
    $("#tournament-add-team-price").textContent = money(tournament.amountCents / 100);
    $("#tournament-add-team-duedate").textContent = dateLabel(tournament.dueDate);
    $("#tournament-details-dialog").close();
    $("#tournament-add-team-dialog").showModal();
  }

  function openTournamentDetails(tournament) {
    $("#tournament-details-title").textContent = tournament.name;
    $("#tournament-details-meta").textContent =
      `${dateLabel(tournament.date)} · ${money(tournament.amountCents / 100)} per team · Captain invoices due ${dateLabel(tournament.dueDate)}`;
    const teams = $("#tournament-details-teams");
    teams.replaceChildren();
    $("#tournament-details-add-team").dataset.tournamentId = tournament.id;
    if (tournament.teams.length === 0) {
      const empty = document.createElement("p");
      empty.className = "tournament-details-empty";
      empty.textContent = "No teams yet. Add a team when you're ready.";
      teams.append(empty);
    }
    tournament.teams.forEach((team) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "tournament-details-team";
      button.dataset.viewTournamentTeam = team.id;
      button.dataset.tournamentId = tournament.id;
      const name = document.createElement("strong");
      name.textContent = team.name;
      const captain = state.players.find((player) => player.id === team.captainId);
      const invoice = state.invoices.find((entry) => entry.id === team.invoiceId);
      const captainLabel = document.createElement("span");
      captainLabel.textContent = `Captain: ${captain?.name || invoice?.playerName || "Former player"}`;
      const playerCount = document.createElement("small");
      playerCount.textContent = `${team.playerIds.length} player${team.playerIds.length === 1 ? "" : "s"} · ${money(tournament.amountCents / 100)} captain invoice`;
      button.append(name, captainLabel, playerCount);
      teams.append(button);
    });
    $("#tournament-details-dialog").showModal();
  }

  function openTournamentTeamDetails(tournamentId, teamId) {
    const tournament = state.tournaments.find((entry) => entry.id === tournamentId);
    const team = tournament?.teams.find((entry) => entry.id === teamId);
    if (!tournament || !team) return;
    const playerNameFor = (playerId) => state.players.find((player) => player.id === playerId)?.name ||
      [...state.rosterActivity].reverse().find((activity) => activity.playerId === playerId)?.playerName || "Former player";
    const invoiceStats = Core.getInvoiceStats(state, team.invoiceId);
    $("#tournament-team-title").textContent = team.name;
    $("#tournament-team-tournament").textContent =
      `${tournament.name} · ${dateLabel(tournament.date)}`;
    const summary = $("#tournament-team-summary");
    summary.replaceChildren();
    [
      ["Captain", playerNameFor(team.captainId)],
      ["Full team entry", money(tournament.amountCents / 100)],
      ["Captain invoice", invoiceStats.balanceCents > 0
        ? `${money(invoiceStats.balance)} outstanding · due ${dateLabel(tournament.dueDate)}`
        : "Paid in full"],
      ["Team entry charge for other players", "None"]
    ].forEach(([label, value]) => {
      const row = document.createElement("p");
      const key = document.createElement("strong");
      key.textContent = `${label}: `;
      row.append(key, document.createTextNode(value));
      summary.append(row);
    });
    const members = $("#tournament-team-members");
    members.replaceChildren();
    const heading = document.createElement("h3");
    heading.textContent = "Team roster";
    const list = document.createElement("ul");
    team.playerIds.forEach((playerId) => {
      const item = document.createElement("li");
      item.textContent = `${playerNameFor(playerId)}${playerId === team.captainId ? " · Captain" : ""}`;
      list.append(item);
    });
    members.append(heading, list);
    const payButton = $("#tournament-team-pay-button");
    payButton.hidden = invoiceStats.balanceCents <= 0;
    payButton.dataset.invoiceId = team.invoiceId;
    $("#tournament-team-edit-button").dataset.tournamentId = tournament.id;
    $("#tournament-team-edit-button").dataset.teamId = team.id;
    $("#tournament-team-dialog").showModal();
  }

  function openTournamentTeamEditor(tournamentId, teamId, addedPlayerId = null) {
    const tournament = state.tournaments.find((entry) => entry.id === tournamentId);
    const team = tournament?.teams.find((entry) => entry.id === teamId);
    if (!tournament || !team) return;
    $("#tournament-team-edit-form").dataset.tournamentId = tournamentId;
    $("#tournament-team-edit-form").dataset.teamId = teamId;
    $("#tournament-team-edit-error").hidden = true;
    $("#tournament-team-edit-name").value = team.name;
    const assignedElsewhere = new Set(tournament.teams
      .filter((entry) => entry.id !== team.id)
      .flatMap((entry) => entry.playerIds));
    createTournamentPlayerSearch($("#tournament-team-edit-players"), {
      players: state.players,
      selectedIds: addedPlayerId && !assignedElsewhere.has(addedPlayerId)
        ? [...team.playerIds, addedPlayerId]
        : team.playerIds,
      assignedIds: assignedElsewhere,
      lockedIds: new Set([team.captainId]),
      mode: "multiple",
      label: `Players on ${team.name}`
    });
    $("#tournament-team-dialog").close();
    $("#tournament-team-edit-dialog").showModal();
  }

  $("#create-tournament-button").addEventListener("click", openTournamentDialog);
  $("#home-create-tournament-button").addEventListener("click", openTournamentDialog);
  $("#tournament-team-pay-button").addEventListener("click", () => {
    const invoiceId = $("#tournament-team-pay-button").dataset.invoiceId;
    $("#tournament-team-dialog").close();
    openInvoicePaymentDialog(invoiceId);
  });
  $("#tournament-team-edit-button").addEventListener("click", () => {
    openTournamentTeamEditor(
      $("#tournament-team-edit-button").dataset.tournamentId,
      $("#tournament-team-edit-button").dataset.teamId
    );
  });
  $("#tournament-details-add-team").addEventListener("click", () => {
    openAddTournamentTeamDialog($("#tournament-details-add-team").dataset.tournamentId);
  });
  $("#tournament-add-team-dialog").addEventListener("click", (event) => {
    if (!event.target.closest('[data-create-tournament-player="add"]')) return;
    tournamentPlayerIntent = {
      surface: "add",
      tournamentId: $("#tournament-add-team-form").dataset.tournamentId
    };
    $("#tournament-add-team-dialog").close();
    openPlayerDialog();
  });
  $("#tournament-team-edit-dialog").addEventListener("click", (event) => {
    if (!event.target.closest('[data-create-tournament-player="edit"]')) return;
    tournamentPlayerIntent = {
      surface: "edit",
      tournamentId: $("#tournament-team-edit-form").dataset.tournamentId,
      teamId: $("#tournament-team-edit-form").dataset.teamId
    };
    $("#tournament-team-edit-dialog").close();
    openPlayerDialog();
  });
  $("#tournament-add-team-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const tournamentId = $("#tournament-add-team-form").dataset.tournamentId;
    let nextState;
    try {
      nextState = Core.addTournamentTeam(state, tournamentId, {
        id: createId(),
        invoiceId: createId(),
        captainId: $("#tournament-add-team-captain-picker [data-tournament-player-picker]").dataset.selectedPlayerId,
        name: $("#tournament-add-team-name").value,
        createdAt: new Date().toISOString()
      });
    } catch (error) {
      return showError("#tournament-add-team-error", error.message);
    }
    if (!await saveState(nextState)) return;
    state = nextState;
    $("#tournament-add-team-dialog").close();
    render();
    const tournament = state.tournaments.find((entry) => entry.id === tournamentId);
    if (tournament) openTournamentDetails(tournament);
  });
  document.addEventListener("input", (event) => {
    if (!event.target.matches(".tournament-player-picker .game-player-picker-search")) return;
    const picker = event.target.closest("[data-tournament-player-picker]");
    const query = event.target.value.trim().toLocaleLowerCase();
    let visibleCount = 0;
    picker.querySelectorAll("[data-tournament-player-option]").forEach((option) => {
      const matches = option.textContent.toLocaleLowerCase().includes(query);
      option.hidden = !matches;
      if (matches && !option.disabled) visibleCount += 1;
    });
    const empty = picker.querySelector(".game-player-picker-empty");
    empty.hidden = visibleCount > 0;
    empty.textContent = picker.querySelectorAll("[data-tournament-player-option]").length
      ? "No matching available players."
      : "Add players to the roster first.";
  });
  document.addEventListener("click", (event) => {
    if (!event.target.closest(".tournament-player-picker")) {
      document.querySelectorAll(".tournament-player-picker .game-player-picker-menu:not([hidden])")
        .forEach((menu) => {
          menu.hidden = true;
          menu.parentElement.querySelector("[data-player-picker-toggle]").setAttribute("aria-expanded", "false");
        });
    }
    const toggle = event.target.closest(".tournament-player-picker [data-player-picker-toggle]");
    if (toggle) {
      const picker = toggle.closest("[data-tournament-player-picker]");
      const menu = picker.querySelector(".game-player-picker-menu");
      const wasOpen = !menu.hidden;
      document.querySelectorAll(".tournament-player-picker .game-player-picker-menu:not([hidden])")
        .forEach((openMenu) => {
          openMenu.hidden = true;
          openMenu.parentElement.querySelector("[data-player-picker-toggle]").setAttribute("aria-expanded", "false");
        });
      if (!wasOpen) {
        menu.hidden = false;
        toggle.setAttribute("aria-expanded", "true");
        const search = picker.querySelector(".game-player-picker-search");
        search.value = "";
        search.dispatchEvent(new Event("input", { bubbles: true }));
        search.focus();
      }
      return;
    }
    const option = event.target.closest(".tournament-player-picker [data-tournament-player-option]");
    if (!option || option.disabled) return;
    const picker = option.closest("[data-tournament-player-picker]");
    if (picker.dataset.mode === "single") {
      selectTournamentPlayer(picker.parentElement, option.dataset.tournamentPlayerOption);
      picker.querySelector(".game-player-picker-menu").hidden = true;
      picker.querySelector("[data-player-picker-toggle]").setAttribute("aria-expanded", "false");
      if (picker.closest("#tournament-team-editor")) {
        const card = picker.closest(".tournament-team-editor-card");
        const name = card.querySelector("[data-tournament-team-name]");
        const player = state.players.find((entry) => entry.id === option.dataset.tournamentPlayerOption);
        if (!name.value.trim() && player) name.placeholder = `${player.name} Team`;
        refreshTournamentCaptainAvailability();
      }
      if (picker.closest("#tournament-add-team-captain-picker")) {
        const player = state.players.find((entry) => entry.id === option.dataset.tournamentPlayerOption);
        const name = $("#tournament-add-team-name");
        if (!name.value.trim() && player) name.placeholder = `${player.name} Team`;
      }
      return;
    }
    const nextSelected = option.getAttribute("aria-selected") !== "true";
    option.setAttribute("aria-selected", String(nextSelected));
    const selected = readTournamentSelectedPlayers(picker.parentElement);
    picker.querySelector("[data-player-picker-toggle]").textContent = selected.length
      ? `${selected.length} player${selected.length === 1 ? "" : "s"} selected`
      : "Choose players";
    picker.parentElement.querySelector(".tournament-selected-player-names").textContent = selected
      .map((playerId) => state.players.find((player) => player.id === playerId)?.name || "Former player")
      .join(", ") || "No players assigned yet.";
  });
  document.addEventListener("keydown", (event) => {
    const picker = event.target.closest?.(".tournament-player-picker");
    if (!picker) return;
    if (event.key === "Escape") {
      const menu = picker.querySelector(".game-player-picker-menu");
      if (menu.hidden) return;
      event.preventDefault();
      menu.hidden = true;
      picker.querySelector("[data-player-picker-toggle]").setAttribute("aria-expanded", "false");
      picker.querySelector("[data-player-picker-toggle]").focus();
    } else if ((event.key === "Enter" || event.key === "ArrowDown") &&
      event.target.matches(".game-player-picker-search")) {
      event.preventDefault();
      picker.querySelector("[data-tournament-player-option]:not([hidden]):not(:disabled)")?.focus();
    }
  });
  $("#tournament-team-edit-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    let nextState;
    try {
      nextState = Core.updateTournamentTeam(
        state,
        $("#tournament-team-edit-form").dataset.tournamentId,
        $("#tournament-team-edit-form").dataset.teamId,
        {
          name: $("#tournament-team-edit-name").value,
          playerIds: readTournamentSelectedPlayers($("#tournament-team-edit-players"))
        }
      );
    } catch (error) {
      return showError("#tournament-team-edit-error", error.message);
    }
    if (!await saveState(nextState)) return;
    state = nextState;
    $("#tournament-team-edit-dialog").close();
    render();
    openTournamentTeamDetails(
      $("#tournament-team-edit-form").dataset.tournamentId,
      $("#tournament-team-edit-form").dataset.teamId
    );
  });
  $("#tournament-list").addEventListener("click", (event) => {
    const button = event.target.closest("[data-view-tournament]");
    if (!button) return;
    const tournament = state.tournaments.find((entry) => entry.id === button.dataset.viewTournament);
    if (tournament) openTournamentDetails(tournament);
  });
  $("#tournament-details-teams").addEventListener("click", (event) => {
    const button = event.target.closest("[data-view-tournament-team]");
    if (!button) return;
    $("#tournament-details-dialog").close();
    openTournamentTeamDetails(button.dataset.tournamentId, button.dataset.viewTournamentTeam);
  });
  $("#add-tournament-team").addEventListener("click", () => {
    const teams = readTournamentEditorTeams();
    teams.push({ name: "", captainId: "", playerIds: [] });
    renderTournamentEditor(teams);
  });
  $("#tournament-team-editor").addEventListener("click", (event) => {
    const addPlayerButton = event.target.closest("[data-create-tournament-player]");
    if (addPlayerButton) {
      tournamentPlayerIntent = {
        surface: "setup",
        teamIndex: Number(addPlayerButton.closest(".tournament-team-editor-card").dataset.teamIndex)
      };
      $("#tournament-dialog").close();
      openPlayerDialog();
      return;
    }
    if (!event.target.closest("[data-remove-tournament-team]")) return;
    const teams = readTournamentEditorTeams();
    const card = event.target.closest(".tournament-team-editor-card");
    const index = [...$("#tournament-team-editor").children].indexOf(card);
    teams.splice(index, 1);
    renderTournamentEditor(teams);
  });
  $("#edit-fee-button").addEventListener("click", () => {
    $("#fee-error").hidden = true;
    $("#game-fee-amount").value = (Core.getSummary(state).gameFee).toFixed(2);
    $("#fee-dialog").showModal();
    $("#game-fee-amount").focus();
  });
  $("#create-invoice-button").addEventListener("click", openInvoiceDialog);
  $("#settings-menu-button").addEventListener("click", openSettingsMenu);
  $("#edit-group-name-button").addEventListener("click", () => {
    closeSettingsMenu();
    $("#group-name-error").hidden = true;
    $("#group-name-input").value = state.groupName;
    $("#group-name-dialog").showModal();
    $("#group-name-input").focus();
    $("#group-name-input").select();
  });
  $("#menu-sign-out-button").addEventListener("click", async () => {
    closeSettingsMenu();
    try {
      await firebaseAuth.signOut();
    } catch (error) {
      setSyncStatus("Sign-out failed", true);
      await showNotice(`Could not sign out. ${friendlyAuthError(error)}`, { title: "Sign-out failed" });
    }
  });
  document.addEventListener("click", (event) => {
    if (!event.target.closest(".settings-control")) closeSettingsMenu();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeSettingsMenu();
  });

  $("#today-label").textContent = new Intl.DateTimeFormat("en-US", {
    weekday: "short", month: "short", day: "numeric"
  }).format(new Date());
  $("#sign-in-tab").addEventListener("click", () => setAuthMode("signin"));
  $("#create-account-tab").addEventListener("click", () => setAuthMode("create"));
  $("#auth-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!firebaseAuth) return showAuthError("Firebase is not available. Check your connection and reload.");
    $("#auth-error").hidden = true;
    $("#auth-submit").disabled = true;
    const email = $("#auth-email").value.trim();
    const password = $("#auth-password").value;
    try {
      if (authMode === "create") {
        await firebaseAuth.createUserWithEmailAndPassword(email, password);
      } else {
        await firebaseAuth.signInWithEmailAndPassword(email, password);
      }
    } catch (error) {
      showAuthError(friendlyAuthError(error));
    } finally {
      $("#auth-submit").disabled = false;
    }
  });
  $("#group-setup-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    $("#group-setup-error").hidden = true;
    let newState;
    try {
      newState = Core.createGroupState($("#new-group-name").value, $("#new-group-fee").value);
    } catch (error) {
      return showError("#group-setup-error", error.message);
    }
    $("#create-group-submit").disabled = true;
    try {
      if (!currentUser || !firebaseStore) throw new Error("Sign in before creating a group.");
      await firebaseStore.create(currentUser, newState);
      activateGroup(currentUser, newState);
    } catch (error) {
      console.error("Could not create the group in Firebase.", error);
      if (error.code === "already-exists" && currentUser) {
        await loadUserData(currentUser);
      } else {
        showError("#group-setup-error", `Could not create your group. ${friendlyAuthError(error)}`);
      }
    } finally {
      $("#create-group-submit").disabled = false;
    }
  });
  $("#group-setup-sign-out").addEventListener("click", async () => {
    try {
      await firebaseAuth.signOut();
    } catch (error) {
      showError("#group-setup-error", `Could not sign out. ${friendlyAuthError(error)}`);
    }
  });
  $("#google-sign-in-button").addEventListener("click", async () => {
    if (!firebaseAuth) return showAuthError("Firebase is not available. Check your connection and reload.");
    $("#auth-error").hidden = true;
    $("#google-sign-in-button").disabled = true;
    try {
      await firebaseAuth.signInWithPopup(new firebase.auth.GoogleAuthProvider());
    } catch (error) {
      showAuthError(friendlyAuthError(error));
    } finally {
      $("#google-sign-in-button").disabled = false;
    }
  });
  $("#reset-password-button").addEventListener("click", async () => {
    if (!firebaseAuth) return showAuthError("Firebase is not available. Check your connection and reload.");
    const email = $("#auth-email").value.trim();
    if (!email) return showAuthError("Enter your email address first, then select Forgot password.");
    try {
      await firebaseAuth.sendPasswordResetEmail(email);
      showAuthError("Password reset email sent. Check your inbox.");
    } catch (error) {
      showAuthError(friendlyAuthError(error));
    }
  });
  $("#retry-load-button").addEventListener("click", () => {
    if (currentUser) loadUserData(currentUser);
  });
  $("#auth-sign-out-button").addEventListener("click", async () => {
    try {
      await firebaseAuth.signOut();
    } catch (error) {
      showAuthError(`Could not sign out. ${friendlyAuthError(error)}`);
    }
  });
  $("#sign-out-button").addEventListener("click", async () => {
    try {
      await firebaseAuth.signOut();
    } catch (error) {
      setSyncStatus("Sign-out failed", true);
      await showNotice(`Could not sign out. ${friendlyAuthError(error)}`, { title: "Sign-out failed" });
    }
  });
  $("#record-game-button").addEventListener("click", () => openGameDialog());
  $("#schedule-game-button").addEventListener("click", () => {
    openGameDialog(null, true);
  });
  $("#home-plan-game-button").addEventListener("click", () => openGameDialog(null, true));
  $("#add-player-button").addEventListener("click", openPlayerDialog);
  $("#main-content").addEventListener("click", (event) => {
    const button = event.target.closest("[data-dashboard-collapse]");
    if (!button) return;
    const section = button.dataset.dashboardCollapse;
    if (dashboardCollapsed.has(section)) dashboardCollapsed.delete(section);
    else dashboardCollapsed.add(section);
    updateDashboardCollapse("overview");
  });
  $("#main-content").addEventListener("click", (event) => {
    const panel = event.target.closest("[data-dashboard-view]");
    if (!panel || event.target.closest("button, a, input, select, textarea, summary")) return;
    window.location.hash = panel.dataset.dashboardView;
  });
  $("#empty-add-player").addEventListener("click", openPlayerDialog);
  $("#player-sort").addEventListener("change", () => {
    playerSort = $("#player-sort").value;
    renderPlayers();
  });
  $("#show-paid-column").addEventListener("change", renderPlayers);
  $("#show-extra-summary").addEventListener("change", (event) => {
    const showExtraSummary = event.target.checked;
    $("#players-summary-card").hidden = !showExtraSummary;
    $("#games-summary-card").hidden = !showExtraSummary;
  });
  $("#select-all-players").addEventListener("click", () => {
    const checkboxes = [...document.querySelectorAll("#player-rows [data-select-player]:not(:disabled)")];
    const shouldSelect = checkboxes.some((checkbox) => !selectedForBatch.has(checkbox.dataset.selectPlayer));
    checkboxes.forEach((checkbox) => {
      if (shouldSelect) selectedForBatch.add(checkbox.dataset.selectPlayer);
      else selectedForBatch.delete(checkbox.dataset.selectPlayer);
      checkbox.checked = shouldSelect;
    });
    updateBulkCollectControls();
  });
  $("#player-rows").addEventListener("change", (event) => {
    if (event.target.matches("[data-select-player]")) {
      if (event.target.checked) selectedForBatch.add(event.target.dataset.selectPlayer);
      else selectedForBatch.delete(event.target.dataset.selectPlayer);
      updateBulkCollectControls();
    }
  });
  $("#bulk-collect-button").addEventListener("click", async () => {
    const playerIds = [...selectedForBatch];
    if (!playerIds.length) return;
    let nextState = state;
    try {
      const createdAt = new Date().toISOString();
      for (const playerId of playerIds) {
        nextState = Core.recordGameFeePayment(nextState, {
          id: createId(), playerId, date: today(), createdAt
        });
      }
    } catch (error) {
      setSyncStatus("Payments not recorded", true);
      await showNotice(`Could not record the selected game-fee payments. ${error.message}`, {
        title: "Payments not recorded"
      });
      return;
    }
    if (!await saveState(nextState)) return;
    state = nextState;
    selectedForBatch.clear();
    render();
  });
  $("#payment-player-id").addEventListener("change", changePaymentPlayer);
  $("#payment-type").addEventListener("change", () => updatePaymentForm(true));
  $("#payment-invoice-id").addEventListener("change", updatePaymentForm);

  document.querySelectorAll("[data-close]").forEach((button) => {
    button.addEventListener("click", () => button.closest("dialog").close());
  });
  $("#notice-confirm").addEventListener("click", () => finishNotice(true));
  $("#notice-cancel").addEventListener("click", () => finishNotice(false));
  $("#notice-dialog").addEventListener("cancel", (event) => {
    event.preventDefault();
    finishNotice(false);
  });
  $("#notice-dialog").addEventListener("click", (event) => {
    if (event.target === $("#notice-dialog")) finishNotice(false);
  });

  $("#player-position-options").addEventListener("change", refreshPlayerPositionChoices);
  $("#player-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const addToGameTeam = gameEditorAddPlayerTeam;
    const addToTournament = tournamentPlayerIntent;
    let nextState;
    let addedPlayerId = null;
    try {
      const editPlayerId = $("#player-form").dataset.editPlayerId;
      const positions = {
        primaryPosition: $("#player-position-options").querySelector('input[name="primaryPosition"]:checked').value,
        secondaryPosition: $("#player-position-options").querySelector('input[name="secondaryPosition"]:checked').value
      };
      if (editPlayerId) {
        nextState = Core.renamePlayer(state, editPlayerId, $("#player-name").value, positions);
        const previousPlayer = state.players.find((player) => player.id === editPlayerId);
        const updatedPlayer = nextState.players.find((player) => player.id === editPlayerId);
        if (previousPlayer.name !== updatedPlayer.name) {
          nextState = Core.recordRosterActivity(nextState, {
            id: createId(),
            action: "renamed",
            playerId: updatedPlayer.id,
            playerName: updatedPlayer.name,
            previousName: previousPlayer.name,
            date: today(),
            createdAt: new Date().toISOString()
          });
        }
      } else {
        nextState = Core.addPlayer(state, {
          id: createId(), name: $("#player-name").value, ...positions
        });
        const addedPlayer = nextState.players[nextState.players.length - 1];
        addedPlayerId = addedPlayer.id;
        nextState = Core.recordRosterActivity(nextState, {
          id: createId(),
          action: "added",
          playerId: addedPlayer.id,
          playerName: addedPlayer.name,
          date: today(),
          createdAt: new Date().toISOString()
        });
      }
    } catch (error) {
      return showError("#player-error", error.message);
    }
    if (!await saveState(nextState)) return;
    gameEditorAddPlayerTeam = null;
    tournamentPlayerIntent = null;
    state = nextState;
    $("#player-dialog").close();
    render();
    if (addToGameTeam !== null && addedPlayerId && $("#game-dialog").open) {
      const assignments = readGameTeamAssignments();
      assignments[addToGameTeam].push({
        playerId: addedPlayerId,
        position: getPreferredGamePosition(addedPlayerId)
      });
      const game = state.games.find((entry) => entry.id === $("#game-form").dataset.gameId);
      renderGameTeams(assignments, game);
    }
    if (addToTournament && addedPlayerId) {
      if (addToTournament.surface === "setup") {
        const teams = readTournamentEditorTeams();
        teams[addToTournament.teamIndex].captainId = addedPlayerId;
        renderTournamentEditor(teams);
        $("#tournament-dialog").showModal();
      } else if (addToTournament.surface === "add") {
        openAddTournamentTeamDialog(addToTournament.tournamentId);
        selectTournamentPlayer($("#tournament-add-team-captain-picker"), addedPlayerId);
        const player = state.players.find((entry) => entry.id === addedPlayerId);
        $("#tournament-add-team-name").placeholder = `${player.name} Team`;
      } else if (addToTournament.surface === "edit") {
        openTournamentTeamEditor(addToTournament.tournamentId, addToTournament.teamId, addedPlayerId);
      }
    }
  });
  $("#player-dialog").addEventListener("close", () => {
    gameEditorAddPlayerTeam = null;
    tournamentPlayerIntent = null;
  });

  $("#fee-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    let nextState;
    try {
      nextState = Core.setGameFee(state, $("#game-fee-amount").value);
    } catch (error) {
      return showError("#fee-error", error.message);
    }
    if (!await saveState(nextState)) return;
    state = nextState;
    $("#fee-dialog").close();
    render();
  });

  $("#group-name-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    let nextState;
    try {
      nextState = Core.setGroupName(state, $("#group-name-input").value);
    } catch (error) {
      return showError("#group-name-error", error.message);
    }
    if (!await saveState(nextState)) return;
    state = nextState;
    $("#group-name-dialog").close();
    render();
  });

  $("#invoice-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    let nextState;
    try {
      nextState = Core.createInvoice(state, {
        id: createId(),
        playerId: $("#invoice-player").value,
        category: $("#invoice-category").value,
        name: $("#invoice-name").value,
        amount: $("#invoice-amount").value,
        dueDate: $("#invoice-due-date").value,
        description: $("#invoice-description").value,
        date: today(),
        createdAt: new Date().toISOString()
      });
    } catch (error) {
      return showError("#invoice-error", error.message);
    }
    if (!await saveState(nextState)) return;
    state = nextState;
    $("#invoice-dialog").close();
    render();
  });

  $("#tournament-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    let nextState;
    try {
      const timestamp = new Date().toISOString();
      const teams = readTournamentEditorTeams().map((team) => ({
        ...team,
        id: createId(),
        invoiceId: createId()
      }));
      nextState = Core.createTournament(state, {
        id: createId(),
        name: $("#tournament-name").value,
        date: $("#tournament-date").value,
        dueDate: $("#tournament-due-date").value,
        amount: $("#tournament-amount").value,
        teams,
        createdAt: timestamp
      });
    } catch (error) {
      return showError("#tournament-error", error.message);
    }
    if (!await saveState(nextState)) return;
    state = nextState;
    $("#tournament-dialog").close();
    render();
  });

  $("#game-team-lists").addEventListener("input", (event) => {
    if (!event.target.matches(".game-player-picker-search")) return;
    const picker = event.target.closest("[data-player-picker]");
    const query = event.target.value.trim().toLocaleLowerCase();
    let visibleCount = 0;
    picker.querySelectorAll("[data-player-option]").forEach((option) => {
      const matches = option.textContent.toLocaleLowerCase().includes(query);
      option.hidden = !matches;
      if (matches) visibleCount += 1;
    });
    picker.querySelector(".game-player-picker-empty").hidden = visibleCount > 0;
  });
  document.addEventListener("click", (event) => {
    if (event.target.closest(".game-player-picker")) return;
    document.querySelectorAll("#game-team-lists .game-player-picker-menu:not([hidden])").forEach((menu) => {
      menu.hidden = true;
      menu.parentElement.querySelector("[data-player-picker-toggle]").setAttribute("aria-expanded", "false");
    });
  });
  $("#game-team-lists").addEventListener("keydown", (event) => {
    if (event.key === "Escape" && event.target.closest("[data-player-picker]")) {
      event.preventDefault();
      const picker = event.target.closest("[data-player-picker]");
      picker.querySelector(".game-player-picker-menu").hidden = true;
      picker.querySelector("[data-player-picker-toggle]").setAttribute("aria-expanded", "false");
      picker.querySelector("[data-player-picker-toggle]").focus();
    }
    if ((event.key === "Enter" || event.key === "ArrowDown") &&
      event.target.matches(".game-player-picker-search")) {
      event.preventDefault();
      const firstOption = event.target.closest("[data-player-picker]")
        .querySelector("[data-player-option]:not([hidden]):not(:disabled)");
      if (firstOption) firstOption.focus();
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      const currentOption = event.target.closest("[data-player-option]");
      if (!currentOption) return;
      event.preventDefault();
      const options = [...currentOption.closest(".game-player-picker-options")
        .querySelectorAll("[data-player-option]:not([hidden]):not(:disabled)")];
      const currentIndex = options.indexOf(currentOption);
      const nextIndex = event.key === "ArrowDown"
        ? (currentIndex + 1) % options.length
        : (currentIndex - 1 + options.length) % options.length;
      options[nextIndex]?.focus();
    }
  });
  $("#game-team-lists").addEventListener("click", (event) => {
    const toggle = event.target.closest("[data-player-picker-toggle]");
    const option = event.target.closest("[data-player-option]");
    if (toggle) {
      const picker = toggle.closest("[data-player-picker]");
      const wasOpen = !picker.querySelector(".game-player-picker-menu").hidden;
      document.querySelectorAll("#game-team-lists .game-player-picker-menu").forEach((menu) => {
        menu.hidden = true;
        menu.parentElement.querySelector("[data-player-picker-toggle]").setAttribute("aria-expanded", "false");
      });
      if (!wasOpen) {
        const menu = picker.querySelector(".game-player-picker-menu");
        menu.hidden = false;
        toggle.setAttribute("aria-expanded", "true");
        const search = picker.querySelector(".game-player-picker-search");
        search.value = "";
        search.dispatchEvent(new Event("input", { bubbles: true }));
        search.focus();
      }
      return;
    }
    if (option) {
      const picker = option.closest("[data-player-picker]");
      const assignments = readGameTeamAssignments();
      const teamIndex = Number(picker.dataset.teamPlayer);
      const assignmentIndex = Number(picker.dataset.assignmentIndex);
      const selectedPlayerId = option.dataset.playerOption;
      assignments[teamIndex][assignmentIndex] = {
        playerId: selectedPlayerId,
        position: getPreferredGamePosition(selectedPlayerId)
      };
      const game = state.games.find((entry) => entry.id === $("#game-form").dataset.gameId);
      renderGameTeams(assignments, game);
      const nextPicker = $("#game-team-lists").querySelector(
        `[data-team-player="${teamIndex}"][data-assignment-index="${assignmentIndex}"] [data-player-picker-toggle]`
      );
      nextPicker?.focus();
      return;
    }
    const addRosterButton = event.target.closest("[data-add-roster-player]");
    const addButton = event.target.closest("[data-add-team-player]");
    const removeButton = event.target.closest("[data-remove-team-player]");
    if (addRosterButton) {
      tournamentPlayerIntent = null;
      gameEditorAddPlayerTeam = Number(addRosterButton.dataset.addRosterPlayer);
      openPlayerDialog();
      return;
    }
    if (!addButton && !removeButton) return;
    const assignments = readGameTeamAssignments();
    const teamIndex = Number((addButton || removeButton).dataset.addTeamPlayer ??
      (addButton || removeButton).dataset.removeTeamPlayer);
    if (removeButton) {
      const row = removeButton.closest(".game-team-player");
      const rows = [...removeButton.closest(".game-team-rows").querySelectorAll(".game-team-player")];
      assignments[teamIndex].splice(rows.indexOf(row), 1);
    } else {
      assignments[teamIndex].push({ playerId: "", position: "" });
    }
    const game = state.games.find((entry) => entry.id === $("#game-form").dataset.gameId);
    renderGameTeams(assignments, game);
  });

  $("#game-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    let nextState;
    try {
      const date = $("#game-date").value;
      const assignments = showGameTeamAssignmentsError();
      const teams = assignments.map((teamAssignments, index) => ({
        name: `Team ${index + 1}`,
        playerIds: teamAssignments.filter((assignment) => assignment.playerId).map((assignment) => assignment.playerId),
        positions: teamAssignments.filter((assignment) => assignment.playerId && assignment.position).map((assignment) => ({
          playerId: assignment.playerId,
          position: assignment.position
        }))
      }));
      const playerIds = teams.flatMap((team) => team.playerIds);
      const gameId = $("#game-form").dataset.gameId;
      nextState = gameId
        ? Core.updateGame(state, gameId, { date, playerIds, feeAmount: $("#game-fee-override").value, teams })
        : Core.recordGame(state, {
          id: createId(), date, playerIds, feeAmount: $("#game-fee-override").value,
          createdAt: new Date().toISOString(), teams
        });
    } catch (error) {
      return showError("#game-error", error.message);
    }
    if (!await saveState(nextState)) return;
    state = nextState;
    $("#game-dialog").close();
    render();
  });

  $("#game-fee-override").addEventListener("input", () => {
    const fee = $("#game-fee-override").value;
    if (fee === "") {
      $("#game-fee-note").textContent = money(Core.getSummary(state).gameFee);
      return;
    }
    const amount = Number(fee);
    if (Number.isFinite(amount) && amount >= 0 && amount <= 10000) {
      $("#game-fee-note").textContent = money(amount);
    }
  });

  $("#payment-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    let nextState;
    try {
      const playerId = $("#payment-player-id").value;
      const amount = Number($("#payment-amount").value);
      const paymentId = $("#payment-form").dataset.editPaymentId;
      const invoiceId = $("#payment-type").value === "invoice" ? $("#payment-invoice-id").value : null;
      nextState = paymentId
        ? Core.updatePayment(state, paymentId, { playerId, amount, date: $("#payment-date").value, invoiceId })
        : Core.recordPayment(state, {
          id: createId(),
          playerId,
          amount,
          date: $("#payment-date").value,
          invoiceId: invoiceId || null,
          createdAt: new Date().toISOString()
        });
    } catch (error) {
      const invoiceId = $("#payment-type").value === "invoice" ? $("#payment-invoice-id").value : null;
      const balance = invoiceId
        ? Core.getInvoiceStats(state, invoiceId).balance
        : playerStats($("#payment-player-id").value).gameBalance;
      const message = error.message === "Payment can't exceed the outstanding balance."
        ? `Payment can't exceed the current balance of ${money(balance)}.`
        : error.message;
      return showError("#payment-error", message);
    }
    if (!await saveState(nextState)) return;
    state = nextState;
    $("#payment-dialog").close();
    render();
  });

  $("#activity-list").addEventListener("click", async (event) => {
    const editButton = event.target.closest("[data-edit-payment]");
    if (editButton) {
      const payment = state.payments.find((entry) => entry.id === editButton.dataset.editPayment);
      if (payment) openPaymentDialog(payment.playerId, payment.invoiceId, payment.id);
      return;
    }
    const removeButton = event.target.closest("[data-remove-payment]");
    if (removeButton) {
      const payment = state.payments.find((entry) => entry.id === removeButton.dataset.removePayment);
      if (!payment || !await showNotice(
        `Delete this ${money(payment.amount)} payment? The amount will be added back to the player's balance.`,
        { title: "Delete payment?", confirm: true, confirmLabel: "Delete payment", destructive: true }
      )) return;
      let nextState;
      try {
        nextState = Core.removePayment(state, payment.id);
      } catch (error) {
        setSyncStatus("Payment not deleted", true);
        await showNotice(`Could not delete this payment. ${error.message}`, { title: "Payment not deleted" });
        return;
      }
      if (!await saveState(nextState)) return;
      state = nextState;
      render();
      return;
    }
    const activityItem = event.target.closest("[data-activity-detail]");
    if (activityItem) {
      const entry = activityEntries().find((candidate) => candidate.id === activityItem.dataset.activityDetail);
      if (entry) showActivityDetails(entry);
    }
  });
  $("#player-rows").addEventListener("click", async (event) => {
    const clickedElement = event.target instanceof Element ? event.target : null;
    if (clickedElement && !clickedElement.closest("button, input, select, a, label")) {
      const row = clickedElement.closest("tr");
      const checkbox = row?.querySelector("[data-select-player]");
      if (checkbox && !checkbox.disabled) {
        checkbox.checked = !checkbox.checked;
        if (checkbox.checked) selectedForBatch.add(checkbox.dataset.selectPlayer);
        else selectedForBatch.delete(checkbox.dataset.selectPlayer);
        updateBulkCollectControls();
        return;
      }
    }
    const paymentButton = event.target.closest("[data-record-payment]");
    if (paymentButton) return openPaymentDialog(paymentButton.dataset.recordPayment);
    const editButton = event.target.closest("[data-edit-player]");
    if (editButton) {
      const player = state.players.find((candidate) => candidate.id === editButton.dataset.editPlayer);
      if (player) openEditPlayerDialog(player);
      return;
    }
    const removeButton = event.target.closest("[data-remove]");
    if (!removeButton) return;
    const player = state.players.find((candidate) => candidate.id === removeButton.dataset.remove);
    if (!player) return;
    const stats = playerStats(player.id);
    const hasHistory = stats.plays > 0 || stats.paid > 0;
    const confirmation = hasHistory
      ? `Remove ${player.name} from the roster? Their game, payment, and invoice history will remain, but future games will not include them.`
      : `Remove ${player.name} from the roster?`;
    if (!await showNotice(confirmation, {
      title: `Delete ${player.name}?`,
      confirm: true,
      confirmLabel: "Delete player",
      destructive: true
    })) return;
    let nextState = Core.removePlayer(state, player.id);
    nextState = Core.recordRosterActivity(nextState, {
      id: createId(),
      action: "removed",
      playerId: player.id,
      playerName: player.name,
      date: today(),
      createdAt: new Date().toISOString()
    });
    if (!await saveState(nextState)) return;
    state = nextState;
    render();
  });

  $("#invoice-list").addEventListener("click", (event) => {
    const payButton = event.target.closest("[data-invoice-pay]");
    if (payButton) openInvoicePaymentDialog(payButton.dataset.invoicePay);
  });
  $("#tournament-list").addEventListener("click", (event) => {
    const payButton = event.target.closest("[data-tournament-invoice-pay]");
    if (payButton) {
      event.stopPropagation();
      openInvoicePaymentDialog(payButton.dataset.tournamentInvoicePay);
      return;
    }
    const teamButton = event.target.closest("[data-view-tournament-team]");
    if (teamButton) {
      openTournamentTeamDetails(teamButton.dataset.tournamentId, teamButton.dataset.viewTournamentTeam);
    }
  });

  $("#activity-toggle").addEventListener("click", () => {
    renderActivity($("#activity-toggle").dataset.showAll !== "true");
  });
  $("#calendar-previous").addEventListener("click", () => {
    calendarMonth = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() - 1, 1);
    renderCalendar();
  });
  $("#calendar-next").addEventListener("click", () => {
    calendarMonth = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 1);
    renderCalendar();
  });
  $("#calendar-grid").addEventListener("click", (event) => {
    const tournamentButton = event.target.closest("[data-calendar-tournament]");
    if (tournamentButton) {
      const tournament = state.tournaments.find((entry) => entry.id === tournamentButton.dataset.calendarTournament);
      if (tournament) openTournamentDetails(tournament);
      return;
    }
    const gameButton = event.target.closest("[data-calendar-game]");
    if (gameButton) {
      const game = state.games.find((entry) => entry.id === gameButton.dataset.calendarGame);
      if (game) openGameDialog(game);
      return;
    }
    const cell = event.target.closest("[data-calendar-date]");
    if (!cell) return;
    const date = cell.dataset.calendarDate;
    openGameDialog(null, date > today(), date);
  });
  $("#upcoming-games").addEventListener("click", (event) => {
    const button = event.target.closest("[data-edit-game]");
    const game = button && state.games.find((entry) => entry.id === button.dataset.editGame);
    if (game) openGameDialog(game);
  });
  $("#home-upcoming-games").addEventListener("click", (event) => {
    const button = event.target.closest("[data-home-add-players]");
    const game = button && state.games.find((entry) => entry.id === button.dataset.homeAddPlayers);
    if (game) openGameDialog(game);
  });
  $("#home-upcoming-tournaments").addEventListener("click", (event) => {
    const button = event.target.closest("[data-home-view-tournament]");
    const tournament = button && state.tournaments.find((entry) => entry.id === button.dataset.homeViewTournament);
    if (tournament) openTournamentDetails(tournament);
  });
  $("#previous-games").addEventListener("click", (event) => {
    const button = event.target.closest("[data-edit-game]");
    const game = button && state.games.find((entry) => entry.id === button.dataset.editGame);
    if (game) openGameDialog(game);
  });
  window.addEventListener("hashchange", syncViewFromHash);
  syncViewFromHash();
  initializeFirebase();
})();

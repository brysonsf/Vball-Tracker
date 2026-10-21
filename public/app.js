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
  const selectedForBatch = new Set();

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
      window.alert(`Your change could not be saved to Firebase. ${friendlyAuthError(error)}`);
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
    tbody.replaceChildren();
    $("#players-empty").hidden = state.players.length > 0;
    $("table").hidden = state.players.length === 0;
    $("#roster-count").parentElement.hidden = state.players.length === 0;

    const payableIds = new Set(state.players.filter((player) => {
      const stats = playerStats(player.id);
      return stats.gameBalance > 0 && state.gameFeeCents > 0;
    }).map((player) => player.id));
    [...selectedForBatch].forEach((playerId) => {
      if (!payableIds.has(playerId)) selectedForBatch.delete(playerId);
    });
    Core.sortPlayers(state, playerSort).forEach((player) => {
      const stats = playerStats(player.id);
      const row = document.createElement("tr");
      const playerCell = document.createElement("td");
      playerCell.dataset.label = "Player";
      playerCell.innerHTML = `<div class="player-cell">${avatarMarkup(player)}<span><span class="player-name"></span><span class="player-subtitle"></span></span></div>`;
      const selectCheckbox = document.createElement("input");
      selectCheckbox.type = "checkbox";
      selectCheckbox.dataset.selectPlayer = player.id;
      selectCheckbox.setAttribute("aria-label", `Select ${player.name} for batch game-fee collection`);
      selectCheckbox.disabled = stats.gameBalance <= 0 || state.gameFeeCents <= 0;
      selectCheckbox.checked = selectedForBatch.has(player.id);
      playerCell.querySelector(".player-cell").prepend(selectCheckbox);
      playerCell.querySelector(".player-name").textContent = player.name;
      playerCell.querySelector(".player-subtitle").textContent = stats.plays ? `${stats.plays} game${stats.plays === 1 ? "" : "s"} logged` : "New to the roster";

      const playedCell = document.createElement("td");
      playedCell.dataset.label = "Played";
      playedCell.innerHTML = `<span class="played-count">${stats.plays}</span>`;
      const paidCell = document.createElement("td");
      paidCell.dataset.label = "Paid";
      paidCell.textContent = money(stats.paid);
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
      const moreButton = document.createElement("button");
      moreButton.className = "more-button";
      moreButton.dataset.remove = player.id;
      moreButton.setAttribute("aria-label", `Remove ${player.name}`);
      moreButton.title = `Remove ${player.name}`;
      moreButton.textContent = "···";
      const editButton = document.createElement("button");
      editButton.className = "edit-player-button";
      editButton.dataset.editPlayer = player.id;
      editButton.setAttribute("aria-label", `Edit ${player.name}`);
      editButton.title = `Edit ${player.name}`;
      editButton.textContent = "Edit";
      actions.append(editButton, moreButton);
      actionCell.append(actions);
      row.append(playerCell, playedCell, paidCell, balanceCell, actionCell);
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
      const icon = document.createElement("span");
      icon.className = `activity-icon ${entry.type}`;
      icon.setAttribute("aria-hidden", "true");
      icon.textContent = entry.type === "game" ? "⌁" : "$";
      const text = document.createElement("div");
      text.className = "activity-text";
      const description = document.createElement("div");
      if (entry.type === "game") {
        const lead = document.createElement("strong");
        lead.textContent = "Game night";
        description.append(lead, document.createTextNode(` · ${entry.playerIds.length} player${entry.playerIds.length === 1 ? "" : "s"} played`));
      } else if (entry.type === "invoice") {
        const lead = document.createElement("strong");
        lead.textContent = entry.name;
        description.append(lead, document.createTextNode(` · invoice for ${money(entry.amountCents / 100)}`));
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
      item.append(icon, text);
      if (entry.type === "payment") {
        const amount = document.createElement("span");
        amount.className = "activity-amount";
        amount.textContent = `+${money(entry.amount)}`;
        item.append(amount);
      }
      list.append(item);
    });
    const toggle = $("#activity-toggle");
    toggle.hidden = entries.length <= 5;
    toggle.innerHTML = showAll ? 'Show recent activity <span aria-hidden="true">↑</span>' : 'Show all activity <span aria-hidden="true">→</span>';
    toggle.dataset.showAll = String(showAll);
  }

  function render() {
    renderStats();
    renderPlayers();
    renderInvoices();
    renderActivity();
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
    $("#player-dialog").showModal();
    $("#player-name").focus();
  }

  function openEditPlayerDialog(player) {
    $("#player-error").hidden = true;
    $("#player-form").dataset.editPlayerId = player.id;
    $("#player-name").value = player.name;
    $("#player-dialog-title").textContent = "Edit player";
    $("#player-dialog-submit").textContent = "Save changes";
    $("#player-dialog").showModal();
    $("#player-name").focus();
    $("#player-name").select();
  }

  function openGameDialog() {
    $("#game-error").hidden = true;
    $("#game-date").value = today();
    $("#game-fee-override").value = "";
    $("#game-default-fee").textContent = money(Core.getSummary(state).gameFee);
    $("#game-fee-note").textContent = money(Core.getSummary(state).gameFee);
    const list = $("#game-player-list");
    list.replaceChildren();
    if (state.players.length === 0) {
      const empty = document.createElement("div");
      empty.className = "no-players";
      empty.textContent = "Add players to your roster before logging a game.";
      list.append(empty);
    } else {
      state.players.forEach((player) => {
        const label = document.createElement("label");
        label.className = "check-row";
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.name = "playerIds";
        checkbox.value = player.id;
        const name = document.createElement("span");
        name.className = "check-name";
        name.textContent = player.name;
        label.append(checkbox, avatarElement(player), name);
        list.append(label);
      });
    }
    $("#game-dialog").showModal();
    $("#game-date").focus();
  }

  function updatePaymentForm() {
    const playerId = $("#payment-player-id").value;
    const player = state.players.find((candidate) => candidate.id === playerId);
    const stats = player ? playerStats(playerId) : { gameBalanceCents: 0 };
    const isInvoicePayment = $("#payment-type").value === "invoice";
    $("#payment-invoice-field").hidden = !isInvoicePayment;
    const invoice = isInvoicePayment
      ? state.invoices.find((candidate) => candidate.id === $("#payment-invoice-id").value && candidate.playerId === playerId)
      : null;
    if (!player && !invoice) return;
    $("#payment-title").textContent = `Payment from ${player ? player.name : invoice.playerName}`;
    const balanceCents = invoice ? Core.getInvoiceStats(state, invoice.id).balanceCents : stats.gameBalanceCents;
    const defaultAmountCents = Math.min(
      state.gameFeeCents > 0 ? state.gameFeeCents : balanceCents,
      balanceCents
    );
    $("#payment-amount").max = String(Math.max(balanceCents, 0) / 100);
    $("#payment-amount").value = (defaultAmountCents / 100).toFixed(2);
    $("#payment-context").textContent = invoice
      ? `${invoice.name} · ${money(balanceCents / 100)} remaining. Edit the amount for a partial or full payment.`
      : `Game dues: ${money(balanceCents / 100)} remaining. Edit the amount for a partial or full payment.`;
  }

  function openPaymentDialog(playerId, invoiceId = null) {
    const player = state.players.find((candidate) => candidate.id === playerId);
    const unpaidInvoices = state.invoices.filter((invoice) =>
      invoice.playerId === playerId && Core.getInvoiceStats(state, invoice.id).balanceCents > 0);
    if (!player && !unpaidInvoices.length) return;
    const stats = player ? playerStats(playerId) : { gameBalanceCents: 0 };
    $("#payment-error").hidden = true;
    $("#payment-form").reset();
    $("#payment-player-id").value = playerId;
    const invoiceSelect = $("#payment-invoice-id");
    invoiceSelect.replaceChildren();
    unpaidInvoices.forEach((invoice) => {
      const option = document.createElement("option");
      option.value = invoice.id;
      option.textContent = `${invoice.name} · ${money(Core.getInvoiceStats(state, invoice.id).balance)}`;
      invoiceSelect.append(option);
    });
    const selectedInvoice = unpaidInvoices.find((invoice) => invoice.id === invoiceId) || unpaidInvoices[0];
    invoiceSelect.value = selectedInvoice ? selectedInvoice.id : "";
    const typeSelect = $("#payment-type");
    typeSelect.querySelector('option[value="game"]').disabled = stats.gameBalanceCents <= 0;
    typeSelect.querySelector('option[value="invoice"]').disabled = unpaidInvoices.length === 0;
    typeSelect.value = invoiceId || stats.gameBalanceCents <= 0 ? "invoice" : "game";
    if (!unpaidInvoices.length && stats.gameBalanceCents <= 0) return;
    updatePaymentForm();
    $("#payment-dialog").showModal();
    $("#payment-amount").focus();
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
      window.alert(`Could not sign out. ${friendlyAuthError(error)}`);
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
      window.alert(`Could not sign out. ${friendlyAuthError(error)}`);
    }
  });
  $("#record-game-button").addEventListener("click", openGameDialog);
  $("#add-player-button").addEventListener("click", openPlayerDialog);
  $("#empty-add-player").addEventListener("click", openPlayerDialog);
  $("#player-sort").addEventListener("change", () => {
    playerSort = $("#player-sort").value;
    renderPlayers();
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
      window.alert(`Could not record the selected game-fee payments. ${error.message}`);
      return;
    }
    if (!await saveState(nextState)) return;
    state = nextState;
    selectedForBatch.clear();
    render();
  });
  $("#payment-type").addEventListener("change", updatePaymentForm);
  $("#payment-invoice-id").addEventListener("change", updatePaymentForm);

  document.querySelectorAll("[data-close]").forEach((button) => {
    button.addEventListener("click", () => button.closest("dialog").close());
  });

  $("#player-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    let nextState;
    try {
      const editPlayerId = $("#player-form").dataset.editPlayerId;
      nextState = editPlayerId
        ? Core.renamePlayer(state, editPlayerId, $("#player-name").value)
        : Core.addPlayer(state, { id: createId(), name: $("#player-name").value });
    } catch (error) {
      return showError("#player-error", error.message);
    }
    if (!await saveState(nextState)) return;
    state = nextState;
    $("#player-dialog").close();
    render();
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

  $("#select-all-button").addEventListener("click", () => {
    const boxes = [...document.querySelectorAll('#game-player-list input[type="checkbox"]')];
    const select = boxes.some((box) => !box.checked);
    boxes.forEach((box) => { box.checked = select; });
    $("#select-all-button").textContent = select ? "Deselect all" : "Select all";
  });

  $("#game-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    let nextState;
    try {
      const date = $("#game-date").value;
      const playerIds = [...document.querySelectorAll('#game-player-list input[type="checkbox"]:checked')].map((box) => box.value);
      nextState = Core.recordGame(state, {
        id: createId(), date, playerIds, feeAmount: $("#game-fee-override").value, createdAt: new Date().toISOString()
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
      const invoiceId = $("#payment-type").value === "invoice" ? $("#payment-invoice-id").value : null;
      nextState = Core.recordPayment(state, {
        id: createId(),
        playerId,
        amount,
        date: today(),
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
    if (!window.confirm(confirmation)) return;
    const nextState = Core.removePlayer(state, player.id);
    if (!await saveState(nextState)) return;
    state = nextState;
    render();
  });

  $("#invoice-list").addEventListener("click", (event) => {
    const payButton = event.target.closest("[data-invoice-pay]");
    if (payButton) openInvoicePaymentDialog(payButton.dataset.invoicePay);
  });

  $("#activity-toggle").addEventListener("click", () => {
    renderActivity($("#activity-toggle").dataset.showAll !== "true");
  });
  document.querySelectorAll(".sidebar nav .nav-link").forEach((link) => {
    link.addEventListener("click", () => {
      document.querySelectorAll(".sidebar nav .nav-link").forEach((item) => item.classList.remove("active"));
      link.classList.add("active");
    });
  });
  initializeFirebase();
})();

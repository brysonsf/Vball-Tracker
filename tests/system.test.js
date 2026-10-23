const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const publicDir = path.join(root, "public");
const read = (file) => fs.readFileSync(path.join(publicDir, file), "utf8");

test("the page loads the shared domain core before the browser application", () => {
  const html = read("index.html");
  const firebaseApp = html.indexOf("firebase-app-compat.js");
  const firebaseAuth = html.indexOf("firebase-auth-compat.js");
  const firebaseFirestore = html.indexOf("firebase-firestore-compat.js");
  const firebaseConfig = html.indexOf('src="firebase-config.js"');
  const core = html.indexOf('src="tracker-core.js"');
  const firebaseStore = html.indexOf('src="firebase-store.js"');
  const app = html.indexOf('src="app.js"');

  assert.ok(firebaseApp < firebaseAuth && firebaseAuth < firebaseFirestore);
  assert.ok(firebaseFirestore < firebaseConfig && firebaseConfig < core && core < firebaseStore);
  assert.ok(firebaseStore < app);
  assert.notEqual(core, -1, "tracker-core.js must be included");
  assert.notEqual(app, -1, "app.js must be included");
  assert.ok(core < app, "the core must load before the app");
});

test("browser scripts have valid JavaScript syntax", () => {
  const vm = require("node:vm");
  for (const file of ["tracker-core.js", "firebase-store.js", "app.js"]) {
    assert.doesNotThrow(() => new vm.Script(read(file)), `${file} should parse`);
  }
});

test("the application delegates dues, payment, and game calculations to tested core functions", () => {
  const app = read("app.js");

  for (const functionName of ["getPlayerStats", "getSummary", "addPlayer", "recordGame", "recordPayment", "removePlayer"]) {
    assert.match(app, new RegExp(`Core\\.${functionName}\\(`), `app.js should call Core.${functionName}`);
  }
  assert.match(app, /summary\.owed > 0/);
  assert.match(app, /const invoiceId = \$\("#payment-type"\)\.value === "invoice" \? \$\("#payment-invoice-id"\)\.value : null/);
  assert.doesNotMatch(app, /crypto\.randomUUID/);
  assert.match(app, /const createId = \(\) => Core\.createId\(window\.crypto\)/);
  assert.equal((app.match(/id: createId\(\)/g) || []).length, 8);
  assert.match(app, /id: createId\(\), name:/);
});

test("activity items open accessible detail views for games and roster changes", () => {
  const html = read("index.html");
  const app = read("app.js");
  const core = read("tracker-core.js");

  assert.match(html, /id="activity-detail-dialog"/);
  assert.match(html, /Games, roster changes, and payments/);
  assert.match(app, /detailButton\.dataset\.activityDetail = entry\.id/);
  assert.match(app, /function showActivityDetails\(entry\)/);
  assert.match(app, /Core\.recordRosterActivity\(nextState/);
  assert.match(core, /state\.rosterActivity\.map/);
});

test("navigation selects reusable overview, roster, and isolated activity views", () => {
  const html = read("index.html");
  const app = read("app.js");
  const css = read("styles.css");

  assert.match(html, /href="#activity" data-view-link="activity"/);
  assert.match(html, /data-view-section="overview activity"/);
  assert.match(app, /const views = \{/);
  assert.match(app, /sections: \["activity"\]/);
  assert.match(app, /function setActiveView\(viewName\)/);
  assert.match(app, /window\.addEventListener\("hashchange", syncViewFromHash\)/);
  assert.match(css, /\.main-content\[data-view-layout="single"\] \.content-grid/);
  assert.match(css, /\.main-content \[data-view-section\]\[hidden\] \{ display: none !important;/);
});

test("calendar view renders recorded games by date and opens game details", () => {
  const html = read("index.html");
  const app = read("app.js");
  const css = read("styles.css");

  assert.match(html, /href="#calendar" data-view-link="calendar"/);
  assert.match(html, /data-view-section="calendar"/);
  assert.match(html, /id="calendar-grid" role="grid"/);
  assert.match(app, /calendar: \{[\s\S]*?sections: \["calendar"\]/);
  assert.match(app, /state\.games\.forEach\(\(game\) => \{[\s\S]*?gamesByDate\.set\(game\.date/);
  assert.match(app, /cell\.dataset\.calendarDate = date/);
  assert.match(app, /data-calendar-game/);
  assert.match(app, /tooltip\.textContent = playerNames\.join\(", "\)/);
  assert.match(app, /aria-label",\s*`View game on \$\{dateLabelText\(date\)\} with \$\{game\.playerIds\.length\} players: \$\{playerNames\.join\(", "\)\}`/);
  assert.match(css, /\.calendar-game:hover \.calendar-game-tooltip, \.calendar-game:focus-visible \.calendar-game-tooltip/);
  assert.match(html, /id="calendar-previous"/);
  assert.match(html, /id="calendar-next"/);
  assert.match(app, /if \(game\) openGameDialog\(game\)/);
  assert.match(app, /openGameDialog\(null, date > today\(\), date\)/);
  assert.match(app, /function openGameDialog\(game = null, scheduled = false, gameDate = null\)/);
  assert.match(app, /\$\("#record-game-button"\)\.addEventListener\("click", \(\) => openGameDialog\(\)\)/);
  assert.match(css, /\.calendar-grid \{ display: grid; grid-template-columns: repeat\(7/);
});

test("games view lists planned and previous games and opens a two-team position editor", () => {
  const html = read("index.html");
  const app = read("app.js");
  const core = read("tracker-core.js");
  const css = read("styles.css");

  assert.match(html, /href="#games" data-view-link="games"/);
  assert.match(html, /id="upcoming-games"/);
  assert.match(html, /id="home-upcoming-games"/);
  assert.match(html, /id="home-plan-game-button"/);
  assert.match(html, /can be saved without players; add them later from the dashboard/);
  assert.match(html, /id="previous-games"/);
  assert.match(html, /id="game-team-lists"/);
  assert.match(app, /addButton\.dataset\.addTeamPlayer/);
  assert.match(app, /addRosterButton\.dataset\.addRosterPlayer/);
  assert.match(app, /assignments\[addToGameTeam\]\.push/);
  assert.match(app, /picker\.dataset\.playerId = assignment\.playerId \|\| ""/);
  assert.match(app, /className = "game-player-picker-search"/);
  assert.match(app, /className = "game-player-picker-option"/);
  assert.match(app, /assignments\[teamIndex\]\[assignmentIndex\]\.playerId = option\.dataset\.playerOption/);
  assert.match(app, /className = "game-player-picker-options"/);
  assert.match(app, /className = "game-player-picker-search"/);
  assert.match(app, /event\.key === "ArrowDown" \|\| event\.key === "ArrowUp"/);
  assert.match(css, /\.game-player-picker-menu/);
  assert.match(css, /\.game-editor-dialog \{[^}]*resize: both[^}]*width: min\(1600px/);
  assert.match(css, /\.game-editor-dialog \{ height: auto; min-height: 0; min-width: 0; resize: none; \}/);
  assert.match(app, /positionSelect\.dataset\.teamPosition/);
  assert.match(app, /Position \(optional\)/);
  assert.match(html, /Planned games do not add dues until their date/);
  assert.match(app, /games: \{[\s\S]*?sections: \["games"\]/);
  assert.match(app, /function renderGames\(\)/);
  assert.match(app, /addPlayersButton\.dataset\.homeAddPlayers = game\.id/);
  assert.match(app, /\$\("#home-upcoming-games"\)\.addEventListener\("click"/);
  assert.match(app, /function openGameDialog\(game = null, scheduled = false, gameDate = null\)/);
  assert.match(app, /Core\.updateGame\(state, gameId/);
  assert.match(app, /Core\.recordGame\(state,[\s\S]*?teams/);
  assert.match(app, /function isPlannedGame\(game\)/);
  assert.match(app, /if \(game\) openGameDialog\(game\)/);
  assert.match(core, /function updateGame\(state, gameId/);
  assert.match(core, /game\.date <= currentDate\(\)/);
  assert.match(css, /\.game-card/);
  assert.match(css, /\.game-team-lists \{ display: grid; gap: 12px; grid-template-columns: repeat\(2/);
  assert.match(css, /\.game-team-player/);
  for (const position of ["Setter", "Left", "Right", "Middle"]) assert.match(core, new RegExp(`"${position}"`));
});

test("roster rows provide an edit action for names and preferred positions", () => {
  const app = read("app.js");
  const core = read("tracker-core.js");
  const html = read("index.html");

  assert.match(app, /editButton\.dataset\.editPlayer = player\.id/);
  assert.match(app, /Core\.renamePlayer\(state, editPlayerId, \$\("#player-name"\)\.value, positions\)/);
  assert.match(app, /data-edit-player/);
  assert.match(core, /function renamePlayer\(state, playerId, name, positions\)/);
  assert.match(html, /id="player-dialog-title"/);
  assert.match(html, /id="player-dialog-submit"/);
  assert.match(html, /id="player-position-options"/);
  assert.match(app, /player\.positions \|\| \[\]/);
});

test("player balance table exposes sorting and uses batch controls for game-fee collection", () => {
  const html = read("index.html");
  const app = read("app.js");
  const core = read("tracker-core.js");

  assert.match(html, /id="player-sort"/);
  assert.match(html, /value="balance"/);
  assert.match(html, /value="recent">Recent attendees/);
  assert.match(app, /Core\.sortPlayers\(state, playerSort\)/);
  assert.doesNotMatch(app, /collectButton\.dataset\.collectGameFee = player\.id/);
  assert.doesNotMatch(app, /event\.target\.closest\("\[data-collect-game-fee\]"\)/);
  assert.match(app, /clickedElement\.closest\("button, input, select, a, label"\)/);
  assert.match(app, /checkbox\.checked = !checkbox\.checked/);
  assert.match(app, /Core\.recordGameFeePayment\(nextState/);
  assert.match(core, /function sortPlayers\(state, sortBy = "name"\)/);
  assert.match(core, /function recordGameFeePayment\(state/);
});

test("player balance payments can select invoices and collect one fee for multiple players", () => {
  const html = read("index.html");
  const app = read("app.js");

  assert.match(html, /id="payment-type"/);
  assert.match(html, /id="payment-invoice-id" name="invoiceId"/);
  assert.match(html, /id="select-all-players"/);
  assert.match(html, /id="bulk-collect-button"/);
  assert.match(app, /selectedForBatch/);
  assert.match(app, /Core\.getInvoiceStats\(state, invoice\.id\)\.balanceCents > 0/);
  assert.match(app, /Core\.recordPayment\(state,[\s\S]*invoiceId: invoiceId \|\| null/);
  assert.match(app, /selectedForBatch/);
  assert.match(app, /Collect one fee each/);
});

test("payment activity exposes correction and deletion controls with editable payment details", () => {
  const html = read("index.html");
  const app = read("app.js");
  const css = read("styles.css");

  assert.match(html, /id="payment-date" name="date"/);
  assert.match(html, /id="payment-player-id" name="playerId"/);
  assert.match(app, /Core\.updatePayment\(state, paymentId/);
  assert.match(app, /Core\.removePayment\(state, payment\.id\)/);
  assert.match(app, /data-edit-payment/);
  assert.match(app, /data-remove-payment/);
  assert.match(css, /\.activity-actions/);
});

test("roster delete action is represented by a trash icon instead of an ambiguous menu", () => {
  const app = read("app.js");
  const css = read("styles.css");

  assert.match(app, /delete-player-button/);
  assert.match(app, /deleteIcon\.setAttribute\("viewBox"/);
  assert.match(app, /Delete \$\{player\.name\}/);
  assert.match(css, /\.delete-player-button/);
  assert.doesNotMatch(app, /moreButton\.textContent = "···"/);
});

test("alerts and confirmations use the styled accessible notice dialog", () => {
  const html = read("index.html");
  const app = read("app.js");
  const css = read("styles.css");

  assert.match(html, /<dialog id="notice-dialog" class="notice-dialog"/);
  assert.match(html, /id="notice-message"/);
  assert.match(app, /function showNotice\(message, options = \{\}\)/);
  assert.match(app, /await showNotice\(/);
  assert.match(app, /finishNotice\(false\)/);
  assert.doesNotMatch(app, /window\.(alert|confirm)\(/);
  assert.match(css, /\.notice-dialog::backdrop/);
  assert.match(css, /\.button-danger/);
});

test("mobile payment activity keeps edit controls visible and touch friendly", () => {
  const css = read("styles.css");

  assert.match(css, /@media \(max-width: 620px\)[\s\S]*?\.activity-item \{ display: grid;/);
  assert.match(css, /\.activity-text \{ grid-column: 2; min-width: 0;/);
  assert.match(css, /\.activity-actions button \{ min-height: 36px; min-width: 48px;/);
});

test("player balance display has green, red, and high-severity states", () => {
  const app = read("app.js");
  const core = read("tracker-core.js");
  const css = read("styles.css");

  assert.match(app, /Core\.getBalanceSeverity\(state, player\.id\)/);
  assert.match(app, /3\+ fees due/);
  assert.match(app, /1–3 fees due/);
  assert.match(core, /balanceCents <= state\.gameFeeCents \* 3/);
  assert.match(css, /\.balance-chip\.clear/);
  assert.match(css, /\.balance-chip\.overdue/);
  assert.match(css, /\.balance-chip\.severe/);
});

test("the configurable default game fee is represented once in the core and shown in the page", () => {
  const core = read("tracker-core.js");
  const html = read("index.html");

  assert.match(core, /const DEFAULT_RATE_CENTS = 500/);
  assert.match(html, /id="game-fee-label"/);
  assert.match(html, /id="sidebar-fee-label"/);
  assert.match(html, /id="game-rate-footer"/);
  assert.match(html, /id="edit-fee-button"/);
});

test("game form offers an optional per-session fee override that is saved with the game", () => {
  const html = read("index.html");
  const app = read("app.js");
  const core = read("tracker-core.js");

  assert.match(html, /id="game-fee-override"[^>]*type="number"[^>]*max="10000"/);
  assert.match(html, /Leave blank to use the group’s default fee/);
  assert.match(app, /feeAmount: \$\("#game-fee-override"\)\.value/);
  assert.match(core, /function recordGame\(state, \{ id, date, playerIds, feeAmount, createdAt, teams = \[\] \}\)/);
});

test("group settings are available from the top bar and render the saved group name", () => {
  const html = read("index.html");
  const app = read("app.js");
  const core = read("tracker-core.js");

  assert.match(html, /id="settings-menu-button"[^>]*aria-haspopup="menu"/);
  assert.match(html, /id="edit-group-name-button"/);
  assert.match(html, /id="group-name-form"/);
  assert.match(html, /id="sidebar-group-name"/);
  assert.match(html, /id="breadcrumb-group-name"/);
  assert.match(app, /Core\.setGroupName\(state, \$\("#group-name-input"\)\.value\)/);
  assert.match(app, /firebaseStore\.save\(currentUser, nextState\)/);
  assert.match(core, /groupName: DEFAULT_GROUP_NAME/);
  assert.match(core, /state\.groupName = state\.groupName === undefined \? DEFAULT_GROUP_NAME/);
  assert.match(read("styles.css"), /\.settings-menu/);
});

test("first-time group setup asks for a name and default fee after authentication", () => {
  const html = read("index.html");
  const app = read("app.js");
  const store = read("firebase-store.js");

  assert.match(html, /id="group-setup-screen"/);
  assert.match(html, /id="new-group-name"[^>]*required/);
  assert.match(html, /id="new-group-fee"[^>]*value="5\.00"/);
  assert.match(app, /Core\.createGroupState\(\$\("#new-group-name"\)\.value, \$\("#new-group-fee"\)\.value\)/);
  assert.match(app, /firebaseStore\.create\(currentUser, newState\)/);
  assert.match(store, /if \(savedLocalData === null\) return null/);
  assert.match(store, /runTransaction/);
});

test("invoice UI collects a named reason, type, amount, player, and due date", () => {
  const html = read("index.html");

  for (const id of ["invoice-player", "invoice-category", "invoice-name", "invoice-amount", "invoice-due-date", "invoice-description"]) {
    assert.match(html, new RegExp(`id="${id}"`), `${id} should be present`);
  }
  assert.match(html, /id="create-invoice-button"/);
  assert.match(html, /id="invoice-list"/);
  assert.match(html, /id="payment-invoice-id"/);
});

test("the page includes accessible labels and live validation messages for its forms", () => {
  const html = read("index.html");

  assert.match(html, /aria-label="Main navigation"/);
  assert.match(html, /for="player-name"/);
  assert.match(html, /for="game-date"/);
  assert.match(html, /for="payment-amount"/);
  assert.match(html, /role="alert"/);
});

test("modal windows receive focus and do not dismiss when the backdrop is clicked", () => {
  const app = read("app.js");
  assert.match(app, /\$\("#game-dialog"\)\.showModal\(\);\s*\$\("#game-date"\)\.focus\(\);/);
  assert.match(app, /querySelectorAll\("\[data-close\]"\)/);
  assert.doesNotMatch(app, /event\.target === dialog\) dialog\.close\(\)/);
});

test("responsive styles include phone navigation, safe-area padding, and stacked player cards", () => {
  const html = read("index.html");
  const css = read("styles.css");

  assert.match(html, /name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"/);
  assert.match(css, /@media \(max-width: 620px\)/);
  assert.match(css, /position: fixed/);
  assert.match(css, /env\(safe-area-inset-bottom\)/);
  assert.match(css, /input, select, textarea \{ font-size: 16px; \}/);
  assert.match(css, /tbody tr \{[^}]*display: grid/s);
});

test("all local application files referenced by the page exist", () => {
  const html = read("index.html");
  const references = [...html.matchAll(/(?:src|href)="([^"]+\.(?:js|css))"/g)]
    .map((match) => match[1])
    .filter((reference) => !reference.startsWith("https://"));

  assert.ok(references.length >= 5);
  references.forEach((reference) => assert.ok(fs.existsSync(path.join(publicDir, reference)), `${reference} should exist`));
});

test("Wrangler serves only the public directory, not the repository or node_modules", () => {
  const configText = fs.readFileSync(path.join(root, "wrangler.jsonc"), "utf8");
  const config = JSON.parse(configText);

  assert.equal(config.assets.directory, "./public");
  assert.ok(fs.existsSync(path.join(publicDir, "index.html")));
});

test("authentication UI provides sign-in, account creation, Google, reset, and recovery controls", () => {
  const html = read("index.html");
  const app = read("app.js");

  for (const id of ["auth-form", "sign-in-tab", "create-account-tab", "google-sign-in-button",
    "reset-password-button", "retry-load-button", "auth-sign-out-button", "sign-out-button"]) {
    assert.match(html, new RegExp(`id="${id}"`), `${id} should be present`);
  }
  assert.match(app, /createUserWithEmailAndPassword/);
  assert.match(app, /signInWithEmailAndPassword/);
  assert.match(app, /signInWithPopup/);
  assert.match(app, /sendPasswordResetEmail/);
});

test("the UI waits for authentication and has explicit cloud save/load and sync error behavior", () => {
  const app = read("app.js");

  assert.match(app, /onAuthStateChanged/);
  assert.match(app, /firebaseStore\.load\(user\)/);
  assert.match(app, /firebaseStore\.save\(currentUser, nextState\)/);
  assert.match(app, /firebaseStore\.watch\(user/);
  assert.match(app, /Could not save volleyball tracker data to Firebase/);
});

test("Firestore rules restrict the tracker document to its matching signed-in UID", () => {
  const rules = fs.readFileSync(path.join(root, "firestore.rules"), "utf8");

  assert.match(rules, /match \/users\/\{userId\}\/tracker\/\{documentId\}/);
  assert.match(rules, /request\.auth != null/);
  assert.match(rules, /request\.auth\.uid == userId/);
  assert.match(rules, /documentId == "current"/);
});

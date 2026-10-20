const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

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

test("the application delegates dues, payment, and game calculations to tested core functions", () => {
  const app = read("app.js");

  for (const functionName of ["getPlayerStats", "getSummary", "addPlayer", "recordGame", "recordPayment", "removePlayer"]) {
    assert.match(app, new RegExp(`Core\\.${functionName}\\(`), `app.js should call Core.${functionName}`);
  }
  assert.match(app, /summary\.owed > 0/);
  assert.match(app, /invoiceId: \$\("#payment-invoice-id"\)\.value \|\| null/);
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

test("responsive styles include phone navigation, safe-area padding, and stacked player cards", () => {
  const css = read("styles.css");

  assert.match(css, /@media \(max-width: 620px\)/);
  assert.match(css, /position: fixed/);
  assert.match(css, /env\(safe-area-inset-bottom\)/);
  assert.match(css, /tbody tr \{[^}]*display: grid/s);
});

test("all local application files referenced by the page exist", () => {
  const html = read("index.html");
  const references = [...html.matchAll(/(?:src|href)="([^"]+\.(?:js|css))"/g)]
    .map((match) => match[1])
    .filter((reference) => !reference.startsWith("https://"));

  assert.ok(references.length >= 5);
  references.forEach((reference) => assert.ok(fs.existsSync(path.join(root, reference)), `${reference} should exist`));
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
  const rules = read("firestore.rules");

  assert.match(rules, /match \/users\/\{userId\}\/tracker\/\{documentId\}/);
  assert.match(rules, /request\.auth != null/);
  assert.match(rules, /request\.auth\.uid == userId/);
  assert.match(rules, /documentId == "current"/);
});

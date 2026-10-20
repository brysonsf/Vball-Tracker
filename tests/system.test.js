const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("the page loads the shared domain core before the browser application", () => {
  const html = read("index.html");
  const core = html.indexOf('src="tracker-core.js"');
  const app = html.indexOf('src="app.js"');

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
  const references = [...html.matchAll(/(?:src|href)="([^"]+\.(?:js|css))"/g)].map((match) => match[1]);

  assert.ok(references.length >= 3);
  references.forEach((reference) => assert.ok(fs.existsSync(path.join(root, reference)), `${reference} should exist`));
});

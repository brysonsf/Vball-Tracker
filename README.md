# Setlist
Vibe coded for the love of the game (and the occasional spreadsheet-free Tuesday).

A simple volleyball dues tracker: add your crew, log who played, and keep tabs on payments. The default game fee is **$5 per player per game** and can be changed in the app.

## Get started

Open `index.html` in a modern browser. No build step, dependencies, or account required.

## Using it

1. **Add players** to your roster.
2. **Set the game fee** with “Change game fee.” The current fee is captured when you record each game, so updating it won’t change past sessions.
3. **Record a game**, choose its date, and select who played. Each selected player is charged the current game fee.
4. **Create an invoice** for an individual player when they owe a separate amount. Add a type, name, amount, due date, and description; record invoice payments separately from game dues.
5. Check the dashboard for total collected, outstanding balances, player balances, invoices, and recent activity.

The layout adapts to mobile, with bottom navigation and touch-friendly controls.

## Data and limitations

Your roster, games, invoices, and payments are saved in this browser’s local storage. They stay on this device and browser profile; there’s no shared account, cloud sync, or built-in backup/export. Clearing browser data can erase them.

The default game rate is set in `tracker-core.js` and can be changed in the app. New games use the current rate; games already recorded keep the rate they were logged with. One-off player invoices can include a type, name, amount, due date, and description. Invoice payments are kept separate from game-dues payments.

## Tests

Requires Node.js 18 or newer; no packages need to be installed.

```sh
npm test
```

The test suite uses Node's built-in test runner. It has no test framework or browser-driver dependencies.

| Scope | Command | What it covers |
| --- | --- | --- |
| Unit | `npm run test:unit` | Empty state; player name and ID validation; real calendar dates; duplicate and out-of-roster attendance; immutable updates; configurable fee snapshots; cent rounding; dues, invoices, and summaries; payment allocation; invoice ownership; activity ordering; state integrity. |
| Integration | `npm run test:integration` | Empty local storage; legacy-data migration; JSON parse and schema failures; storage write errors; save/reload round trips; mixed game/invoice payment persistence; history surviving player removal. |
| System | `npm run test:system` | Script load order; the UI calling the shared production core; dynamic fee and invoice controls; invoice payment wiring; form labels and alert roles; mobile navigation and stacked roster styles; local asset references. |
| Acceptance | `npm run test:acceptance` | Organizer workflows: create a roster, record attendance, make partial/full payments, reopen saved data, change future fees, and charge/pay a separate team-expense invoice. |

Run an individual scope with its command above, or run all scopes with `npm test`. Test files are in `tests/`.

System tests are dependency-free wiring and responsive-style smoke checks, not automated browser screenshots. For a release, also exercise the app in target desktop/mobile browsers, including native date/number controls and dialogs.

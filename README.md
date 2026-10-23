# Setlist
Vibe coded for the love of the game (and the occasional spreadsheet-free Tuesday).

A simple volleyball dues tracker: add your crew, log who played, and keep tabs on payments. The default game fee is **$5 per player per game** and can be changed in the app.

## Get started

The app uses Firebase Authentication and Cloud Firestore in the browser. It needs an internet connection and must be served from an HTTP(S) origin; opening `index.html` as a `file://` URL will not support Firebase sign-in.

1. In the Firebase console for the configured `setlist-volleyball-manager` project, enable **Email/Password** and **Google** under **Authentication → Sign-in method**.
2. Create a **Cloud Firestore** database.
3. Publish the rules in [`firestore.rules`](./firestore.rules). In the console, open **Firestore Database → Rules**, replace the starter rules with this file, and publish. Alternatively, deploy with Firebase CLI after selecting the project: `firebase deploy --only firestore:rules`.
4. Add `localhost` and the production site hostname to **Authentication → Settings → Authorized domains**. Google sign-in also needs the OAuth consent/support email configured in Firebase/Google Cloud.
5. Run `npm run preview` to test the Worker locally. For deployment, run `npm run deploy`; Wrangler uses [`wrangler.jsonc`](./wrangler.jsonc) and publishes only `public/`.

The Firebase web config is in [`public/firebase-config.js`](./public/firebase-config.js). It is browser-visible client configuration, not a service-account secret. Never put a service-account key or private key in this app.

## Accounts and data

Create an organizer account with email/password or use Google sign-in. Password reset is available from the sign-in screen. After authentication, a new account is prompted to create its group by entering a group name and default per-player game fee (pre-filled as $5). Each account has one private group document at `users/{uid}/tracker/current`; the Firestore rules allow only that signed-in UID to read and write it. This app does not currently support multiple groups per account or sharing a group between accounts.

On first sign-in, if this browser has existing local tracker data and the account has no cloud document, the app imports it into that account instead of creating a new group. The local copy is removed only after Firebase confirms the import was saved. Returning accounts load from Firestore, which syncs updates between their signed-in devices. Internet access is needed to sign in and save; a failed save is reported and the in-memory change is not applied.

## Using it

1. **Create a group** by entering its name and default fee after signing in. The default fee starts at $5 and can be changed later.
2. **Add players** to your roster and set their primary and optional secondary position: Setter, Left, Right, or Middle. Their color-coded position profile appears in its own roster column and can be updated with **Edit**. Sort the roster by name, position group, balance, or most recent attendance; optionally show each player's total paid. When you select a player for a game, their primary position is filled in automatically (or their secondary position if no primary is set); you can still change the game-specific assignment. Use **Edit** beside a player to correct their name later; this keeps their existing games, payments, and invoices attached to the same player. Use the trash-can button to delete a player from the active roster without erasing their history. Balances are green at zero, red when up to three default game fees are due, and a stronger warning above three fees; invoice balances count toward these indicators. Select multiple players by tapping their row or checkbox, then choose **Collect one fee each** to record a game-fee payment for each selected player.
3. **Set the game fee** with “Change game fee.” The current fee is captured when you record each game, so updating it won’t change past sessions.
4. **Record or plan a game** from the dashboard or Games tab. “Record a game” keeps the quick flow for a game today; use “Plan a game” to choose a future date. A future game can be saved with no players, then gradually filled in from the dashboard with its “Add players” button. In the game editor, **New roster player** creates and assigns someone directly to that team; **Add player** adds a row for someone already on the roster. Assign players to either of two side-by-side teams and optionally select their position (setter, left, right, or middle) in the game dialog. The position choices appear once each; a full six-player lineup has one setter, two lefts, one right, and two middles. Future-dated games do not add dues until their date; they automatically move into previous games on that date. Select games in the Games tab, Calendar, or activity feed to edit their date, fee, teams, and positions.
5. **Record a payment** from a player balance. Choose game dues or an unpaid invoice, then accept the suggested one-game-fee amount or enter a different amount. Invoice payments are applied only to the selected invoice; payments cannot exceed the amount outstanding in that category. Use **Edit** or **Delete** beside a payment in recent activity to correct its player, amount, date, or allocation, or remove it; the updated balance is saved with the group.
6. **Create an invoice** for an individual player when they owe a separate amount. Add a type, name, amount, due date, and description; record invoice payments separately from game dues.
7. **Set up a tournament** from the Tournaments tab. Enter the event name, date, invoice due date, and team entry amount. Add teams and choose a captain for each; no team name or player roster is required at setup. The team name defaults to “{Captain’s Name} Team.” Creating the tournament issues one lump-sum invoice for the full team entry amount to each captain. Open a team and choose **Edit roster** to assign teammates later; they are included without an additional tournament entry charge. Captains' invoices can be paid from the tournament page or the regular invoice list. Tournaments also appear on the calendar on their event date. A player can only be assigned to one team in the same tournament.
8. Use the settings menu (`···`) in the top bar to rename the group. The name is saved with the group data and syncs across signed-in devices. The menu is available on both desktop and mobile.
9. Use the **Overview**, **Players**, **Games**, **Tournaments**, **Calendar**, and **Activity** navigation tabs to switch between the dashboard and isolated views. The Games tab lists planned and previous games; the Calendar shows games by date. Select a game in either view to edit teams and game details. The view registry composes pages from reusable sections so additional user-specific layouts can be added later. Recent activity includes games, roster additions/renames/removals, invoices, and payments. Select an activity item to open its details; use **Show all activity** to browse older items. Player balances are shown prominently above the payment summary.

The layout adapts to mobile, with bottom navigation and touch-friendly controls.

## Data and limitations

Your roster, games, tournaments, invoices, payments, and roster activity history are stored in Firestore under the organizer’s account. Tournament team assignments and captain invoices are stored with the group. There is no built-in backup/export or multi-account group sharing. The app saves the group as one Firestore document, so keep its history within Firestore's 1 MiB per-document size limit.

New groups use the name and default game rate entered during setup. Existing saved data without a group name keeps working and starts with the legacy name “Wednesday night.” The chosen name and rate are stored alongside the tracker data. The group default can be changed in the app, or overridden for an individual game; each game stores its own rate, so later changes do not alter recorded games. One-off player invoices can include a type, name, amount, due date, and description. Tournament setup creates one full team-entry invoice for each designated captain. Invoice payments are kept separate from game-dues payments.

## Tests

Requires Node.js 18 or newer; no test packages need to be installed.

```sh
npm test
```

The test suite uses Node's built-in test runner. It has no test framework or browser-driver dependencies.

| Scope | Command | What it covers |
| --- | --- | --- |
| Unit | `npm run test:unit` | Empty state; group name and default-fee validation; player add/rename validation and history retention; balance severity including invoice balances; name/balance/recent-attendance sorting; one-game-fee collection; custom partial invoice payments; correcting and deleting payments; player ID validation; real calendar dates; duplicate and out-of-roster attendance; immutable updates; default and per-game fee snapshots; fee validation; cent rounding; dues, invoices, and summaries; payment allocation; invoice ownership; activity ordering; state integrity. |
| Integration | `npm run test:integration` | Local-storage legacy migration; first group creation and duplicate protection; Firebase owner-scoped reads/writes, live snapshots, auth guards, and account isolation; preservation of imported group settings; malformed data; mixed game/invoice payment persistence; corrected/deleted payment persistence; history surviving player removal. Firebase is mocked for repeatable offline tests. |
| System | `npm run test:system` | Firebase SDK load order; auth UI and first-group setup flows; UID-restricted Firestore rules; cloud load/save/sync wiring; tested production core; player sorting, one-tap and batch game-fee collection, invoice-aware player payments, and payment correction controls; default and per-game fee controls; invoice controls; responsive UI requirements; public asset paths; Wrangler asset-directory configuration. |
| Acceptance | `npm run test:acceptance` | Organizer workflows: create a named group with a chosen default fee, create and rename players while preserving history, sort balances and collect fees for one or multiple players, make custom invoice payments, correct and remove recorded payments, record games with default or one-off fees, make partial/full payments, reopen saved data, change future defaults, and charge/pay a separate team-expense invoice. |

Run an individual scope with its command above, or run all scopes with `npm test`. Test files are in `tests/`.

System tests are dependency-free wiring and responsive-style smoke checks, not automated browser screenshots. For a release, also exercise the app in target desktop/mobile browsers, including native date/number controls and dialogs.

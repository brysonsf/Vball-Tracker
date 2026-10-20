# Sideout
Vibe coded for the love of the game (and the occasional spreadsheet-free Tuesday).

A simple volleyball dues tracker: add your crew, log who played, and keep tabs on payments. The default game fee is **$5 per player per game** and can be changed in the app.

## Get started

The app uses Firebase Authentication and Cloud Firestore in the browser. It needs an internet connection and must be served from an HTTP(S) origin; opening `index.html` as a `file://` URL will not support Firebase sign-in.

1. In the Firebase console for the configured `setlist-volleyball-manager` project, enable **Email/Password** and **Google** under **Authentication → Sign-in method**.
2. Create a **Cloud Firestore** database.
3. Publish the rules in [`firestore.rules`](./firestore.rules). In the console, open **Firestore Database → Rules**, replace the starter rules with this file, and publish. Alternatively, deploy with Firebase CLI after selecting the project: `firebase deploy --only firestore:rules`.
4. Add `localhost` and the production site hostname to **Authentication → Settings → Authorized domains**. Google sign-in also needs the OAuth consent/support email configured in Firebase/Google Cloud.
5. Serve the folder locally, for example `python -m http.server 8000`, then visit `http://localhost:8000`. For production, deploy the static files to an HTTPS host and add its hostname to the authorized domains.

The Firebase web config is in [`firebase-config.js`](./firebase-config.js). It is browser-visible client configuration, not a service-account secret. Never put a service-account key or private key in this app.

## Accounts and data

Create an organizer account with email/password or use Google sign-in. Password reset is available from the sign-in screen. Each account has a private group document at `users/{uid}/tracker/current`; the Firestore rules allow only that signed-in UID to read and write it. Accounts do not share a group or data with each other.

On first sign-in, if this browser has existing local tracker data and the account has no cloud document, the app imports it into that account. The local copy is removed only after Firebase confirms the import was saved. Returning accounts load from Firestore, which syncs updates between their signed-in devices. Internet access is needed to sign in and save; a failed save is reported and the in-memory change is not applied.

## Using it

1. **Add players** to your roster.
2. **Set the game fee** with “Change game fee.” The current fee is captured when you record each game, so updating it won’t change past sessions.
3. **Record a game**, choose its date, and select who played. Each selected player is charged the current game fee.
4. **Create an invoice** for an individual player when they owe a separate amount. Add a type, name, amount, due date, and description; record invoice payments separately from game dues.
5. Check the dashboard for total collected, outstanding balances, player balances, invoices, and recent activity.

The layout adapts to mobile, with bottom navigation and touch-friendly controls.

## Data and limitations

Your roster, games, invoices, and payments are stored in Firestore under the organizer’s account. There is no built-in backup/export or multi-account group sharing. The app saves the group as one Firestore document, so keep its history within Firestore's 1 MiB per-document size limit.

The default game rate is set in `tracker-core.js` and can be changed in the app. New games use the current rate; games already recorded keep the rate they were logged with. One-off player invoices can include a type, name, amount, due date, and description. Invoice payments are kept separate from game-dues payments.

## Tests

Requires Node.js 18 or newer; no test packages need to be installed.

```sh
npm test
```

The test suite uses Node's built-in test runner. It has no test framework or browser-driver dependencies.

| Scope | Command | What it covers |
| --- | --- | --- |
| Unit | `npm run test:unit` | Empty state; player name and ID validation; real calendar dates; duplicate and out-of-roster attendance; immutable updates; configurable fee snapshots; cent rounding; dues, invoices, and summaries; payment allocation; invoice ownership; activity ordering; state integrity. |
| Integration | `npm run test:integration` | Local-storage legacy migration; Firebase owner-scoped reads/writes, live snapshots, auth guards, and account isolation; malformed data; mixed game/invoice payment persistence; history surviving player removal. Firebase is mocked for repeatable offline tests. |
| System | `npm run test:system` | Firebase SDK load order; auth UI flows; UID-restricted Firestore rules; cloud load/save/sync wiring; tested production core; fee and invoice controls; responsive UI requirements; local asset references. |
| Acceptance | `npm run test:acceptance` | Organizer workflows: create a roster, record attendance, make partial/full payments, reopen saved data, change future fees, and charge/pay a separate team-expense invoice. |

Run an individual scope with its command above, or run all scopes with `npm test`. Test files are in `tests/`.

System tests are dependency-free wiring and responsive-style smoke checks, not automated browser screenshots. For a release, also exercise the app in target desktop/mobile browsers, including native date/number controls and dialogs.
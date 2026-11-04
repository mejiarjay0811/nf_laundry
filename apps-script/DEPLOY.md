# Deploying the backend

`Bundle.gs` is the whole backend. Once it is deployed, the app works from
anywhere there is a signal — mobile data included — with no laptop running.

It is generated, never edited by hand. Rebuild it with:

```bash
npm run test:appsscript
```

which compiles it and then runs it through a full day's work (setup, sign-in,
a split-payment sale, pickup, reports, role checks, cancellation) before you
deploy anything.

---

## What changed, and why it matters

Previously the phone talked to a Node server on the laptop, and that server
talked to Apps Script. Three problems: the laptop had to be on the same Wi-Fi,
its address moved whenever the router reassigned it, and every sale cost three
round trips *from* the laptop *to* Google.

Now the phone talks to Apps Script directly and Apps Script talks to the
spreadsheet locally. One hop instead of two, and no laptop.

The code is the same code. `Bundle.gs` is compiled from the same TypeScript the
Node server runs — the same money arithmetic, the same validators, the same
route table with the same permission rules. It is not a rewrite, so the two
cannot drift apart.

---

## First deployment

1. Open the spreadsheet → **Extensions → Apps Script**.

2. Delete everything in `Code.gs` and paste in the contents of
   **`apps-script/Bundle.gs`**. Save.

   You can leave the old `Code.gs` file in place if you prefer, but only if you
   remove its `doPost`/`doGet` — two functions with the same name in one project
   will shadow each other unpredictably.

3. **Deploy → Manage deployments** → pencil icon on the existing deployment →
   **Version: New version** → **Deploy**.

   > Use *Manage deployments*, not *New deployment*. Editing the existing one
   > keeps the same URL, which is baked into the installed app. Creating a new
   > deployment mints a different URL and would strand every phone.

4. Confirm access is **Execute as: Me**, **Who has access: Anyone**.
   "Anyone" means the URL is reachable without a Google account — it does not
   mean the data is public. The endpoint returns nothing until someone signs in.

5. Check which build is live by opening the deployment URL in a browser. It
   should answer:

   ```json
   { "ok": true, "service": "N & F Laundry POS", "version": "5", "configured": true }
   ```

   `configured: false` means the `API_TOKEN` script property is missing.

---

## Secrets

Two script properties matter (**Project Settings → Script properties**):

| Property      | Set by  | Purpose                                                        |
| ------------- | ------- | -------------------------------------------------------------- |
| `API_TOKEN`   | you     | Gates the command-line tools. The app never sends it.           |
| `AUTH_SECRET` | itself  | Created on first use. Signs sessions and peppers passwords.     |

**Do not delete `AUTH_SECRET`.** Every stored password is hashed with a pepper
derived from it, so removing it locks everyone out and each account would need
its password set again.

It is deliberately separate from `API_TOKEN` so that rotating the token — which
you might reasonably do — does not invalidate every password at the same time.

---

## Accounts

Passwords are hashed *inside* Apps Script, because the pepper lives here and
never leaves. A hash computed anywhere else could not be verified at sign-in, so
the command-line tool asks the deployment to do it:

```bash
npm run admin:password -- admin <the-password>
```

If the account does not exist it is created as an administrator; if it does, its
password is replaced.

Accounts created before this change hold hashes in the old scrypt format, which
this runtime cannot verify. Signing in to one says so plainly rather than
claiming the password is wrong. Run the command above once per account to
migrate it.

---

## Checking a deployment

```bash
npm run check                      # workbook reachable, sheets present
npm run test:appsscript            # full behavioural run against the build
```

`npm run check` talks to the live deployment. `npm run test:appsscript` runs the
built file locally against an in-memory workbook, so it never touches real data.

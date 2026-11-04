# Connecting to the real Google Sheet

The workbook this app uses:

<https://docs.google.com/spreadsheets/d/1KjSDxY4WirVlzf-ZSv_v212EYqlo6eM71YR0xUj2PWE/edit>

Spreadsheet ID: `1KjSDxY4WirVlzf-ZSv_v212EYqlo6eM71YR0xUj2PWE`

These steps need your Google account, so they cannot be automated from here.
They take about five minutes and only have to be done once.

---

## Step 1 — Create a shared secret

Generate a long random token. Run this and keep the output:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

This is the only credential shared between the app and the spreadsheet. It never
reaches the browser.

## Step 2 — Install the script

1. Open the spreadsheet.
2. **Extensions → Apps Script**. A new tab opens.
3. Delete whatever is in `Code.gs` and paste the entire contents of
   [`apps-script/Code.gs`](./Code.gs) from this repository.
4. Click the **Save** icon.

## Step 3 — Store the token in the script

1. In the Apps Script editor, click the gear icon (**Project Settings**).
2. Scroll to **Script properties** → **Add script property**.
3. Property: `API_TOKEN`  ·  Value: the token from step 1.
4. **Save script properties**.

## Step 4 — Deploy as a Web App

1. **Deploy → New deployment**.
2. Click the gear next to "Select type" and choose **Web app**.
3. Set:
   - **Description**: `N&F Laundry POS gateway`
   - **Execute as**: **Me**
   - **Who has access**: **Anyone**
4. **Deploy**. Google asks you to authorise the script — accept.
   (On the "Google hasn't verified this app" screen choose *Advanced →
   Go to ... (unsafe)*. It is your own script.)
5. Copy the **Web app URL**. It ends in `/exec`.

> **Why "Anyone"?** The URL is unguessable and every request must carry the
> `API_TOKEN`. "Anyone" only means Google will not demand a Google login before
> the script runs — it does not make your spreadsheet public.

## Step 5 — Point the app at it

Edit `.env` in the project root:

```dotenv
SHEETS_PROVIDER=apps-script
GOOGLE_SPREADSHEET_ID=1KjSDxY4WirVlzf-ZSv_v212EYqlo6eM71YR0xUj2PWE
APPS_SCRIPT_URL=https://script.google.com/macros/s/AKfycb.../exec
APPS_SCRIPT_TOKEN=<the token from step 1>
```

## Step 6 — Verify, then create the sheets

```bash
npm run check
```

This only reads. It tells you precisely what is wrong if anything is.

Then:

```bash
npm run setup
```

This creates the eight worksheets with their headers, seeds the three default
services and the settings, and creates the first administrator — printing the
password once. It never overwrites existing rows.

Finally:

```bash
npm run check
```

You should see every line ticked, and the row counts should be zero.

---

## Re-deploying after editing Code.gs

**Deploy → Manage deployments →** pencil icon **→ Version: New version → Deploy.**
The `/exec` URL stays the same. Creating a *new deployment* instead would give
you a different URL.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `The data server rejected the access token` | `APPS_SCRIPT_TOKEN` ≠ `API_TOKEN` | Re-copy the token into both places |
| `...deployment is set to "Anyone" access` | The script returned Google's sign-in page | Step 4: **Who has access → Anyone**, then re-deploy a *new version* |
| `Unable to connect to the data server` | Wrong URL, or no internet | Check the URL ends in `/exec` |
| `The system is busy saving another transaction` | Two writes collided; the loser waited out the lock | Retry — this is the lock doing its job |
| Changes to `Code.gs` have no effect | You saved but did not re-deploy | Manage deployments → New version |

## What the script does and does not do

It is a **storage driver only**. It has no pricing, no permissions model and no
business rules — all of that lives in the Node/TypeScript backend, so the
security model never depends on a script that is reachable by URL.

Its one job the Sheets REST API cannot do: `LockService.getScriptLock()`, which
makes counter increments and row updates genuinely atomic. That is what
guarantees two cashiers pressing "Complete Transaction" at the same instant
cannot be issued the same O.R. number.

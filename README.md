# N & F LAUNDRY POS

Point-of-sale and management system for a laundry shop, backed by Google Sheets.

- **Frontend** React 18 + TypeScript + Vite + Tailwind + TanStack Query + Recharts
- **Backend** TypeScript — all business logic, auth and RBAC
- **Storage** Google Sheets

The backend runs in **two places from one source**. In development it is an
Express server; in production it is compiled into a single Apps Script file that
runs inside Google, next to the spreadsheet. Both execute the same route table,
the same validators and the same money arithmetic — see
[`apps-script/DEPLOY.md`](./apps-script/DEPLOY.md).

That is what lets the shop run with no server of its own: the phone and the
counter PC talk straight to Apps Script over the internet, so there is nothing
to keep switched on and nothing tied to the shop's Wi-Fi.

## The three ways to run it

| | Build | Notes |
|---|---|---|
| Browser | `npm run dev` | Express backend, hot reload |
| Android | `npm run android:build` | APK with the client bundled in |
| Windows | `npm run desktop:build` | Installer + portable `.exe` — see [`desktop/README.md`](./desktop/README.md) |

The packaged builds carry no secrets. The only address baked in is the Apps
Script Web App URL, which returns nothing until someone signs in.

---

## Quick start (development)

```bash
npm install
cp .env.example .env
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"   # SESSION_SECRET
npm run setup     # creates the worksheets and the first administrator
npm run dev       # API on :4000, client on :5173
```

`SHEETS_PROVIDER=local` (the default) uses a file-backed store under `.data/`, so
you can develop without touching Google. It is **blocked in production**.

## Connecting to the real spreadsheet

See [`apps-script/README.md`](./apps-script/README.md) for the five-minute
setup. Then:

```bash
npm run check     # read-only diagnosis of the connection
npm run setup     # create the sheets (never overwrites existing rows)
```

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | API + client with hot reload |
| `npm run build` | Type-check and build both |
| `npm start` | Run the production server (also serves the built client) |
| `npm run setup` | Create/repair worksheets, seed services, create first admin |
| `npm run check` | Read-only diagnosis: connection, sheets, deployed script version |
| `npm run reset:data` | Preview clearing trading data (add `-- --confirm` to run it) |
| `npm test` | Unit and driver-contract tests |

### Re-deploying the Apps Script

A Web App serves a **version snapshot**, so saving the editor does not change
what `/exec` answers. After editing `apps-script/Code.gs`:

**Deploy → Manage deployments → ✏️ → Version: New version → Deploy**

`Code.gs` carries a `SCRIPT_VERSION`; bump it when you change the file and
`npm run check` will tell you which build is actually live:

```
✓ Deployed script version 4 (11 operations).
```

## Storage drivers

| Provider | When to use | Atomicity |
|---|---|---|
| `apps-script` | **Recommended for production** | Real, via `LockService` |
| `google-api` | Service account, single server instance | Process mutex only |
| `local` | Development and tests | Process mutex only |

The Sheets REST API has no locking primitive, so two cashiers completing a sale
at the same instant could be issued the same O.R. number. Apps Script exposes
`LockService.getScriptLock()`, which is why it is the recommended gateway. The
script is a storage driver only — pricing, permissions and every business rule
stay in the Node backend, so security never depends on a URL-reachable script.

## Project layout

```
shared/     Types, money maths, Manila-time helpers - used by client AND server
server/     Express API: routes -> validators -> services -> sheets drivers
src/        React client: pages, components, hooks
apps-script/Code.gs and its setup guide
```

## Workflow

An order has three states: **Received → Ready for Pickup → Picked Up** (plus
Cancelled). The whole thing is driven from the Pickup Queue — two clicks per
order. An earlier six-stage version (Washing/Drying/Folding) was dropped as
busywork; rows written under it still read correctly, folded back to "Received"
by `normaliseOrderStatus`.

## Payments

A sale can be settled with more than one method — ₱100 cash and ₱75 GCash on a
₱175 bill is routine. Each method is written as its own row in the Payments
ledger, which is what the cash/GCash reporting reads, and the transaction row is
labelled `Cash + GCash`.

Change always comes out of cash: GCash is applied to the bill first, because you
cannot hand back GCash. A tender that overshoots with no cash in it is refused
rather than silently recording a refund that never happened.

## Money and time

Money is integer **centavos** everywhere in code; pesos only at the boundary.
Dates are bucketed in **Asia/Manila** (fixed UTC+8, no DST), so a sale at
01:30 Manila belongs to that Manila day, not the UTC one.

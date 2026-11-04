# Desktop app

A Windows application for the counter PC. Same app as the phone, same backend —
only the window around it differs.

## Building

```bash
npm run desktop:install     # once, downloads Electron (~200 MB)
npm run desktop:build       # builds the client, then packages
```

Output lands in `dist/desktop/`:

| File                              | Use                                                      |
| --------------------------------- | -------------------------------------------------------- |
| `NF-Laundry-POS-Setup-1.0.0.exe`  | Installer. Adds Start Menu and desktop shortcuts.         |
| `NF-Laundry-POS-Portable-1.0.0.exe` | Single file, no installation. Good for a USB stick.     |

Neither is code-signed, so Windows SmartScreen will warn on first run
("Windows protected your PC" → *More info* → *Run anyway*). Signing needs a
purchased certificate; without one, that warning is unavoidable.

To run it without packaging:

```bash
npm run desktop:start
```

## How it works

The window loads the built client over a registered `app://` scheme rather than
from `file://`. That is not cosmetic — three things depend on it:

- **ES modules are blocked under `file://`.** The app would not start at all.
- **`crypto.randomUUID` needs a secure context.** It generates the idempotency
  keys that stop a retried sale from being recorded twice.
- **`localStorage` is per-origin.** `file://` has no stable origin, so the
  cashier would be signed out on every restart.

The shell itself is deliberately thin. It has no database access and no
credentials; it serves the page's own files and nothing else. The renderer runs
with `contextIsolation`, `sandbox` and no Node integration, so a flaw in the page
cannot reach the filesystem or start a process.

Requests go to the same Apps Script deployment the phone uses, so records land in
the same spreadsheet with no extra configuration.

## Printing

**File → Print** (or `Ctrl+P`) prints the current view, which is how receipts
come out on a counter printer.

## Where data lives

Nothing is stored on the PC except the session token and a few interface
preferences, in `%APPDATA%/N & F Laundry POS`. Every sale goes to the Google
Sheet. Uninstalling loses nothing; signing in on another machine shows the same
records.

## Requires an internet connection

There is no offline mode. Without a connection the app cannot sign in or save a
sale — the same as the phone. A cashier should not be told a sale was recorded
when it was not, so the app reports the failure rather than queueing silently.

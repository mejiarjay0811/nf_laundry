# Android app

A thin native shell around the same web build, produced with Capacitor.

## How it works, and why

The phone **does not** talk to Google Sheets. It loads the app from the Node
server over the shop's Wi-Fi, and that server holds the spreadsheet credentials.
Two reasons:

1. The Apps Script token must never ship inside an APK — anyone can unzip one.
2. Loading from the server origin (rather than `file://`) means the session
   cookie, CORS and error handling behave exactly as they do in a desktop
   browser. There is no second authentication path to get wrong.

The trade-off: **the phone and the PC running the server must be on the same
Wi-Fi**, and the server has to be running. This is a till app for one shop, so
that is normally true anyway.

## Requirements on the phone

- Same Wi-Fi network as the PC
- "Install unknown apps" allowed for whatever app you use to open the APK
  (Settings → Apps → Special access → Install unknown apps)

## Building

```powershell
$env:JAVA_HOME  = "C:\Program Files\Android\Android Studio\jbr"
$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"

npm run android:build
```

The APK lands at:

```
android\app\build\outputs\apk\debug\app-debug.apk
```

## Pointing it at a different server

The address is **not** baked into the APK. On first launch the app asks for it,
checks it answers, and remembers it. If the PC's address changes, clear the
app's storage (Settings -> Apps -> N & F Laundry POS -> Storage -> Clear data)
and enter the new one — no rebuild, no reinstall.

Find the address with `ipconfig` — the IPv4 address of the Wi-Fi adapter. A
static DHCP reservation for the PC stops it moving at all, which is worth
setting up once.

## Running the server for the phone

```powershell
npm run build
npm start
```

`.env` needs:

```dotenv
SERVE_CLIENT=true
COOKIE_SECURE=false   # the LAN is plain HTTP; a Secure cookie would be dropped
API_PORT=4000
```

Windows Firewall must allow inbound TCP 4000 for Node. Check from the phone's
browser first — `http://<pc-ip>:4000` should show the login screen. If it does
not, the APK will not work either, and the problem is the network rather than
the app.

## Known limitations

- **Debug-signed.** Fine for testing; a Play Store release needs a release
  keystore and `assembleRelease`.
- **Plain HTTP over the LAN.** `cleartext: true` and `COOKIE_SECURE=false` make
  that work. Do not expose this server to the internet as-is — put it behind
  HTTPS and set `COOKIE_SECURE=true` first.
- **No offline mode.** With the server unreachable the app shows its connection
  error. Offline sales would need queued writes and a conflict story for O.R.
  numbers, which is a real piece of work rather than a setting.

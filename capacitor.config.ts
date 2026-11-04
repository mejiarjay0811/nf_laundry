import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Android wrapper for the POS.
 *
 * The whole app is bundled into the APK and talks straight to the Apps Script
 * deployment, so it works anywhere there is a signal — mobile data included —
 * with no laptop running on the shop's Wi-Fi.
 *
 * Nothing secret ships inside the APK. The only address baked in is the Web App
 * URL, which is a public endpoint: it hands out nothing until someone signs in
 * with a username and password, and the spreadsheet credentials stay inside
 * Google, where the script runs as the owner. Anyone can unzip an APK, so the
 * rule is that unzipping this one reveals nothing they could not already see by
 * visiting the URL.
 *
 * Sessions are bearer tokens rather than cookies: the app's origin and the
 * API's origin differ now, and a cross-site cookie would simply be dropped.
 */
const config: CapacitorConfig = {
  appId: 'ph.nflaundry.pos',
  appName: 'N & F Laundry POS',

  // The built client itself — there is no server to load it from.
  webDir: 'dist/client',

  android: {
    // Every request the app makes is https. Nothing needs the exception.
    allowMixedContent: false,
  },

  server: {
    /*
     * Capacitor's default. It makes the WebView a secure context, which
     * crypto.randomUUID needs for the idempotency keys that stop a retried
     * sale from being recorded twice.
     */
    androidScheme: 'https',
  },
};

export default config;

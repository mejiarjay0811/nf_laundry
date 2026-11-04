/**
 * Desktop shell for the POS.
 *
 * A window around the same built client the phone runs, talking to the same
 * Apps Script backend. There is no server here and no credentials — the shell
 * only draws a window and serves the page's own files.
 *
 * The files are served over a registered app:// scheme rather than loaded from
 * file://. That matters for three reasons: ES modules are blocked under
 * file://, so the app would not start at all; a registered scheme is a secure
 * context, which crypto.randomUUID needs for the keys that stop a retried sale
 * being recorded twice; and localStorage is only persisted per origin, so the
 * cashier stays signed in between sessions.
 */
const { app, BrowserWindow, Menu, dialog, shell, protocol, net } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const SCHEME = 'app';
const HOST = 'local';
const START_URL = SCHEME + '://' + HOST + '/index.html';

/*
 * Packaging copies the built client to ./client inside the app bundle. Running
 * unpackaged (npm start) there is no copy, so fall back to the build output in
 * the repository — the same files, one directory up.
 */
const packagedClient = path.join(__dirname, 'client');
const clientDir = fs.existsSync(path.join(packagedClient, 'index.html'))
  ? packagedClient
  : path.join(__dirname, '..', 'dist', 'client');

/**
 * Must be declared before the app is ready, and must match the policy the page
 * itself carries — see the Vite config, which is where it is defined.
 */
const API_HOSTS = 'https://script.google.com https://script.googleusercontent.com';
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com data:",
  "img-src 'self' data: blob:",
  "connect-src 'self' " + API_HOSTS,
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
].join('; ');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

protocol.registerSchemesAsPrivileged([
  {
    scheme: SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
]);

/** Resolve a request path to a file inside the client directory, or null. */
function resolveAsset(pathname) {
  const decoded = decodeURIComponent(pathname);
  const candidate = path.normalize(path.join(clientDir, decoded));

  // Refuse anything that climbs out of the client directory.
  const relative = path.relative(clientDir, candidate);
  if (relative.startsWith('..') || path.isAbsolute(relative)) return null;

  if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  return null;
}

function serveClient() {
  protocol.handle(SCHEME, async (request) => {
    const { pathname } = new URL(request.url);

    let file = resolveAsset(pathname === '/' ? '/index.html' : pathname);

    /*
     * Anything that is not a real file is a client-side route (/pos, /reports
     * and so on), so hand back the shell and let the router deal with it.
     * Asset requests are excluded: a missing script should be a 404, not an
     * HTML page that fails to parse as JavaScript.
     */
    if (!file && !path.extname(pathname)) {
      file = path.join(clientDir, 'index.html');
    }

    if (!file) {
      return new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain' } });
    }

    try {
      const body = await fs.promises.readFile(file);
      const type = MIME_TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
      return new Response(body, {
        status: 200,
        headers: {
          'content-type': type,
          'content-security-policy': CSP,
          // Everything is bundled with a hashed filename except the shell.
          'cache-control': file.endsWith('index.html') ? 'no-cache' : 'public, max-age=31536000',
        },
      });
    } catch (error) {
      return new Response('Failed to read ' + pathname, {
        status: 500,
        headers: { 'content-type': 'text/plain' },
      });
    }
  });
}

function buildMenu(window) {
  const template = [
    {
      label: '&File',
      submenu: [
        {
          // Receipts are the reason a counter PC has a printer attached.
          label: 'Print…',
          accelerator: 'CmdOrCtrl+P',
          click: () => window.webContents.print({}),
        },
        { type: 'separator' },
        { role: 'quit', label: 'Exit' },
      ],
    },
    {
      label: '&Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: '&View',
      submenu: [
        { label: 'Reload', accelerator: 'F5', click: () => window.webContents.reload() },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        { label: 'Developer Tools', accelerator: 'F12', click: () => window.webContents.toggleDevTools() },
      ],
    },
    {
      label: '&Help',
      submenu: [
        {
          label: 'About',
          click: () => {
            dialog.showMessageBox(window, {
              type: 'info',
              title: 'N & F Laundry POS',
              message: 'N & F Laundry POS',
              detail:
                'Version ' + app.getVersion() + '\n\n' +
                'Records are stored in the shop\'s Google Sheet. This app needs an ' +
                'internet connection to sign in and to save sales.',
              buttons: ['OK'],
            });
          },
        },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 380,
    minHeight: 560,
    show: false,
    backgroundColor: '#0f172a',
    title: 'N & F Laundry POS',
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: {
      // The page is ordinary web code and needs nothing from Node. Keeping all
      // three at their safe settings means a flaw in the page cannot reach the
      // filesystem or spawn a process.
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false,
      spellcheck: false,
    },
  });

  buildMenu(window);

  window.once('ready-to-show', () => {
    window.maximize();
    window.show();
  });

  // Links to the wider web open in the user's browser, never inside the app.
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url);
    return { action: 'deny' };
  });

  window.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(SCHEME + '://')) {
      event.preventDefault();
      if (url.startsWith('https://')) void shell.openExternal(url);
    }
  });

  // A failed load would otherwise show as an empty window with no explanation.
  window.webContents.on('did-fail-load', (_event, code, description, url) => {
    console.error('Failed to load ' + url + ': ' + description + ' (' + code + ')');
    dialog.showErrorBox(
      'The app could not start',
      'Could not load ' + url + '\n\n' + description +
        '\n\nThe installation may be incomplete. Reinstalling should fix it.',
    );
  });

  window.webContents.on('console-message', (_event, level, message, line, source) => {
    if (level >= 2) console.error('[page] ' + message + '  (' + source + ':' + line + ')');
  });

  window.webContents.on('render-process-gone', (_event, details) => {
    dialog.showErrorBox(
      'The app stopped unexpectedly',
      'Reason: ' + details.reason + '\n\nClose this message and start the app again.',
    );
  });

  void window.loadURL(START_URL);
  return window;
}

// A second copy would fight the first over the same session and window state.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const [existing] = BrowserWindow.getAllWindows();
    if (existing) {
      if (existing.isMinimized()) existing.restore();
      existing.focus();
    }
  });

  app.whenReady().then(() => {
    serveClient();
    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    app.quit();
  });
}

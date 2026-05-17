/**
 * daemon.ts — Window Daemon mode for gbrain-companion
 *
 * Initializes GeminiWebDriver once, then listens on a Unix domain socket
 * for prompt requests. Subsequent prompts pay only the generation cost (~10.4s),
 * not the init cost (~18s).
 *
 * Protocol: newline-delimited JSON over /tmp/gbrain-companion.sock
 *   Request:  { type: 'ask', prompt: string, requestId: string, newConversation?: boolean }
 *   Response: { requestId: string, ok: true, text: string, genMs: number }
 *           | { requestId: string, ok: false, error: string }
 *
 * Usage:
 *   bun run daemon
 */

import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { GeminiWebDriver } from 'weblm-driver';

const SOCKET_PATH = '/tmp/gbrain-companion.sock';
const SOFT_RESET_PREFIX = '[新任務，請忽略上一個對話]\n\n';

const profileDir = process.env['GEMINI_PROFILE_DIR'];
const executablePath = process.env['CHROME_EXECUTABLE'];

if (!profileDir) {
  console.error('Error: GEMINI_PROFILE_DIR is not set');
  process.exit(1);
}

// Patch Chrome Preferences to prevent "session restore" dialog on next launch.
// Chrome marks exit_type="Crashed" on abnormal shutdown; we reset it to "Normal"
// before every launch so the dialog never appears.
function patchChromePreferences(dir: string) {
  const prefPath = path.join(dir, 'Preferences');
  try {
    if (!fs.existsSync(prefPath)) return;
    const raw = fs.readFileSync(prefPath, 'utf8');
    const prefs = JSON.parse(raw);
    let changed = false;
    if (!prefs.profile) prefs.profile = {};
    if (prefs.profile.exit_type !== 'Normal') {
      prefs.profile.exit_type = 'Normal';
      changed = true;
    }
    if (prefs.profile.exited_cleanly !== true) {
      prefs.profile.exited_cleanly = true;
      changed = true;
    }
    if (changed) {
      fs.writeFileSync(prefPath, JSON.stringify(prefs));
      console.log('Patched Chrome Preferences: exit_type → Normal');
    }
  } catch (e) {
    console.log('Preferences patch skipped:', String(e).slice(0, 60));
  }
}

patchChromePreferences(profileDir);

const driver = new GeminiWebDriver({
  providerUrl: 'https://gemini.google.com/app',
  profileDir,
  ...(executablePath ? { executablePath } : {}),
  headless: false,
  firstTokenTimeoutMs: 30_000,
  stabilityTimeoutMs: 120_000,
  stabilityIntervalMs: 500,
  args: [
    '--no-first-run',
    '--disable-session-crashed-bubble',
    '--blink-settings=imagesEnabled=false',
    '--disable-features=AutoplayPolicy',
    '--window-size=360,180',
    '--window-position=20,9999',
  ],
});

// Remove stale socket file if it exists
if (fs.existsSync(SOCKET_PATH)) {
  fs.unlinkSync(SOCKET_PATH);
}

async function shutdown() {
  console.log('\nShutting down...');
  server.close();
  if (fs.existsSync(SOCKET_PATH)) fs.unlinkSync(SOCKET_PATH);
  await driver.shutdown().catch(() => {});
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// Init driver first
const t0 = Date.now();
console.log('Initializing browser...');
await driver.init();
console.log(`Browser ready in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

// Dismiss "session restore" dialog if Chrome shows it after abnormal shutdown.
// The dialog ("你要還原網頁嗎？") has a "還原" button and an × close button.
// Escape is the most reliable cross-locale dismiss; the locator is a belt-and-suspenders backup.
try {
  const session0 = (driver as unknown as { session: unknown }).session as {
    _page: {
      keyboard: { press: (k: string) => Promise<void> };
      locator: (s: string) => { click: (o?: unknown) => Promise<void> };
    };
  };
  await session0._page.keyboard.press('Escape').catch(() => {});
  // belt-and-suspenders: click dismiss button if Escape didn't work
  await session0._page.locator([
    'button:has-text("不用")',
    'button:has-text("取消")',
    'button:has-text("No")',
    '[data-action="cancel"]',
    // some Chrome versions expose the infobar close as aria-label
    '[aria-label*="閉"]',
    '[aria-label*="close" i]',
  ].join(', ')).click({ timeout: 1500 }).catch(() => {});
} catch {}

// Minimize window so it lives in the Dock and doesn't clutter the screen.
// macOS prevents windows from extending below the visible area (clamps bottom edge to
// screen bottom), so any "position near bottom" trick just shows the full window.
// Minimizing is the only reliable way to hide the window while keeping the process alive.
// CDP/Playwright interactions continue to work on minimized windows.
try {
  const session = (driver as unknown as { session: unknown }).session as {
    _page: { context: () => unknown };
    _context: { newCDPSession: (p: unknown) => Promise<{ send: (m: string, p?: unknown) => Promise<unknown> }> };
  };
  const page = (session as unknown as { _page: unknown })._page;
  const ctx  = session._context;
  const cdp = await ctx.newCDPSession(page);
  const { windowId } = await cdp.send('Browser.getWindowForTarget') as { windowId: number };
  await cdp.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'minimized' } });
  console.log('Window minimized to Dock');
} catch (e) {
  console.log('Window minimize CDP failed (non-fatal):', String(e).slice(0, 60));
}

// Start Unix socket server
const server = net.createServer((socket) => {
  let buf = '';

  socket.on('data', (chunk) => {
    buf += chunk.toString();
    const lines = buf.split('\n');
    buf = lines.pop() ?? '';

    for (const line of lines) {
      if (!line.trim()) continue;
      handleRequest(socket, line);
    }
  });

  socket.on('error', (err) => {
    console.error('Socket error:', err.message);
  });
});

async function handleRequest(socket: net.Socket, line: string) {
  let requestId = 'unknown';
  try {
    const msg = JSON.parse(line) as {
      type: string;
      prompt: string;
      requestId: string;
      newConversation?: boolean;
    };

    requestId = msg.requestId;

    if (msg.type !== 'ask') {
      send(socket, { requestId, ok: false, error: `Unknown type: ${msg.type}` });
      return;
    }

    const newConversation = msg.newConversation ?? false;
    // Daemon mode: context is maintained by default — no soft reset prefix.
    // --new-topic triggers newConversation:true which reloads the page.
    const prompt = msg.prompt;

    const tGen = Date.now();
    const result = await driver.generate({ prompt, newConversation, timeoutMs: 90_000 });
    const genMs = Date.now() - tGen;

    if (result.outputKind !== 'normal') {
      send(socket, { requestId, ok: false, error: `Unexpected outputKind: ${result.outputKind}` });
      return;
    }

    send(socket, { requestId, ok: true, text: result.text, genMs });
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    send(socket, { requestId, ok: false, error });
  }
}

function send(socket: net.Socket, payload: object) {
  try {
    socket.write(JSON.stringify(payload) + '\n');
  } catch {}
}

server.listen(SOCKET_PATH, () => {
  console.log(`Driver ready, listening on ${SOCKET_PATH}`);
});

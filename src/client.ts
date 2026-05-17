/**
 * client.ts — CLI client for the gbrain-companion daemon
 *
 * Connects to /tmp/gbrain-companion.sock and sends a prompt request.
 * If the daemon is not running, exits with an error message.
 *
 * Usage:
 *   bun run ask "your prompt text"
 *   bun run ask --new-topic "start fresh prompt"
 */

import net from 'node:net';
import fs from 'node:fs';

const SOCKET_PATH = '/tmp/gbrain-companion.sock';

if (!fs.existsSync(SOCKET_PATH)) {
  console.error('Daemon not running. Start with: bun run daemon');
  process.exit(1);
}

// Parse args: look for --new-topic flag, rest is the prompt
const args = process.argv.slice(2);
let newConversation = false;
const promptParts: string[] = [];

for (const arg of args) {
  if (arg === '--new-topic') {
    newConversation = true;
  } else {
    promptParts.push(arg);
  }
}

const prompt = promptParts.join(' ').trim();
if (!prompt) {
  console.error('Usage: bun run ask [--new-topic] "prompt text"');
  process.exit(1);
}

const requestId = Date.now().toString();
const request = JSON.stringify({ type: 'ask', prompt, requestId, newConversation }) + '\n';

const socket = net.createConnection(SOCKET_PATH);

socket.on('error', (err) => {
  console.error(`Connection error: ${err.message}`);
  process.exit(1);
});

socket.on('connect', () => {
  socket.write(request);
});

let buf = '';
const tStart = Date.now();

socket.on('data', (chunk) => {
  buf += chunk.toString();
  const lines = buf.split('\n');
  buf = lines.pop() ?? '';

  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const msg = JSON.parse(line) as
        | { requestId: string; ok: true; text: string; genMs: number }
        | { requestId: string; ok: false; error: string };

      if (msg.requestId !== requestId) continue;

      socket.destroy();

      if (!msg.ok) {
        console.error(`Error: ${msg.error}`);
        process.exit(1);
      }

      console.log(msg.text);
      console.log(`\ngen: ${(msg.genMs / 1000).toFixed(1)}s`);
      process.exit(0);
    } catch {
      // incomplete JSON, wait for more data
    }
  }
});

socket.on('close', () => {
  const elapsed = ((Date.now() - tStart) / 1000).toFixed(1);
  console.error(`Connection closed after ${elapsed}s without a response`);
  process.exit(1);
});

// Safety timeout: 2 minutes
setTimeout(() => {
  console.error('Timeout: no response from daemon after 120s');
  socket.destroy();
  process.exit(1);
}, 120_000);

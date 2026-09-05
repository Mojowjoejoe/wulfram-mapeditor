import fs from 'node:fs';
import path from 'node:path';

const debuggerPort = Number(process.env.WULFRAM_CDP_PORT ?? 9223);
const expectedUrlPrefix = process.env.WULFRAM_CDP_URL_PREFIX ?? 'http://localhost:3000';
const outputPath = path.resolve(process.argv[2] ?? 'artifacts/balanced-generator-dialog.png');
const targets = await fetch(`http://127.0.0.1:${debuggerPort}/json/list`).then((response) => response.json());
const page = targets.find((target) => target.type === 'page' && target.url.startsWith(expectedUrlPrefix));
if (!page) throw new Error(`Open ${expectedUrlPrefix} in a Chromium browser with remote debugging enabled.`);

const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true });
  socket.addEventListener('error', reject, { once: true });
});

let sequence = 0;
const pending = new Map();
const runtimeErrors = [];
socket.addEventListener('message', (event) => {
  const message = JSON.parse(event.data);
  if (message.method === 'Runtime.exceptionThrown') runtimeErrors.push(message.params.exceptionDetails.text);
  if (!message.id) return;
  const handler = pending.get(message.id);
  if (!handler) return;
  pending.delete(message.id);
  if (message.error) handler.reject(new Error(message.error.message));
  else handler.resolve(message.result);
});

function cdp(method, params = {}) {
  const id = ++sequence;
  socket.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}

async function evaluate(expression) {
  const result = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
  return result.result.value;
}

async function waitFor(expression, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await evaluate(expression)) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for: ${expression}`);
}

await cdp('Runtime.enable');
await cdp('Page.enable');
await cdp('Emulation.setDeviceMetricsOverride', {
  width: 1440,
  height: 1000,
  deviceScaleFactor: 1,
  mobile: false,
});
await cdp('Page.reload', { ignoreCache: true });
await new Promise((resolve) => setTimeout(resolve, 300));
await waitFor("document.querySelector('.top-actions') !== null");
await evaluate("Array.from(document.querySelectorAll('.top-actions button')).find((button) => button.textContent.includes('Balanced'))?.click()");
await waitFor("document.querySelector('.balanced-generator-dialog') !== null");
await evaluate(`(() => {
  const input = document.querySelector('.balanced-generator-form input');
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  setter.call(input, 'Balanced UI Smoke');
  input.dispatchEvent(new Event('input', { bubbles: true }));
})()`);
await evaluate("Array.from(document.querySelectorAll('.balanced-generator-footer button')).find((button) => button.textContent.includes('Generate three'))?.click()");
await waitFor("document.querySelectorAll('.balanced-candidate-grid > button').length === 3");

const result = await evaluate(`(() => {
  const candidates = Array.from(document.querySelectorAll('.balanced-candidate-grid > button'));
  const apply = Array.from(document.querySelectorAll('.balanced-generator-footer button'))
    .find((button) => button.textContent.includes('Apply passing candidate'));
  return {
    candidateCount: candidates.length,
    passingCount: candidates.filter((candidate) => candidate.classList.contains('pass')).length,
    selectedCount: candidates.filter((candidate) => candidate.classList.contains('selected')).length,
    applyDisabled: apply?.disabled,
    dialogTitle: document.querySelector('.balanced-generator-dialog [data-slot="dialog-title"]')?.textContent,
    gateCount: document.querySelectorAll('.balanced-gate-list > div').length,
  };
})()`);

if (result.candidateCount !== 3 || result.passingCount < 1 || result.selectedCount !== 1
  || result.applyDisabled !== false || result.gateCount !== 11) {
  throw new Error(`Balanced dialog smoke check failed: ${JSON.stringify(result)}`);
}
if (runtimeErrors.length) throw new Error(`Browser runtime errors: ${runtimeErrors.join(' | ')}`);

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
const screenshot = await cdp('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
fs.writeFileSync(outputPath, Buffer.from(screenshot.data, 'base64'));
await evaluate("Array.from(document.querySelectorAll('.balanced-generator-footer button')).find((button) => button.textContent.includes('Apply passing candidate'))?.click()");
await waitFor("document.querySelector('.balanced-generator-dialog') === null");
const applied = await evaluate(`({
  name: document.querySelector('.map-title input')?.value,
  notice: document.querySelector('.statusbar')?.textContent,
})`);
if (applied.name !== 'Balanced UI Smoke' || !applied.notice?.includes('candidate applied')) {
  throw new Error(`Balanced candidate apply check failed: ${JSON.stringify(applied)}`);
}
await new Promise((resolve) => setTimeout(resolve, 300));
const appliedOutputPath = outputPath.replace(/\.png$/i, '-applied.png');
const appliedScreenshot = await cdp('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
fs.writeFileSync(appliedOutputPath, Buffer.from(appliedScreenshot.data, 'base64'));
console.log(JSON.stringify({
  ...result,
  ...applied,
  screenshot: outputPath,
  appliedScreenshot: appliedOutputPath,
}, null, 2));
socket.close();

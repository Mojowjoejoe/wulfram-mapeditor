import fs from 'node:fs';
import path from 'node:path';

import { readMapArchive } from '../lib/map-package.ts';

const debuggerPort = Number(process.env.WULFRAM_CDP_PORT ?? 9223);
const expectedUrlPrefix = process.env.WULFRAM_CDP_URL_PREFIX ?? 'http://localhost:3000';
const viewportWidth = Number(process.env.WULFRAM_VIEWPORT_WIDTH ?? 1440);
const viewportHeight = Number(process.env.WULFRAM_VIEWPORT_HEIGHT ?? 1000);
const deviceScaleFactor = Number(process.env.WULFRAM_DEVICE_SCALE_FACTOR ?? 1);
if (!Number.isInteger(viewportWidth) || viewportWidth < 800
  || !Number.isInteger(viewportHeight) || viewportHeight < 600
  || !Number.isFinite(deviceScaleFactor) || deviceScaleFactor < 1 || deviceScaleFactor > 4) {
  throw new Error('Viewport width/height and device scale factor are outside the supported smoke-test range.');
}
const outputPath = path.resolve(process.argv[2] ?? 'artifacts/balanced-generator-dialog.png');
const persistenceDirectory = process.argv[3] ? path.resolve(process.argv[3]) : undefined;
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
await cdp('Performance.enable');
await cdp('Emulation.setDeviceMetricsOverride', {
  width: viewportWidth,
  height: viewportHeight,
  deviceScaleFactor,
  mobile: false,
});
if (persistenceDirectory) await evaluate("localStorage.removeItem('wulfram-forge-project-v1')");
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
const generationStartedAt = performance.now();
await evaluate("Array.from(document.querySelectorAll('.balanced-generator-footer button')).find((button) => button.textContent.includes('Generate three'))?.click()");
await waitFor("document.querySelectorAll('.balanced-candidate-grid > button').length === 3");
const generationDurationMs = performance.now() - generationStartedAt;

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
    viewport: {
      width: innerWidth,
      height: innerHeight,
      devicePixelRatio,
      documentWidth: document.documentElement.scrollWidth,
      documentHeight: document.documentElement.scrollHeight,
    },
  };
})()`);

if (result.candidateCount !== 3 || result.passingCount < 1 || result.selectedCount !== 1
  || result.applyDisabled !== false || result.gateCount !== 11) {
  throw new Error(`Balanced dialog smoke check failed: ${JSON.stringify(result)}`);
}
if (result.viewport.documentWidth > result.viewport.width
  || result.viewport.documentHeight > result.viewport.height) {
  throw new Error(`Balanced dialog overflows the configured viewport: ${JSON.stringify(result.viewport)}`);
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
let persistence;
if (persistenceDirectory) {
  if (fs.existsSync(persistenceDirectory)) {
    throw new Error(`Persistence output directory already exists: ${persistenceDirectory}`);
  }
  fs.mkdirSync(persistenceDirectory, { recursive: true });

  const undoEnabled = await evaluate("!document.querySelector('button[aria-label=\"Undo\"]')?.disabled");
  if (!undoEnabled) throw new Error('Generated candidate did not create an undo entry.');
  await evaluate("document.querySelector('button[aria-label=\"Undo\"]')?.click()");
  await waitFor("document.querySelector('.map-title input')?.value !== 'Balanced UI Smoke'");
  const undoneName = await evaluate("document.querySelector('.map-title input')?.value");
  const redoEnabled = await evaluate("!document.querySelector('button[aria-label=\"Redo\"]')?.disabled");
  if (!redoEnabled) throw new Error('Undo did not create a redo entry.');
  await evaluate("document.querySelector('button[aria-label=\"Redo\"]')?.click()");
  await waitFor("document.querySelector('.map-title input')?.value === 'Balanced UI Smoke'");

  await evaluate("document.querySelector('button[title^=\"Save the complete editor project\"]')?.click()");
  await waitFor("document.querySelector('.statusbar')?.textContent?.includes('Project saved in this browser')");
  const localProject = await evaluate(`(() => {
    const value = localStorage.getItem('wulfram-forge-project-v1');
    if (!value) return null;
    const parsed = JSON.parse(value);
    return {
      name: parsed.name,
      mapGeneratorVersion: parsed.metadata?.['generator.version'],
      layoutGeneratorVersion: parsed.baseLayouts?.[0]?.metadata?.['generator.version'],
      seed: parsed.baseLayouts?.[0]?.metadata?.['generator.seed'],
    };
  })()`);
  if (localProject?.name !== 'Balanced UI Smoke'
    || !localProject.mapGeneratorVersion
    || localProject.mapGeneratorVersion !== localProject.layoutGeneratorVersion
    || !localProject.seed) {
    throw new Error(`Local project persistence failed: ${JSON.stringify(localProject)}`);
  }

  await cdp('Browser.setDownloadBehavior', {
    behavior: 'allow',
    downloadPath: persistenceDirectory,
    eventsEnabled: true,
  });
  await evaluate("document.querySelector('button[title=\"Export Wulfram package\"]')?.click()");
  const downloadDeadline = Date.now() + 20000;
  let archivePath;
  while (Date.now() < downloadDeadline) {
    const files = fs.readdirSync(persistenceDirectory);
    archivePath = files.find((name) => name.endsWith('.zip') && !name.endsWith('.crdownload'));
    if (archivePath) {
      archivePath = path.join(persistenceDirectory, archivePath);
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (!archivePath) throw new Error('Timed out waiting for the exported map ZIP.');
  const archiveEntries = await readMapArchive(fs.readFileSync(archivePath));
  const projectEntry = archiveEntries.find((entry) => entry.name.endsWith('/wulfram-project.json'));
  const reopenedProject = projectEntry ? JSON.parse(projectEntry.text) : undefined;
  if (reopenedProject?.name !== 'Balanced UI Smoke'
    || !reopenedProject.metadata?.['generator.version']
    || reopenedProject.metadata['generator.version']
      !== reopenedProject.baseLayouts?.[0]?.metadata?.['generator.version']) {
    throw new Error('Exported map ZIP did not reopen as the generated project.');
  }

  await cdp('Page.reload', { ignoreCache: true });
  await waitFor("document.querySelector('.map-title input')?.value === 'Balanced UI Smoke'");
  const reloadNotice = await evaluate("document.querySelector('.statusbar')?.textContent");
  if (!reloadNotice?.includes('Restored the latest local project')) {
    throw new Error(`Local reload did not report restoration: ${reloadNotice}`);
  }

  await evaluate(`(() => {
    const input = document.querySelector('.map-title input');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, 'Temporary replacement');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await waitFor("document.querySelector('.map-title input')?.value === 'Temporary replacement'");
  await evaluate("localStorage.removeItem('wulfram-forge-project-v1')");
  await cdp('DOM.enable');
  const documentNode = await cdp('DOM.getDocument', { depth: 1 });
  const fileInput = await cdp('DOM.querySelector', {
    nodeId: documentNode.root.nodeId,
    selector: 'input.sr-only[type="file"]:not([accept])',
  });
  if (!fileInput.nodeId) throw new Error('Map import input was not found.');
  await cdp('DOM.setFileInputFiles', { files: [archivePath], nodeId: fileInput.nodeId });
  await waitFor("document.querySelector('.map-title input')?.value === 'Balanced UI Smoke'");
  await waitFor(`(() => {
    const value = localStorage.getItem('wulfram-forge-project-v1');
    if (!value) return false;
    const parsed = JSON.parse(value);
    return parsed.metadata?.['generator.version']
      && parsed.metadata['generator.version'] === parsed.baseLayouts?.[0]?.metadata?.['generator.version'];
  })()`);
  const importNotice = await evaluate("document.querySelector('.statusbar')?.textContent");
  if (!importNotice?.includes('Project Balanced UI Smoke imported')) {
    throw new Error(`Exported map did not import through the UI: ${importNotice}`);
  }
  persistence = {
    undoneName,
    redoName: 'Balanced UI Smoke',
    localProject,
    reloadNotice,
    archivePath,
    archiveBytes: fs.statSync(archivePath).size,
    importedName: reopenedProject.name,
    importNotice,
  };
}
if (runtimeErrors.length) throw new Error(`Browser runtime errors: ${runtimeErrors.join(' | ')}`);
const performanceMetrics = await cdp('Performance.getMetrics');
const metric = (name) => performanceMetrics.metrics.find((item) => item.name === name)?.value;
console.log(JSON.stringify({
  ...result,
  generationDurationMs,
  jsHeapUsedBytes: metric('JSHeapUsedSize'),
  jsHeapTotalBytes: metric('JSHeapTotalSize'),
  ...applied,
  screenshot: outputPath,
  appliedScreenshot: appliedOutputPath,
  persistence,
}, null, 2));
socket.close();

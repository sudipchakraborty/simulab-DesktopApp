/** @file Measure genuine Uno firmware throughput with native speed modes and an optional unchanged browser worker.
 * @details Example: node scripts/benchmark_engine.mjs --browser --samples 3 --duration-ms 1000
 * The optional comparison serves the explicit frontend read-only, keeps Vite caches in a temporary directory,
 * and starts/closes only its own Chromium/server. JSON results are written to stdout; no source repo is changed.
 */
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { tmpdir, platform, arch, cpus } from "node:os";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { performance } from "node:perf_hooks";

const desktop = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index < 0 ? fallback : args[index + 1];
};
const samples = Number(option("--samples", 3));
const durationMs = Number(option("--duration-ms", 1000));
const frontend = resolve(option("--frontend", join(desktop, "../simulab-frontend")));
if (!Number.isSafeInteger(samples) || samples < 1 || samples > 20 ||
    !Number.isSafeInteger(durationMs) || durationMs < 100 || durationMs > 10000)
  throw new Error("Use 1..20 samples and a duration-ms from 100 to 10000.");
const hex = await readFile(join(desktop, "src/simulab_desktop/resources/firmware/blink-uart.hex"), "utf8");
const project = {
  schemaVersion: "1.4.0", name: "Equivalent Uno firmware throughput benchmark", wires: [],
  components: [{ id: "mcu", kind: "uno", label: "Uno", position: { x: 0, y: 0 }, rotation: 0, properties: { clockHz: 16000000 } }],
};
const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

/** @brief Parameterized JSONL child client; all cycle/time evidence comes from actual runtime snapshots. */
class JsonRuntime {
  constructor() {
    this.sequence = 0; this.session = 0; this.pending = new Map(); this.stderr = "";
    this.collect = false; this.serial = ""; this.frames = 0;
    this.child = spawn(process.execPath, [join(desktop, "src/simulab_desktop/runtime/bridge.mjs")], {
      cwd: desktop, stdio: ["pipe", "pipe", "pipe"], windowsHide: true,
    });
    this.ready = new Promise((resolve, reject) => { this.onReady = resolve; this.onReadyError = reject; });
    this.exited = new Promise(resolve => this.child.once("exit", (code, signal) => {
      this.exitStatus = { code, signal };
      const error = new Error(`Native runtime exited: ${JSON.stringify(this.exitStatus)} ${this.stderr}`);
      this.onReadyError(error);
      for (const entry of this.pending.values()) { clearTimeout(entry.timer); entry.reject(error); }
      this.pending.clear(); resolve();
    }));
    this.child.on("error", error => this.onReadyError(error));
    this.child.stderr.setEncoding("utf8");
    this.child.stderr.on("data", text => { this.stderr = (this.stderr + text).slice(-16384); });
    this.lines = createInterface({ input: this.child.stdout });
    this.lines.on("line", line => {
      const message = JSON.parse(line);
      if (this.collect && message.type === "snapshot") {
        this.serial += message.snapshot.serial;
        if (message.id === 0) this.frames++;
      }
      if (message.type === "ready") this.onReady(message);
      const entry = this.pending.get(message.id);
      if (entry) {
        this.pending.delete(message.id); clearTimeout(entry.timer);
        if (message.type === "error" || message.type === "instrument-error") entry.reject(new Error(message.message));
        else entry.resolve(message);
      }
    });
  }

  command(type, fields = {}) {
    const id = ++this.sequence;
    if (type === "load") this.session++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error("Native runtime command timeout: " + type)); }, 15000);
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin.write(JSON.stringify({ version: "1.0.0", id, session: this.session, type, ...fields }) + "\n");
    });
  }

  async close() {
    if (!this.exitStatus) {
      try { await this.command("dispose"); } catch { /* Retain original measurement failure. */ }
      this.child.stdin.end();
      const timeout = setTimeout(() => this.child.kill(), 3000);
      await this.exited; clearTimeout(timeout);
    }
    this.lines.close();
  }
}

/** @brief Exclude load and a short live warmup from the measured interval. */
async function nativeSample(mode, sample) {
  const runtime = new JsonRuntime();
  try {
    await runtime.ready;
    await runtime.command("speed", { mode });
    await runtime.command("load", { target: "uno", project, hex });
    await runtime.command("start"); await wait(150);
    await runtime.command("pause"); await runtime.command("reset");
    runtime.collect = true;
    const begin = performance.now();
    const start = await runtime.command("start");
    await wait(durationMs);
    const pauseAt = performance.now();
    const stop = await runtime.command("pause");
    const end = performance.now();
    runtime.collect = false;
    return metrics(`native-${mode}`, sample, end - begin, end - pauseAt,
      stop.snapshot.cycles - start.snapshot.cycles,
      stop.snapshot.timeMicros - start.snapshot.timeMicros, runtime.frames, runtime.serial);
  } finally { await runtime.close(); }
}

function metrics(host, sample, wallMs, pauseMs, cycles, timeMicros, frames, serial) {
  if (!serial.includes("SIMULAB AVR READY")) throw new Error(host + " did not produce genuine fixture UART evidence");
  return { host, sample, wallMs, pauseMs, cycles, timeMicros,
    realtimeRatio: timeMicros / (wallMs * 1000), cyclesPerWallSecond: cycles * 1000 / wallMs,
    liveFrames: frames, liveFramesPerSecond: frames * 1000 / wallMs,
    uartBytes: serial.length, firmwareUartVerified: true };
}

/** @brief Run the actual unchanged browser Worker served by Vite; its existing AVR scheduler sleeps 10ms per batch. */
async function browserSample(page, sample) {
  const result = await page.evaluate(async ({ project, hex, durationMs }) => {
    const worker = new Worker("/src/simulation/avr.worker.ts", { type: "module" });
    const pending = new Map(); let id = 0; let collect = false; let serial = ""; let frames = 0;
    worker.onmessage = event => {
      const message = event.data;
      if (collect && message.type === "snapshot") {
        serial += message.snapshot.serial;
        if (message.id === 0) frames++;
      }
      const entry = pending.get(message.id);
      if (entry) {
        pending.delete(message.id); clearTimeout(entry.timer);
        if (message.type === "error") entry.reject(new Error(message.message));
        else entry.resolve(message);
      }
    };
    worker.onerror = event => {
      for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(new Error(event.message)); }
      pending.clear();
    };
    const command = (type, fields = {}) => new Promise((resolve, reject) => {
      const requestId = ++id;
      const timer = setTimeout(() => { pending.delete(requestId); reject(new Error("Browser worker command timeout: " + type)); }, 15000);
      pending.set(requestId, { resolve, reject, timer });
      worker.postMessage({ version: "1.2.0", id: requestId, type, ...fields });
    });
    const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
    try {
      await command("load", { project, hex });
      await command("start"); await wait(150);
      await command("pause"); await command("reset");
      collect = true;
      const begin = performance.now(); const start = await command("start");
      await wait(durationMs);
      const pauseAt = performance.now(); const stop = await command("pause");
      const end = performance.now(); collect = false;
      return { wallMs: end - begin, pauseMs: end - pauseAt,
        cycles: stop.snapshot.cycles - start.snapshot.cycles,
        timeMicros: stop.snapshot.timeMicros - start.snapshot.timeMicros, frames, serial };
    } finally { worker.terminate(); }
  }, { project, hex, durationMs });
  return metrics("browser-original-10ms", sample, result.wallMs, result.pauseMs,
    result.cycles, result.timeMicros, result.frames, result.serial);
}

const report = {
  benchmark: "Genuine compiled Uno blink-uart firmware; one board, no electrical wires",
  generatedAt: new Date().toISOString(), node: process.version, platform: `${platform()}-${arch()}`,
  cpu: cpus()[0]?.model, samples, requestedWallMs: durationMs, warmupMs: 150,
  firmwareSha256: createHash("sha256").update(hex).digest("hex"),
  fixture: "resources/firmware/blink-uart.hex", startupIncluded: false,
  limits: "Single-machine short throughput samples; no GUI rendering, cold startup or physical hardware comparison. Host load affects timing.",
  results: [],
};

let server; let browser; let cache;
try {
  let page;
  if (args.includes("--browser")) {
    cache = await mkdtemp(join(tmpdir(), "simulab-engine-benchmark-"));
    const requireFrontend = createRequire(join(frontend, "package.json"));
    const { chromium } = requireFrontend("@playwright/test");
    const { createServer } = await import(pathToFileURL(join(frontend, "node_modules/vite/dist/node/index.js")).href);
    server = await createServer({ root: frontend, configFile: false, cacheDir: cache,
      logLevel: "error", optimizeDeps: { noDiscovery: true },
      server: { host: "127.0.0.1", port: 0, strictPort: true, watch: null },
    });
    server.middlewares.use((request, response, next) => {
      if (request.url !== "/__simulab_benchmark__") return next();
      response.setHeader("Content-Type", "text/html");
      response.end("<!doctype html><title>SimuLab runtime benchmark</title>");
    });
    await server.listen();
    const address = server.httpServer.address();
    browser = await chromium.launch({ headless: true });
    report.chromium = browser.version();
    page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${address.port}/__simulab_benchmark__`);
  }
  for (let sample = 1; sample <= samples; sample++) {
    report.results.push(await nativeSample("maximum", sample));
    report.results.push(await nativeSample("realtime", sample));
    if (page) report.results.push(await browserSample(page, sample));
  }
  report.summaries = Object.fromEntries([...new Set(report.results.map(row => row.host))].map(host => {
    const rows = report.results.filter(row => row.host === host);
    const median = key => rows.map(row => row[key]).sort((a, b) => a - b)[Math.floor(rows.length / 2)];
    return [host, { medianRealtimeRatio: median("realtimeRatio"), medianCyclesPerWallSecond: median("cyclesPerWallSecond"),
      medianPauseMs: median("pauseMs"), medianLiveFramesPerSecond: median("liveFramesPerSecond") }];
  }));
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser?.close();
  await server?.close();
  if (cache) {
    const resolvedCache = resolve(cache);
    const allowed = resolve(tmpdir()) + (platform() === "win32" ? "\\" : "/");
    if (!resolvedCache.startsWith(allowed) || !resolvedCache.includes("simulab-engine-benchmark-"))
      throw new Error("Refusing cleanup outside the benchmark temporary directory.");
    await rm(resolvedCache, { recursive: true, force: true });
  }
}

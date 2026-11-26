/** @file Versioned local JSON-lines transport for the native desktop process.
 * @details stdout contains protocol JSON only. The parent supplies monotonic session IDs and owns UI scheduling.
 */
import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { RuntimeSession, SessionError, InstrumentRequestError } from "./session.mjs";
import { pacingDelay } from "./pacing.mjs";
import * as espBinding from "../resources/emulators/esp-emu-0.51.0/esp_emu.js";

const VERSION = "1.0.0";
const MAX_LINE = 24 * 1024 * 1024;
const FRAME_MS = 1000 / 30;
let active;
let sessionId = 0;
let live = false;
let timer;
let timerKind;
let lastFrame = 0;
let blocked = false;
let deterministic;
let initializedEsp = false;
let speedMode = "maximum";
let pacingWall = 0;
let pacingMicros = 0;
let lastTickMicros = 0;

/** @brief Encode one bounded protocol reply; backpressure suspends further live execution. */
function send(type, id, session, fields = {}) {
  const writable = process.stdout.write(JSON.stringify({ version: VERSION, id, session, type, ...fields }) + "\n");
  if (!writable) { blocked = true; process.stdin.pause(); }
}

/** @brief Cancel the correct host scheduling primitive, including a pending maximum-speed immediate. */
function clearScheduled() {
  if (timerKind === "immediate") clearImmediate(timer);
  else clearTimeout(timer);
  timer = undefined;
  timerKind = undefined;
}

function cancelLive() { clearScheduled(); live = false; }

/** @brief Anchor pacing to the current real emulated time; changing speed never resets firmware. */
function rebasePacing() {
  pacingWall = performance.now();
  pacingMicros = active?.latest.timeMicros ?? 0;
  lastTickMicros = pacingMicros;
}

/** @brief Maximum mode yields to I/O without an artificial delay; realtime waits only when emulation is ahead. */
function scheduleTick() {
  if (!live || !active || blocked || timer) return;
  const aheadMs = pacingDelay({ mode: speedMode, simulationMicros: active.latest.timeMicros,
    originMicros: pacingMicros, wallMs: performance.now(), originWallMs: pacingWall });
  if (aheadMs > 0) {
    timerKind = "timeout";
    timer = setTimeout(tick, aheadMs);
  } else {
    timerKind = "immediate";
    timer = setImmediate(tick);
  }
}

function disposeActive() {
  cancelLive();
  deterministic = undefined;
  if (active) { const previous = active; active = undefined; previous.dispose(); }
}

/** @brief Surface original engine errors. Input/request rejection never substitutes another firmware image. */
function failure(command, error) {
  const instrument = error instanceof InstrumentRequestError;
  const id = Number.isSafeInteger(command.id) && command.id >= 0 ? command.id : 0;
  const owner = Number.isSafeInteger(command.session) && command.session >= 0 ? command.session : sessionId;
  send(instrument ? "instrument-error" : "error", id, owner, {
    code: error.code ?? (instrument ? "INSTRUMENT_REQUEST" : "RUNTIME_ERROR"),
    message: error instanceof Error ? error.message : String(error),
    ...(instrument ? { componentId: command.componentId } : {}),
  });
}

function snapshot(command, session = active) {
  if (!session) throw new SessionError("NOT_LOADED", "Load compatible firmware before operating the MCU.");
  send("snapshot", command.id, command.session, { ...session.capture(), speedMode });
}

/** @brief Execute bounded genuine MCU batches while yielding between slices for pause/input/stop requests. */
function tick() {
  timer = undefined;
  timerKind = undefined;
  if (!live || !active || blocked) return;
  const current = active;
  try {
    const s3 = current.target === "esp32s3";
    const mega = current.target === "mega2560";
    current.runSlice(s3 ? 100000 : mega ? 16000 : 160000);
    if (current.latest.timeMicros < lastTickMicros) rebasePacing();
    lastTickMicros = current.latest.timeMicros;
    const now = performance.now();
    if (now - lastFrame >= FRAME_MS) {
      snapshot({ id: 0, session: current.id }, current);
      lastFrame = now;
    }
    if (live && active === current) scheduleTick();
  } catch (error) {
    cancelLive();
    try { current.runtime.stop(); } catch { /* Preserve the original WASM/CPU error. */ }
    failure({ id: 0, session: current.id }, error);
  }
}

function startLive() {
  live = true;
  lastFrame = performance.now();
  rebasePacing();
  scheduleTick();
}

/** @brief Run a deterministic requested budget without live transport frames or wall-clock timing. */
async function run(command, current) {
  if (deterministic) throw new SessionError("BUSY", "A deterministic run is already in progress.");
  const s3 = current.target === "esp32s3";
  const requested = s3 ? command.instructions : command.cycles;
  if (!Number.isSafeInteger(requested) || requested < 1 || requested > 100_000_000)
    throw new SessionError("INVALID_BUDGET", `Provide an integer ${s3 ? "instructions" : "cycles"} budget from 1 to 100000000.`);
  cancelLive();
  const token = {};
  deterministic = token;
  try {
    const state = current.latest.state;
    if (state === "ready" || state === "stopped") current.lifecycle("start");
    else if (state === "paused") current.lifecycle("resume");
    let remaining = requested;
    current.ingest(current.runtime.snapshot());
    const endCycle = current.latest.cycles + requested;
    while (remaining > 0) {
      if (active !== current || deterministic !== token)
        throw new SessionError("STALE_SESSION", "The loaded session changed during execution.");
      const result = current.runSlice(Math.min(s3 ? 100000 : current.target === "mega2560" ? 16000 : 160000, remaining));
      remaining = s3 ? remaining - Math.min(100000, remaining) : Math.max(0, endCycle - result.cycles);
      await new Promise(resolve => setImmediate(resolve));
      if (active !== current || deterministic !== token)
        throw new SessionError("STALE_SESSION", "The loaded session changed during execution.");
      if (current.latest.state !== "running") break;
    }
    snapshot(command, current);
  } finally {
    if (deterministic === token) deterministic = undefined;
  }
}

/** @brief Validate message ownership before dispatching any state-changing runtime operation. */
async function dispatch(command) {
  if (!command || typeof command !== "object" || command.version !== VERSION ||
      !Number.isSafeInteger(command.id) || command.id < 0 ||
      !Number.isSafeInteger(command.session) || command.session < 0 || typeof command.type !== "string")
    throw new SessionError("INVALID_PROTOCOL", "Expected JSON protocol 1.0.0 with nonnegative integer id/session.");
  if (command.type === "load") {
    if (command.session <= sessionId)
      throw new SessionError("STALE_SESSION", "A firmware load requires a newer monotonic session ID.");
    disposeActive();
    sessionId = command.session;
    if (command.target === "esp32s3" && !initializedEsp) {
      espBinding.initSync({ module: readFileSync(new URL("../resources/emulators/esp-emu-0.51.0/esp_emu_bg.wasm", import.meta.url)) });
      initializedEsp = true;
    }
    active = new RuntimeSession(command, espBinding);
    snapshot(command);
    return;
  }
  if (command.session !== sessionId)
    throw new SessionError("STALE_SESSION", "This command belongs to an older loaded session.");
  if (command.type === "speed") {
    if (!["maximum", "realtime"].includes(command.mode))
      throw new SessionError("INVALID_SPEED", "Simulation speed mode must be maximum or realtime.");
    speedMode = command.mode;
    rebasePacing();
    clearScheduled();
    scheduleTick();
    send("speed", command.id, command.session, { mode: speedMode, speedMode });
    return;
  }
  if (command.type === "dispose") {
    disposeActive();
    send("disposed", command.id, command.session);
    return;
  }
  const current = active;
  if (!current) throw new SessionError("NOT_LOADED", "Load compatible firmware before operating the MCU.");
  switch (command.type) {
    case "run": await run(command, current); return;
    case "start": case "resume":
      if (deterministic) throw new SessionError("BUSY", "Wait for the deterministic run before starting live execution.");
      current.lifecycle(command.type); cancelLive(); snapshot(command); startLive(); return;
    case "pause": case "stop": case "reset":
      cancelLive(); current.lifecycle(command.type); snapshot(command); return;
    case "snapshot": snapshot(command); return;
    case "step": current.step(); cancelLive(); snapshot(command); return;
    case "uart": current.uart(command.text); snapshot(command); return;
    case "pin": current.setPin(command.pin, command.level); snapshot(command); return;
    case "device": current.setDevice(command.componentId, command.properties); snapshot(command); return;
    case "instrument": {
      current.instrument(command.componentId, command.action, command.text);
      if (["pause", "stop", "reset", "step"].includes(command.action)) cancelLive();
      snapshot(command);
      if (command.action === "resume") { cancelLive(); startLive(); }
      return;
    }
    default: throw new SessionError("UNSUPPORTED_COMMAND", "Unsupported desktop runtime operation.");
  }
}

let pending = "";
let discarding = false;
process.stdin.setEncoding("utf8");
process.stdin.on("data", chunk => {
  pending += chunk;
  let newline;
  while ((newline = pending.indexOf("\n")) >= 0) {
    const line = pending.slice(0, newline);
    pending = pending.slice(newline + 1);
    if (discarding) { discarding = false; continue; }
    if (!line.trim()) continue;
    if (Buffer.byteLength(line) > MAX_LINE) { failure({}, new SessionError("INPUT_LIMIT", "Protocol line exceeds 24 MiB.")); continue; }
    let command;
    try { command = JSON.parse(line); }
    catch { failure({}, new SessionError("INVALID_JSON", "Expected one JSON command per line.")); continue; }
    dispatch(command).catch(error => failure(command ?? {}, error));
  }
  if (Buffer.byteLength(pending) > MAX_LINE) {
    pending = ""; discarding = true;
    failure({}, new SessionError("INPUT_LIMIT", "Protocol line exceeds 24 MiB."));
  }
});
process.stdout.on("drain", () => {
  blocked = false;
  process.stdin.resume();
  scheduleTick();
});
process.stdin.on("end", () => { try { disposeActive(); } catch { /* Child exits after its host closes the channel. */ } });
process.stdout.on("error", error => {
  if (error.code === "EPIPE") { try { disposeActive(); } catch {} process.exitCode = 0; }
  else { process.stderr.write(String(error) + "\n"); process.exitCode = 1; }
});
send("ready", 0, 0, {
  targets: ["uno", "nano", "mega2560", "esp32s3"], engineContract: "1.0.0",
  speedMode, speedModes: ["maximum", "realtime"],
});

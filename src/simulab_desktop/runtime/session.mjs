/** @file Parameter-initialized genuine MCU/circuit session, independent of process transport and Python UI. */
import {
  AvrRuntime, Esp32S3Runtime, CircuitRuntime, InstrumentSession,
  InstrumentRequestError, parseProject, simulationTarget, projectSignals,
  controllerPinStates, buttonInputs, capabilities,
} from "../resources/engine.mjs";

/** @brief A transport-safe failure preserving the engine's explicit error contract. */
export class SessionError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

/** @brief Own a loaded MCU, its parameterized devices and drained output until the host transports it.
 * @param command Validated protocol load command with explicit session and MCU target.
 * @param espBindings Initialized official WASM binding; required only for the S3 target.
 */
export class RuntimeSession {
  constructor(command, espBindings) {
    if (!["uno", "nano", "mega2560", "esp32s3"].includes(command.target))
      throw new SessionError("UNSUPPORTED_TARGET", "Choose uno, nano, mega2560 or esp32s3; no MCU fallback is available.");
    this.id = command.session;
    this.target = command.target;
    this.project = parseProject(JSON.stringify(command.project));
    if (simulationTarget(this.project) !== this.target)
      throw new SessionError("TARGET_MISMATCH", "Firmware target must match exactly one supported circuit controller.");
    this.inputs = new Map();
    // With no electrical wires, no external device can affect a CPU read. Keep
    // snapshots/real GPIO events, and avoid solving an empty circuit per PIN read.
    this.immediateDevices = this.project.wires.some(wire =>
      ![wire.from.pinId, wire.to.pinId].some(pin => ["DEBUG", "CONSOLE"].includes(pin)));
    this.serial = "";
    this.transitions = [];
    this.devices = new CircuitRuntime(this.project, this.target);
    this.instruments = new InstrumentSession(this.project);
    this.devices.advance(0, {});
    if (this.target === "esp32s3") {
      if (typeof command.firmwareBase64 !== "string" || !command.firmwareBase64.length ||
          command.firmwareBase64.length > 22_369_624 || command.firmwareBase64.length % 4 !== 0 ||
          !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(command.firmwareBase64))
        throw new SessionError("INVALID_FIRMWARE", "ESP32-S3 requires bounded base64 merged flash bytes.");
      this.runtime = new Esp32S3Runtime(espBindings, new Uint8Array(Buffer.from(command.firmwareBase64, "base64")));
    } else {
      this.runtime = new AvrRuntime(command.hex, {
        mcu: this.target === "mega2560" ? "atmega2560" : "atmega328p",
        i2c: {
          write: (address, bytes) => this.devices.i2cWrite(address, bytes),
          read: (address, count) => this.devices.i2cRead(address, count),
        },
        ...(this.immediateDevices ? {
          onGpioTransition: (event, gpio) => this.advanceDevices(event.cycle / 16, gpio, [event]),
          onBeforeInputRead: (timeUs, gpio) => this.advanceDevices(timeUs, gpio),
        } : {}),
      });
    }
    this.applyButtons();
    this.ingest(this.runtime.snapshot());
  }

  /** @brief Return actual architecture-specific support, including unsupported external S3 buses. */
  getCapabilities() {
    return this.target === "esp32s3" ? this.runtime.getCapabilities() : {
      ...capabilities, mcu: this.target === "mega2560" ? "atmega2560" : "atmega328p",
      board: this.target, budgetUnit: "cycles", i2c: true, i2cMode: "injected-logical-device-bus",
      timers: this.target === "mega2560" ? [0, 1, 2, 3, 4, 5] : [0, 1, 2],
      unverifiedTimers: this.target === "mega2560" ? [2, 3, 4, 5] : [],
      uartInstances: [0], instructionStep: true, sourceDebug: false, physicalHardwareValidated: false,
    };
  }

  /** @brief Settle real behavioral devices before the MCU observes its next PIN/TWI register. */
  advanceDevices(timeUs, gpio, transitions = []) {
    if (!this.immediateDevices) return;
    if (timeUs < this.devices.timeMicros)
      this.devices = new CircuitRuntime(this.project, this.target);
    this.devices.advance(timeUs, gpio, transitions);
    this.applyDeviceInputs(gpio);
  }

  /** @brief Apply the circuit's resolved inputs, followed by explicitly injected host inputs. */
  applyDeviceInputs(gpio) {
    if (!this.runtime) return;
    for (const [pin, level] of Object.entries(this.devices.inputLevels())) {
      if (gpio[pin] !== null || this.inputs.has(pin)) continue;
      if (this.target !== "esp32s3") this.runtime.setPinLevel(pin, level);
      else if (level !== null) this.runtime.setPin(pin, level === 1);
    }
    for (const [pin, level] of this.inputs) this.writePin(pin, level);
  }

  applyButtons() {
    for (const [pin, high] of Object.entries(buttonInputs(this.project))) this.runtime.setPin(pin, high);
    for (const [pin, level] of this.inputs) this.writePin(pin, level);
  }

  /** @brief Resolve a bounded public digital level without coercing malformed values. */
  setPin(pin, level) {
    if (typeof pin !== "string" || ![null, false, true, 0, 1].includes(level))
      throw new SessionError("INVALID_INPUT", "Pin input needs an explicit pin and boolean, 0, 1 or null level.");
    const value = level === null ? null : level === true || level === 1 ? 1 : 0;
    this.writePin(pin, value);
    this.inputs.set(pin, value);
  }

  writePin(pin, level) {
    if (this.target === "esp32s3") {
      if (level === null) throw new SessionError("UNSUPPORTED_INPUT", "The S3 binding cannot release an external input to floating state.");
      this.runtime.setPin(pin, level === 1);
    } else this.runtime.setPinLevel(pin, level);
  }

  /** @brief Update validated device parameters; switch changes preserve existing model clock/state.
   * @details Other parameter changes recreate the circuit device host at current MCU time. CPU/firmware state is retained.
   */
  setDevice(componentId, properties) {
    if (!properties || typeof properties !== "object" || Array.isArray(properties))
      throw new SessionError("INVALID_DEVICE", "Device properties must be an object.");
    const part = this.project.components.find(component => component.id === componentId);
    if (!part || ["uno", "nano", "mega2560", "yd-esp32-s3", "serial-monitor", "debugger"].includes(part.kind))
      throw new SessionError("INVALID_DEVICE", "Choose a circuit device; controller changes require a new load session.");
    const candidate = structuredClone(this.project);
    candidate.components.find(component => component.id === componentId).properties = { ...part.properties, ...properties };
    const validated = parseProject(JSON.stringify(candidate));
    part.properties = validated.components.find(component => component.id === componentId).properties;
    if (["switch", "tactile-switch"].includes(part.kind) && Object.keys(properties).every(key => key === "pressed"))
      this.devices.setButton(componentId, part.properties.pressed === true);
    else this.devices = new CircuitRuntime(this.project, this.target);
    this.applyButtons();
  }

  /** @brief Record every drained serial byte and GPIO event until a transport frame consumes them. */
  ingest(snapshot) {
    this.latest = snapshot;
    this.serial += snapshot.serial;
    this.transitions.push(...snapshot.transitions);
    if (this.serial.length > 1_048_576 || this.transitions.length > 65536)
      throw new SessionError("OUTPUT_LIMIT", "Pending desktop output exceeded its bounded buffer; shorten deterministic runs or drain snapshots.");
    if (snapshot.timeMicros < this.devices.timeMicros)
      this.devices = new CircuitRuntime(this.project, this.target);
    const components = this.devices.advance(snapshot.timeMicros, snapshot.gpio,
      this.target === "esp32s3" ? [] : snapshot.transitions);
    const contactWires = this.devices.contactWires();
    const projection = projectSignals({ ...this.project, wires: [...this.project.wires, ...contactWires] }, snapshot.gpio);
    projection.components = components;
    projection.pinStates = controllerPinStates(this.project, (id, pin) => this.devices.pinVoltage(id, pin));
    const debug = this.runtime.debugSnapshot?.();
    if (debug) projection.debug = debug;
    projection.instruments = this.instruments.capture(snapshot, debug, contactWires);
    projection.i2c = [...this.devices.transactions];
    Object.assign(projection.ledStates, this.devices.ledStates());
    projection.issues.push(...Object.values(components).flatMap(component => component.warnings));
    this.projection = projection;
    this.applyDeviceInputs(snapshot.gpio);
  }

  /** @brief Execute a single architecture-bounded CPU slice and retain actual device observations. */
  runSlice(budget) {
    const snapshot = this.target === "esp32s3" ? this.runtime.runBatch(budget) : this.runtime.runCycles(budget);
    this.ingest(snapshot);
    return snapshot;
  }

  /** @brief Capture once, drain once; callers can distribute the returned immutable JSON payload. */
  capture() {
    this.ingest(this.runtime.snapshot());
    const snapshot = { ...this.latest, serial: this.serial, transitions: this.transitions };
    this.serial = "";
    this.transitions = [];
    return { snapshot, projection: this.projection, target: this.target, capabilities: this.getCapabilities() };
  }

  /** @brief Lifecycle methods operate on the real runtime and refresh device/instrument state on reset. */
  lifecycle(operation) {
    this.runtime[operation]();
    if (operation === "reset" || operation === "start" && this.latest?.state === "stopped") {
      this.serial = "";
      this.transitions = [];
      this.devices = new CircuitRuntime(this.project, this.target);
      this.instruments.clear();
      this.applyButtons();
    }
  }

  /** @brief Queue bounded UTF-8 bytes into the genuine MCU USART/guest UART. */
  uart(text) {
    if (typeof text !== "string" || Buffer.byteLength(text, "utf8") > 4096)
      throw new SessionError("INPUT_LIMIT", "UART text must encode to at most 4096 bytes.");
    this.runtime.uartInput(new TextEncoder().encode(text));
  }

  /** @brief Step one real AVR instruction; reject unsupported S3 stepping explicitly. */
  step() {
    if (!this.runtime.stepInstruction)
      throw new SessionError("UNSUPPORTED_DEBUG", "Instruction stepping is unavailable for the ESP32-S3 adapter.");
    this.ingest(this.runtime.stepInstruction());
  }

  /** @brief Retain browser instrument wiring checks and recoverable request errors. */
  instrument(componentId, action, text) {
    try {
      const stepped = this.instruments.perform(componentId, action, text, this.runtime, this.devices.contactWires());
      if (action === "reset") {
        this.serial = ""; this.transitions = [];
        this.devices = new CircuitRuntime(this.project, this.target);
        this.applyButtons();
      }
      if (stepped) this.ingest(stepped);
    } catch (error) {
      if (error instanceof InstrumentRequestError) {
        this.instruments.recordError(componentId, error);
        throw error;
      }
      throw error;
    }
  }

  dispose() {
    try { this.runtime.stop(); } finally { this.runtime.dispose?.(); }
    this.inputs.clear(); this.serial = ""; this.transitions = [];
  }
}

export { InstrumentRequestError };

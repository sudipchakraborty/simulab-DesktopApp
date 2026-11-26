"""Real firmware integration tests for the standalone desktop JSONL process."""
from __future__ import annotations

import base64
import hashlib
import json
from pathlib import Path
import queue
import shutil
import subprocess
import tempfile
import threading
import time
import unittest


ROOT = Path(__file__).resolve().parents[1]
PACKAGE = ROOT / "src" / "simulab_desktop"


class Bridge:
    """@brief Exercise the actual Node child using its public protocol."""

    def __init__(self, package: Path = PACKAGE):
        self.package = package
        self.messages = queue.Queue()
        self.sequence = 0
        self.session = 0
        self.process = subprocess.Popen(
            [shutil.which("node") or "node", str(package / "runtime" / "bridge.mjs")],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            text=True, encoding="utf-8", bufsize=1,
        )
        self.reader = threading.Thread(target=self._read, daemon=True)
        self.reader.start()
        message = self.receive()
        if message.get("type") != "ready":
            self.close()
            raise AssertionError(f"Expected startup ready, got {message}")
        self.ready = message

    def _read(self):
        for line in self.process.stdout:
            try:
                self.messages.put(json.loads(line))
            except ValueError:
                self.messages.put({"type": "invalid-output", "line": line})
        self.messages.put({"type": "process-exit"})

    def receive(self, timeout=12):
        try:
            return self.messages.get(timeout=timeout)
        except queue.Empty:
            raise AssertionError("Runtime did not reply before timeout") from None

    def command(self, kind, **values):
        self.sequence += 1
        if kind == "load":
            self.session += 1
        message = dict(version="1.0.0", id=self.sequence, session=self.session, type=kind)
        message.update(values)
        self.process.stdin.write(json.dumps(message) + "\n")
        self.process.stdin.flush()
        deadline = time.monotonic() + 25
        while time.monotonic() < deadline:
            reply = self.receive(timeout=max(0.01, deadline - time.monotonic()))
            if reply.get("id") == self.sequence:
                return reply
            if reply.get("type") == "process-exit":
                raise AssertionError("Runtime exited: " + self.process.stderr.read())
        raise AssertionError("No matching runtime reply")

    def load(self, target="uno", fixture="blink-uart.hex", project=None):
        project = project or circuit("yd-esp32-s3" if target == "esp32s3" else target)
        path = self.package / "resources" / "firmware" / fixture
        firmware = ({"firmwareBase64": base64.b64encode(path.read_bytes()).decode("ascii")}
                    if target == "esp32s3" else {"hex": path.read_text("ascii")})
        return self.command("load", target=target, project=project, **firmware)

    def close(self):
        if self.process.poll() is None:
            try:
                self.command("dispose")
            except (OSError, AssertionError):
                pass
            self.process.stdin.close()
            try:
                self.process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self.process.kill()
                self.process.wait(timeout=5)
        for pipe in (self.process.stdout, self.process.stderr):
            pipe.close()


def component(kind, identity=None, properties=None):
    return dict(id=identity or kind, kind=kind, label=kind,
                position={"x": 0, "y": 0}, rotation=0, properties=properties or {})


def circuit(board="uno", extras=(), wires=()):
    return dict(schemaVersion="1.4.0", name="Runtime fixture",
                components=[component(board, "mcu"), *extras], wires=list(wires))


def wire(identity, a, ap, b, bp):
    return dict(id=identity, **{"from": {"componentId": a, "pinId": ap}},
                to={"componentId": b, "pinId": bp}, color="#008800", label="")


class RuntimeTests(unittest.TestCase):
    def setUp(self):
        self.bridge = Bridge()
        self.addCleanup(self.bridge.close)

    def ok(self, value):
        self.assertEqual(value.get("type"), "snapshot", value)
        self.assertEqual(value["version"], "1.0.0")
        self.assertEqual(value["session"], self.bridge.session)
        return value

    def test_real_uno_uart_cycle_time_reset_and_step(self):
        loaded = self.ok(self.bridge.load())
        self.assertIs(loaded["capabilities"]["i2c"], True)
        first = self.ok(self.bridge.command("run", cycles=8_500_000))
        self.assertEqual(first["snapshot"]["timeMicros"], first["snapshot"]["cycles"] / 16)
        self.assertIn("SIMULAB AVR READY\nLED ON\nLED OFF\n", first["snapshot"]["serial"])
        self.assertEqual(first["snapshot"]["gpio"]["D13"], 0)
        self.assertEqual(len(first["projection"]["debug"]["registers"]), 32)
        reset = self.ok(self.bridge.command("reset"))
        self.assertEqual(reset["snapshot"]["cycles"], 0)
        stepped = self.ok(self.bridge.command("step"))
        self.assertGreater(stepped["snapshot"]["cycles"], 0)
        self.assertEqual(stepped["snapshot"]["state"], "paused")

    def test_nano_real_input_and_mega_native_firmware(self):
        self.ok(self.bridge.load("nano", "input-mirror.hex"))
        self.ok(self.bridge.command("pin", pin="D2", level=False))
        self.assertEqual(self.ok(self.bridge.command("run", cycles=20000))["snapshot"]["gpio"]["D11"], 0)
        self.ok(self.bridge.command("pin", pin="D2", level=True))
        self.assertEqual(self.ok(self.bridge.command("run", cycles=20000))["snapshot"]["gpio"]["D11"], 1)
        self.ok(self.bridge.load("mega2560", "mega2560.hex"))
        self.ok(self.bridge.command("pin", pin="D2", level=True))
        mega = self.ok(self.bridge.command("run", cycles=8_500_000))
        self.assertIn("MEGA2560 REAL UART", mega["snapshot"]["serial"])
        self.assertEqual(mega["snapshot"]["gpio"]["D49"], 1)
        self.assertEqual(mega["snapshot"]["gpio"]["A8"], 1)

    def test_wrong_target_and_invalid_firmware_fail_explicitly(self):
        reply = self.bridge.load("esp32s3", "esp32s3-reference.bin", circuit("uno"))
        self.assertEqual(reply["type"], "error")
        reply = self.bridge.command("load", target="uno", project=circuit(), hex="void loop() {}")
        self.assertEqual(reply["type"], "error")
        reply = self.bridge.command("load", target="esp32", project=circuit(), hex="bad")
        self.assertEqual(reply["type"], "error")

    def test_stale_input_is_rejected_without_mutating_new_session(self):
        self.ok(self.bridge.load(fixture="input-mirror.hex"))
        previous_session = self.bridge.session
        self.ok(self.bridge.load(fixture="input-mirror.hex"))
        reply = self.bridge.command("pin", session=previous_session, pin="D2", level=True)
        self.assertEqual(reply["type"], "error")
        self.assertEqual(reply["code"], "STALE_SESSION")
        self.assertEqual(self.ok(self.bridge.command("run", cycles=20000))["snapshot"]["gpio"]["D11"], 0)

    def test_malformed_protocol_keeps_integer_error_envelope_and_process_alive(self):
        self.bridge.process.stdin.write('{"version":"bad","id":"bad","session":-1,"type":"load"}\n')
        self.bridge.process.stdin.flush()
        reply = self.bridge.receive()
        self.assertEqual(reply["type"], "error")
        self.assertEqual(reply["id"], 0)
        self.assertEqual(reply["session"], 0)
        self.ok(self.bridge.load())

    def test_wired_switch_device_reaches_actual_avr_input(self):
        project = circuit(extras=[component("switch", "button")], wires=[
            wire("input", "mcu", "D2", "button", "1"),
            wire("ground", "button", "2", "mcu", "GND"),
        ])
        self.ok(self.bridge.load(fixture="input-mirror.hex", project=project))
        self.ok(self.bridge.command("device", componentId="button", properties={"pressed": True}))
        self.assertEqual(self.ok(self.bridge.command("run", cycles=20000))["snapshot"]["gpio"]["D11"], 0)
        self.ok(self.bridge.command("device", componentId="button", properties={"pressed": False}))
        self.assertEqual(self.ok(self.bridge.command("run", cycles=20000))["snapshot"]["gpio"]["D11"], 1)

    def test_disconnected_instrument_rejection_keeps_cpu_usable(self):
        project = circuit(extras=[component("debugger", "debug"), component("serial-monitor", "serial")])
        self.ok(self.bridge.load(project=project))
        reply = self.bridge.command("instrument", componentId="debug", action="step")
        self.assertEqual(reply["type"], "instrument-error")
        reply = self.bridge.command("instrument", componentId="serial", action="send", text="x")
        self.assertEqual(reply["type"], "instrument-error")
        self.assertGreater(self.ok(self.bridge.command("run", cycles=1000))["snapshot"]["cycles"], 0)

    def test_wired_debugger_steps_real_cpu(self):
        project = circuit(extras=[component("debugger", "debug")],
                          wires=[wire("debug-link", "debug", "DEBUG", "mcu", "DEBUG")])
        self.ok(self.bridge.load(project=project))
        reply = self.ok(self.bridge.command("instrument", componentId="debug", action="step"))
        self.assertGreater(reply["snapshot"]["cycles"], 0)
        self.assertTrue(reply["projection"]["instruments"]["debug"]["connection"]["debug"])

    def test_wired_serial_logs_genuine_uart(self):
        project = circuit(extras=[component("serial-monitor", "serial")], wires=[
            wire("rx", "serial", "RX", "mcu", "D1"),
            wire("tx", "serial", "TX", "mcu", "D0"),
            wire("gnd", "serial", "GND", "mcu", "GND"),
        ])
        self.ok(self.bridge.load(project=project))
        reply = self.ok(self.bridge.command("run", cycles=500000))
        self.assertIn("SIMULAB AVR READY", reply["projection"]["instruments"]["serial"]["log"])
        self.assertTrue(reply["projection"]["instruments"]["serial"]["connection"]["receive"])

    def test_live_frames_are_throttled_session_owned_and_pause_is_responsive(self):
        self.ok(self.bridge.load())
        self.ok(self.bridge.command("start"))
        frames = []
        begin = time.monotonic()
        while time.monotonic() - begin < 0.30:
            frame = self.bridge.receive(timeout=1)
            if frame.get("type") == "snapshot":
                frames.append(frame)
        elapsed = time.monotonic() - begin
        self.assertLessEqual(len(frames), int(elapsed * 30) + 2)
        self.assertTrue(all(frame["session"] == self.bridge.session for frame in frames))
        begin = time.monotonic()
        self.assertEqual(self.ok(self.bridge.command("pause"))["snapshot"]["state"], "paused")
        self.assertLess(time.monotonic() - begin, 1)

    def test_speed_selection_rejection_preserves_firmware_session_and_time(self):
        self.assertEqual(self.bridge.ready["speedMode"], "maximum")
        selected = self.bridge.command("speed", mode="realtime")
        self.assertEqual(selected["type"], "speed")
        self.assertEqual(selected["mode"], "realtime")
        loaded = self.ok(self.bridge.load())
        self.assertEqual(loaded["speedMode"], "realtime")
        progressed = self.ok(self.bridge.command("run", cycles=20000))
        before = progressed["snapshot"]["cycles"]
        self.assertGreater(before, 0)
        owner = self.bridge.session
        selected = self.bridge.command("speed", mode="maximum")
        self.assertEqual(selected["type"], "speed")
        self.assertEqual(selected["session"], owner)
        current = self.ok(self.bridge.command("snapshot"))
        self.assertEqual(current["speedMode"], "maximum")
        self.assertEqual(current["snapshot"]["cycles"], before)
        rejected = self.bridge.command("speed", mode="turbo")
        self.assertEqual(rejected["type"], "error")
        self.assertEqual(rejected["code"], "INVALID_SPEED")
        unchanged = self.ok(self.bridge.command("snapshot"))
        self.assertEqual(unchanged["speedMode"], "maximum")
        self.assertEqual(unchanged["snapshot"]["cycles"], before)

    def test_both_live_speeds_accept_pin_input_and_pause_promptly(self):
        for mode in ["maximum", "realtime"]:
            with self.subTest(mode=mode):
                self.ok(self.bridge.load(fixture="input-mirror.hex"))
                self.assertEqual(self.bridge.command("speed", mode=mode)["type"], "speed")
                self.ok(self.bridge.command("start"))
                self.ok(self.bridge.command("pin", pin="D2", level=True))
                next_frame = self.bridge.receive(timeout=1)
                self.assertEqual(next_frame["type"], "snapshot")
                self.assertEqual(next_frame["speedMode"], mode)
                self.assertEqual(next_frame["snapshot"]["gpio"]["D11"], 1)
                started = time.monotonic()
                paused = self.ok(self.bridge.command("pause"))
                self.assertEqual(paused["snapshot"]["state"], "paused")
                self.assertLess(time.monotonic() - started, 1)

    def test_speed_change_while_running_retains_cpu_and_live_frames(self):
        self.ok(self.bridge.load())
        self.ok(self.bridge.command("start"))
        first = self.bridge.receive(timeout=1)
        before = first["snapshot"]["cycles"]
        self.assertEqual(self.bridge.command("speed", mode="realtime")["type"], "speed")
        frame = self.bridge.receive(timeout=1)
        self.assertEqual(frame["speedMode"], "realtime")
        self.assertEqual(frame["snapshot"]["state"], "running")
        self.assertGreaterEqual(frame["snapshot"]["cycles"], before)
        self.assertEqual(frame["session"], self.bridge.session)
        self.ok(self.bridge.command("pause"))

    def test_rejected_live_start_preserves_running_scheduler(self):
        self.ok(self.bridge.load())
        self.ok(self.bridge.command("start"))
        self.assertEqual(self.bridge.command("start")["type"], "error")
        next_frame = self.bridge.receive(timeout=0.5)
        self.assertEqual(next_frame["type"], "snapshot")
        self.assertEqual(next_frame["snapshot"]["state"], "running")

    def test_s3_actual_boot_uart_gpio_and_no_instruction_debug(self):
        self.ok(self.bridge.load("esp32s3", "esp32s3-reference.bin"))
        boot = self.ok(self.bridge.command("run", instructions=23_000_000))
        self.assertIn("MicroPython v1.29.0", boot["snapshot"]["serial"])
        self.assertIn(">>>", boot["snapshot"]["serial"])
        self.ok(self.bridge.command("uart", text="from machine import Pin; p=Pin(4,Pin.OUT); p.value(1); print('NATIVE_HIGH')\r"))
        high = self.ok(self.bridge.command("run", instructions=5_000_000))
        self.assertIn("\r\nNATIVE_HIGH\r\n", high["snapshot"]["serial"])
        self.assertEqual(high["snapshot"]["gpio"]["GPIO4"], 1)
        self.ok(self.bridge.command("uart", text="q=Pin(5,Pin.IN); print('INPUT='+str(q.value()))\r"))
        self.ok(self.bridge.command("pin", pin="GPIO5", level=True))
        high_input = self.ok(self.bridge.command("run", instructions=5_000_000))
        self.assertIn("\r\nINPUT=1\r\n", high_input["snapshot"]["serial"])
        self.ok(self.bridge.command("pin", pin="GPIO5", level=False))
        self.ok(self.bridge.command("uart", text="print('INPUT='+str(q.value()))\r"))
        low_input = self.ok(self.bridge.command("run", instructions=5_000_000))
        self.assertIn("\r\nINPUT=0\r\n", low_input["snapshot"]["serial"])
        self.ok(self.bridge.command("pause"))
        self.assertEqual(self.bridge.command("step")["type"], "error")


class PortableResourceTests(unittest.TestCase):
    def test_realtime_pacing_uses_cycle_time_and_maximum_never_waits(self):
        script = """
import { pacingDelay } from './src/simulab_desktop/runtime/pacing.mjs';
const anchor = { originMicros: 0, originWallMs: 100 };
console.log(JSON.stringify([
  pacingDelay({ ...anchor, mode: 'realtime', simulationMicros: 20000, wallMs: 105 }),
  pacingDelay({ ...anchor, mode: 'maximum', simulationMicros: 20000, wallMs: 105 }),
  pacingDelay({ ...anchor, mode: 'realtime', simulationMicros: 4000, wallMs: 110 }),
  pacingDelay({ ...anchor, mode: 'realtime', simulationMicros: 2000000, wallMs: 101 }),
]));
"""
        result = subprocess.run([shutil.which("node") or "node", "--input-type=module", "-e", script],
                                cwd=ROOT, capture_output=True, text=True, timeout=10)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout), [15, 0, 0, 50])

    def test_packaged_resource_hashes_match_provenance(self):
        resources = PACKAGE / "resources"
        manifest = json.loads((resources / "provenance.json").read_text("utf-8"))
        self.assertIn("frontend", manifest["sources"])
        self.assertIn("engine", manifest["sources"])
        for filename, record in manifest["files"].items():
            data = (resources / filename).read_bytes()
            self.assertEqual(len(data), record["bytes"], filename)
            self.assertEqual(hashlib.sha256(data).hexdigest(), record["sha256"], filename)

    def test_catalog_starters_and_standalone_runtime(self):
        self.assertTrue((PACKAGE / "runtime" / "bridge.mjs").is_file(), "Standalone bridge has not been implemented")
        catalog = json.loads((PACKAGE / "resources" / "catalog.json").read_text("utf-8"))
        self.assertGreaterEqual(len(catalog), 30)
        self.assertIn("DEBUG", [pin["id"] for pin in catalog["uno"]["pins"]])
        self.assertIn("CONSOLE", [pin["id"] for pin in catalog["yd-esp32-s3"]["pins"]])
        self.assertIn("category", catalog["ds3231"])
        starters = json.loads((PACKAGE / "resources" / "starters.json").read_text("utf-8"))
        self.assertEqual(starters["yd-esp32-s3"]["board"], "esp32s3")
        with tempfile.TemporaryDirectory() as directory:
            copy = Path(directory) / "standalone"
            shutil.copytree(PACKAGE / "runtime", copy / "runtime")
            shutil.copytree(PACKAGE / "resources", copy / "resources")
            runtime = Bridge(copy)
            try:
                self.assertEqual(runtime.load()["type"], "snapshot")
                self.assertIn("SIMULAB AVR READY", runtime.command("run", cycles=500000)["snapshot"]["serial"])
                self.assertEqual(runtime.load("esp32s3", "esp32s3-reference.bin")["type"], "snapshot")
                self.assertIn("MicroPython v1.29.0", runtime.command("run", instructions=23_000_000)["snapshot"]["serial"])
            finally:
                runtime.close()


if __name__ == "__main__":
    unittest.main()

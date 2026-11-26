"""@brief Reproducible real compiler-to-native-canvas and S3 smoke evidence.
@details Uses Qt's offscreen platform by default; never operates a physical board.
"""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import time

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

from PySide6.QtCore import QTimer
from PySide6.QtWidgets import QApplication

from simulab_desktop.core import editing
from simulab_desktop.core.registry import create_registry
from simulab_desktop.paths import resource_path
from simulab_desktop.ui.main_window import MainWindow
from simulab_desktop.ui.theme import apply_theme


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=Path("artifacts/native-validation.json"))
    args = parser.parse_args()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    application = QApplication([])
    apply_theme(application)
    window = MainWindow(create_registry(), data_dir=args.output.parent / "native-validation-data", restore=False)
    window.show()
    heartbeat = []
    timer = QTimer()
    timer.setInterval(50)
    timer.timeout.connect(lambda: heartbeat.append(time.perf_counter()))
    timer.start()
    report = {"physicalHardware": False, "checks": {}}

    def wait_until(predicate, seconds=20):
        end = time.perf_counter() + seconds
        while not predicate():
            application.processEvents()
            if time.perf_counter() >= end:
                raise RuntimeError("Native smoke timed out: " + window.output.log.toPlainText()[-2500:])
            time.sleep(.005)

    def add_instrument(kind, wires):
        controller = next(c for c in window.project["components"] if c["kind"] in {"uno", "yd-esp32-s3"})
        instrument = window.registry.create(kind, 650, 350)
        project = editing.add_component(window.project, instrument, window.registry)
        for local, remote in wires:
            project = editing.connect(project, {"componentId": instrument["id"], "pinId": local}, {"componentId": controller["id"], "pinId": remote}, window.registry)
        window.commit_project(project)
        return instrument["id"], controller["id"]

    try:
        window.place_component("uno", 80, 90)
        serial, board = add_instrument("serial-monitor", [("RX", "D1"), ("TX", "D0"), ("GND", "GND")])
        debug, _ = add_instrument("debugger", [("DEBUG", "DEBUG")])
        window.code.editors["sketch.ino"].setPlainText('''/** @brief Native desktop actual compiler smoke; no fixture firmware. */
void setup() { pinMode(13, OUTPUT); Serial.begin(9600); Serial.println("NATIVE CODE BUILD"); }
void loop() { digitalWrite(13, HIGH); Serial.println("NATIVE HIGH"); delay(100); digitalWrite(13, LOW); Serial.println("NATIVE LOW"); delay(100); }
''')
        progress = []
        window.progress.valueChanged.connect(lambda value: progress.append(value))
        started = time.perf_counter()
        window.build_code(True)
        wait_until(lambda: "NATIVE HIGH" in window.instruments._states.get(serial, {}).get("log", ""), 180)
        report["checks"]["compileToFirmwareUart"] = {"passed": True, "elapsedSeconds": round(time.perf_counter() - started, 3), "progressSamples": len(progress), "owner": window.runtime_owner, "target": window.document["board"]}
        assert window.runtime_owner == "code"
        window.pause_simulation()
        wait_until(lambda: window.runtime_state == "paused")
        state = window.instruments._states[debug]
        assert state["debug"]["registers"] and state["cycles"] > 0
        report["checks"]["nativeAvrPauseDebug"] = {"passed": True, "cycles": state["cycles"], "pcBytes": state["debug"]["pcBytes"]}
        window._open_instrument(serial)
        window.view.fit_circuit()
        application.processEvents()
        window.grab().save(str(args.output.parent / "native-running.png"))
        window.reset_simulation()
        wait_until(lambda: window.runtime_state == "ready")
        assert window.time_label.text() == "0.000 s"
        window.start_loaded()
        wait_until(lambda: "NATIVE CODE BUILD" in window.instruments._states.get(serial, {}).get("log", ""))
        destination = args.output.parent / "native-roundtrip.simulab.json"
        window.save_to(destination)
        assert "NATIVE CODE BUILD" in destination.read_text(encoding="utf-8")
        report["checks"]["nativeResetRestartSave"] = {"passed": True}

        window.open_path(resource_path("examples", "esp32s3-gpio4.json"), example=True, confirm=False)
        serial, board = add_instrument("serial-monitor", [("CONSOLE", "CONSOLE")])
        window.load_reference()
        wait_until(lambda: window.runtime_state == "ready")
        window.start_loaded()
        wait_until(lambda: ">>>" in window.instruments._states.get(serial, {}).get("log", ""), 30)
        window._instrument_action(serial, "send", "import machine; machine.Pin(4, machine.Pin.OUT).value(1); print('NATIVE S3 GPIO', machine.Pin(4).value())")
        wait_until(lambda: "NATIVE S3 GPIO 1" in window.instruments._states.get(serial, {}).get("log", ""), 20)
        report["checks"]["nativeS3ConsoleGpio"] = {"passed": True, "target": "esp32s3", "time": window.time_label.text()}
        window._open_instrument(serial)
        window.view.fit_circuit()
        application.processEvents()
        window.grab().save(str(args.output.parent / "native-s3.png"))
        intervals = [b - a for a, b in zip(heartbeat, heartbeat[1:])]
        report["uiHeartbeat"] = {"ticks": len(heartbeat), "maxGapMs": round(max(intervals, default=0) * 1000, 2)}
        report["passed"] = True
    except Exception as error:
        report["passed"] = False
        report["error"] = str(error)
        raise
    finally:
        timer.stop()
        window.dirty = False
        window.close()
        window.thread_pool.waitForDone(5000)
        args.output.write_text(json.dumps(report, indent=2), encoding="utf-8")
        print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()

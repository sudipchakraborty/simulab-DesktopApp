"""@brief Measure native scene/load/projection operations without claiming browser speedup."""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import platform
import statistics
import time

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
started = time.perf_counter()
from PySide6 import __version__ as qt_version
from PySide6.QtWidgets import QApplication
from simulab_desktop.core.documents import new_workspace
from simulab_desktop.core.registry import create_registry
from simulab_desktop.ui.canvas import CircuitScene, CircuitView


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=Path("artifacts/native-benchmark.json"))
    args = parser.parse_args()
    app = QApplication([])
    registry = create_registry()
    results = {"python": platform.python_version(), "qt": qt_version, "platform": platform.platform(), "qtPlatform": app.platformName(), "startupToQtSeconds": round(time.perf_counter() - started, 4), "browserComparison": "Not measured; these are native-only timings", "scenes": []}
    for count in (10, 100, 1000):
        project = new_workspace(registry)["circuit"]
        project["components"] = [registry.create("resistor", (i % 40) * 220, (i // 40) * 170) for i in range(count)]
        scene = CircuitScene(registry)
        view = CircuitView(scene)
        view.resize(1200, 750)
        at = time.perf_counter()
        scene.set_project(project)
        load_ms = (time.perf_counter() - at) * 1000
        view.show()
        view.fit_circuit()
        app.processEvents()
        samples = []
        projection = {"components": {c["id"]: {"values": {"voltage": 3.3}} for c in project["components"]}}
        for _ in range(30):
            at = time.perf_counter()
            scene.apply_projection(projection)
            app.processEvents()
            samples.append((time.perf_counter() - at) * 1000)
        at = time.perf_counter()
        view.viewport().grab()
        grab_ms = (time.perf_counter() - at) * 1000
        results["scenes"].append({"parts": count, "loadMs": round(load_ms, 3), "projectionAndPaintMedianMs": round(statistics.median(samples), 3), "projectionAndPaintMaxMs": round(max(samples), 3), "viewportGrabMs": round(grab_ms, 3)})
        view.close()
        scene.deleteLater()
        app.processEvents()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(results, indent=2), encoding="utf-8")
    print(json.dumps(results, indent=2))


if __name__ == "__main__":
    main()

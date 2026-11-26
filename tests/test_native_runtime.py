"""End-to-end native transport and stale compiler-result ownership checks."""

from copy import deepcopy
import threading
import time

from simulab_desktop.core.registry import create_registry
from simulab_desktop.paths import resource_path


def test_native_real_image_lifecycle_and_wired_terminal(qtbot, tmp_path):
    from simulab_desktop.core import editing
    from simulab_desktop.ui.main_window import MainWindow
    window = MainWindow(create_registry(), data_dir=tmp_path, restore=False)
    qtbot.addWidget(window)
    window.open_path(resource_path("examples", "uno-blink.json"), example=True, confirm=False)
    controller = next(c for c in window.project["components"] if c["kind"] == "uno")
    terminal = window.registry.create("serial-monitor", 800, 300)
    project = editing.add_component(window.project, terminal, window.registry)
    for source, destination in [("RX", "D1"), ("TX", "D0"), ("GND", "GND")]:
        project = editing.connect(project, {"componentId": terminal["id"], "pinId": source}, {"componentId": controller["id"], "pinId": destination}, window.registry)
    window.commit_project(project)
    window.load_reference()
    qtbot.waitUntil(lambda: window.runtime_state == "ready", timeout=10000)
    session = window.runtime.session
    window.start_loaded()
    qtbot.waitUntil(lambda: "SIMULAB AVR READY" in window.instruments._states.get(terminal["id"], {}).get("log", ""), timeout=10000)
    window.pause_simulation()
    qtbot.waitUntil(lambda: window.runtime_state == "paused", timeout=3000)
    assert float(window.time_label.text().split()[0]) > 0
    window.code.editors["sketch.ino"].appendPlainText("// does not steal manual firmware ownership")
    assert window.runtime_owner == "manual"
    assert window.runtime.session == session
    window.reset_simulation()
    qtbot.waitUntil(lambda: window.runtime_state == "ready", timeout=3000)
    assert window.time_label.text() == "0.000 s"
    window.place_component("resistor")
    assert window.runtime_owner is None
    assert window.runtime.session > session
    window.dirty = False
    window.close()


class DeferredCompiler:
    """An intentionally late transport result exercises the host ownership guard."""

    def __init__(self):
        self.entered = threading.Event()
        self.release = threading.Event()
        self.closed = False

    def compile(self, board, files, on_progress=None, cancel_event=None):
        self.entered.set()
        self.release.wait(5)
        return {"success": True, "job": "0" * 32, "board": board, "artifacts": ["sketch.ino.hex"], "durationMs": 1, "cached": False, "log": "genuine transport result fixture"}

    def fetch_artifact(self, artifact):
        return resource_path("firmware", "blink-uart.hex").read_bytes()

    def close(self):
        self.release.set()
        self.closed = True


def test_changed_source_discards_late_compile_without_starting(qtbot, tmp_path):
    from simulab_desktop.ui.main_window import MainWindow
    compiler = DeferredCompiler()
    window = MainWindow(create_registry(), data_dir=tmp_path, compiler=compiler, restore=False)
    qtbot.addWidget(window)
    window.place_component("uno")
    window.build_code(True)
    qtbot.waitUntil(compiler.entered.is_set, timeout=2000)
    window.code.editors["sketch.ino"].appendPlainText("// newer source")
    compiler.release.set()
    qtbot.waitUntil(lambda: not window._busy, timeout=3000)
    assert window.runtime_owner is None
    assert window._last_build is None
    assert "Discarded a build" in window.output.log.toPlainText()
    window.dirty = False
    window.close()


def test_explicit_manual_image_takes_over_pending_code_even_same_name(qtbot, tmp_path):
    from simulab_desktop.ui.main_window import MainWindow
    compiler = DeferredCompiler()
    window = MainWindow(create_registry(), data_dir=tmp_path, compiler=compiler, restore=False)
    qtbot.addWidget(window)
    window.place_component("uno")
    window.build_code(True)
    qtbot.waitUntil(compiler.entered.is_set, timeout=2000)
    window._load_image(resource_path("firmware", "blink-uart.hex").read_bytes(), "hex", "manual", "sketch.ino.hex")
    qtbot.waitUntil(lambda: window.runtime_state == "ready", timeout=10000)
    owner = window.runtime.session
    compiler.release.set()
    qtbot.waitUntil(lambda: not window._busy, timeout=3000)
    assert window.runtime_owner == "manual"
    assert window.runtime.session == owner
    assert window.runtime_state == "ready"
    window.dirty = False
    window.close()


def test_stop_cancels_queued_automatic_start(qtbot, tmp_path):
    from simulab_desktop.ui.main_window import MainWindow
    window = MainWindow(create_registry(), data_dir=tmp_path, restore=False)
    qtbot.addWidget(window)
    window.place_component("uno")
    window._load_image(resource_path("firmware", "blink-uart.hex").read_bytes(), "hex", "manual", "reference", auto_start=True)
    window.stop_simulation()
    qtbot.waitUntil(lambda: window.runtime_state in {"stopped", "error"}, timeout=10000)
    assert window.runtime_state == "stopped"
    qtbot.wait(150)
    assert window.runtime_state == "stopped"
    window.dirty = False
    window.close()


def test_compiler_starting_during_close_is_cleaned_after_start(qtbot, tmp_path):
    from simulab_desktop.ui.main_window import MainWindow

    class StartingCompiler(DeferredCompiler):
        def __init__(self):
            super().__init__()
            self.live = False
        def start(self):
            self.entered.set()
            self.release.wait(4)
            self.live = True
        def close(self):
            self.closed = True
            self.live = False

    compiler = StartingCompiler()
    window = MainWindow(create_registry(), data_dir=tmp_path, compiler=compiler, restore=False)
    qtbot.addWidget(window)
    window.place_component("uno")
    window.build_code(True)
    qtbot.waitUntil(compiler.entered.is_set, timeout=2000)
    window.dirty = False
    window.close()
    compiler.release.set()
    qtbot.waitUntil(lambda: not window._tasks, timeout=5000)
    assert compiler.live is False

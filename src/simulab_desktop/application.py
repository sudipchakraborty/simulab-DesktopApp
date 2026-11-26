"""@brief Desktop entry point with injectable paths and reproducible GUI smoke options."""

from __future__ import annotations

import argparse
from pathlib import Path
import sys

from PySide6.QtCore import QTimer
from PySide6.QtWidgets import QApplication

from .core.registry import create_registry
from .paths import resource_path
from .ui.main_window import MainWindow
from .ui.theme import apply_theme


def main(argv=None):
    """@brief Run the native application; no browser/account/server is required.
    @param argv Optional arguments supplied by the embedding host or launcher.
    @return Qt application exit status.
    """
    parser = argparse.ArgumentParser(description="SimuLab native Python desktop circuit studio")
    parser.add_argument("project", nargs="?", help="Portable workspace or circuit JSON")
    parser.add_argument("--data-dir", type=Path, help="Override local recovery/settings/cache directory")
    parser.add_argument("--plugin", action="append", default=[], help="Trusted local Python plugin file/directory")
    parser.add_argument("--example", choices=[p.stem for p in resource_path("examples").glob("*.json")])
    parser.add_argument("--no-restore", action="store_true", help="Ignore prior layout/recovery")
    parser.add_argument("--screenshot", type=Path, help="Capture the native window after layout settles")
    parser.add_argument("--quit-after", type=int, help="Exit after N milliseconds for smoke verification")
    options = parser.parse_args(argv)
    application = QApplication.instance() or QApplication(sys.argv[:1])
    application.setApplicationName("SimuLab Desktop")
    application.setOrganizationName("SimuLab")
    apply_theme(application)
    registry = create_registry(options.plugin)
    window = MainWindow(registry, data_dir=options.data_dir, restore=not options.no_restore)
    if window._settings.get("lightTheme"):
        apply_theme(application, light=True)
    if options.project:
        window.open_path(Path(options.project), confirm=False)
    elif options.example:
        window.open_path(resource_path("examples", options.example + ".json"), example=True, confirm=False)
    window.show()
    QTimer.singleShot(100, window.view.fit_circuit)
    if options.screenshot:
        def capture():
            options.screenshot.parent.mkdir(parents=True, exist_ok=True)
            window.grab().save(str(options.screenshot))
        QTimer.singleShot(1200, capture)
    if options.quit_after is not None:
        def finish():
            window.dirty = False
            window.close()
            application.quit()
        QTimer.singleShot(max(1500, options.quit_after), finish)
    return application.exec()


if __name__ == "__main__":
    raise SystemExit(main())

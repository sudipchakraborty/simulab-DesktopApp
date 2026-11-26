# SimuLab Desktop

Native Python/Qt circuit studio with modular components and genuine AVR / ESP32-S3 firmware execution. Python owns the application, documents, canvas and editor. A private local Node process runs the imported MCU/device engines; there is no embedded browser.

## Run

Double-click **`SimuLab-Desktop.cmd`**, or use:

```powershell
.\Setup.ps1
.\Run-Desktop.ps1
```

Source installation requires Python3.11+ and Node.js24+. Setup installs Qt Essentials into a private `.venv`. Arduino CLI and installed cores are needed only to compile custom source. Reference images work offline without a compiler, account or backend server.

The Windows folder build is **`dist\SimuLabDesktop\SimuLabDesktop.exe`**. Keep its whole folder together. It includes Python/Qt and simulation assets; Node remains an installed dependency. Rebuild with `Build-Desktop.ps1`. Build output is Git-ignored.

```powershell
.\.venv\Scripts\python.exe -m simulab_desktop --example uno-blink
.\.venv\Scripts\python.exe -m simulab_desktop path\project.simulab.json
.\.venv\Scripts\python.exe -m simulab_desktop --plugin plugins\green_indicator.py
```

## Native workspace

- Double-click a library component or drag it onto Hardware. Search all33 browser definitions. Select a part to edit its parameters in Properties.
- Click one named pin, then another, to wire them. Crossings never connect. Double-click a wire for a real junction. Escape cancels pending wiring.
- Drag a rectangle for group selection. Move/rotate/copy/paste/duplicate/delete through the Hardware context menu. Ctrl+C/V/D and Delete work on Hardware; source fields retain text shortcuts. Circuit edits have Undo/Redo.
- Wheel zooms; Space+drag or middle-drag pans. Fit restores the view. Panels are dockable/hideable; View toggles the code editor.
- File → Open example provides Uno/Nano/Mega/S3 and the component laboratory. Opening a drawing never executes firmware.
- Build compiles current multifile C/C++ source. Run code builds or starts its code-owned image. Output shows actual compiler progress, errors and cache results. Stop invalidates pending automatic starts.
- Simulation → Load reference firmware or Load firmware file loads an image explicitly. Start image then executes that manual image. AVR requires Intel HEX; S3 requires a merged flash BIN. Manual firmware survives source edits independently.
- Simulation → Execution speed selects maximum throughput (default) or real-time pacing. CPU work yields between bounded slices and live rendering is limited to30Hz. Time comes from actual CPU cycles.
- Add Serial Monitor and wire AVR RX→D1, TX→D0, GND; S3 uses CONSOLE→CONSOLE. Debugger uses DEBUG→DEBUG. Double-click the instrument to open its panel. UART/registers come from actual firmware. Double-click a switch for live input.
- Save full circuit+source workspaces as portable JSON. Bare browser circuit JSON also imports/exports. Recovery/layout live under `%LOCALAPPDATA%\SimuLabDesktop`; override with `--data-dir` or `SIMULAB_DESKTOP_DATA`. Credentials and firmware binaries never enter document JSON.

## Compiler

Tools → Compiler settings accepts installed Node/Arduino CLI/YAML paths. Blank paths use environment/PATH discovery and recognize an existing local SimuLab toolchain installation. The compiler implementation is bundled independently here; it never imports sibling source at runtime.

```powershell
$env:ARDUINO_CLI = 'C:\tools\arduino-cli.exe'
$env:ARDUINO_CONFIG = 'C:\tools\arduino-cli.yaml'
.\Run-Desktop.ps1
```

The app owns a private loopback compiler companion on an OS-assigned port and keeps its token in memory. Each host has an exclusive workspace/cache, avoiding concurrent-window source collisions. Exact/incremental cache reuse lasts while that host stays open; its private files are cleaned on close. Toolchain startup never downloads cores. Library installation is a separate explicit Tools action. Physical upload is not exposed by this release.

## Reuse and plugins

Qt-free domain modules accept an injected registry and portable dictionaries; transports accept explicit paths/cache/services. A trusted local Python plugin exports `register(registry)`. See [working example](plugins/green_indicator.py), [plugin guide](plugins/README.md), [architecture](docs/ARCHITECTURE.md), [browser migration](docs/BROWSER_MIGRATION.md), [tests](docs/TESTING.md), and [progress ledger](progress.md).

An `engineKind` alias reuses a parameterized electrical model and native renderer. Missing models/pin mappings fail visibly. Custom native kinds need the same plugin when reopened; the browser's closed catalogue cannot import them directly. Public APIs have Doxygen-compatible docstrings; run `doxygen Doxyfile` when installed.

## Verification and limits

Automated checks cover native editing/persistence/plugins/ownership, real Uno/Nano/Mega execution, official S3 boot/GPIO/input, wired UART/debugger, and compiler cancellation/cleanup. A separate native smoke compiles new Uno source and observes its UART/register state, then controls S3 GPIO through MicroPython. No physical-board parity is claimed.

Retained model limits: bounded linear DC (no full SPICE/nonlinear/transient solution), unsupported ADC/SPI/EEPROM paths, Mega UART0 only, S3 external I2C/SPI/RMT and onboard RGB visualization, source-level/DWARF debugging, and educational robot dynamics. HEX has no universal target identity: manual images must be built for the selected board. Flash/PSRAM capacity remains constrained by the emulator independently of artwork. Browser account/subscription/payment screens are outside this local engineering workspace.

Measured engine throughput was1.58× the browser worker for one equivalent short Uno workload, not a universal speed guarantee. Stable native projections avoid redundant repainting; large changing scenes remain more expensive. Reproduce measurements using the benchmark scripts.

```powershell
.\Setup.ps1 -Development
.\.venv\Scripts\python.exe -m pytest -q
.\.venv\Scripts\python.exe scripts\verify_native.py
.\.venv\Scripts\python.exe scripts\benchmark_native.py
node scripts\benchmark_engine.mjs --browser --samples 3 --duration-ms 1000
.\Build-Desktop.ps1
```

The native smoke needs an installed compiler, uses an offscreen window and never uploads to a board. Normal runtime tests need no compiler. Asset source commits, SHA-256 and license notices are bundled. `scripts/import_browser.mjs` refreshes source snapshots during development only; installed apps run without sibling repositories.

The optional `--browser` benchmark requires the browser frontend checkout with Vite/Playwright installed; select another checkout with `--frontend PATH`. Omit `--browser` for a standalone native engine benchmark.

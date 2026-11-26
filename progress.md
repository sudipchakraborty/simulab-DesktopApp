# SimuLab Desktop development ledger

## 2026-11-26 — Native desktop application

Status: completed and verified. Requested by the user: understand the browser application and create a fresh modular Python desktop simulator in this repository, document all substantive changes, and beep on completion.

### Source audit and decisions
- Read the frontend entry/workspace/editor/circuit contracts, component registry, AVR/S3 worker integration, and model host; parallel audits cover the engine and compiler/device models.
- The sibling frontend, engine and backend are independent repositories and remain source references. Product changes belong here.
- Use Python 3.13 + PySide6 native Widgets/Graphics View. No embedded browser or React runtime is used for the desktop interface.
- Preserve the existing genuine AVR8js and official Espressif WASM engines, including behavioral component models, in a locally bundled Node subprocess. Python owns UI, documents, editing, plugins and process supervision. This avoids an inaccurate reimplementation of the MCU instruction sets.
- Circuit schemas 1.0–1.4 and browser IDE workspace v1.0 are imported; new documents use circuit 1.4. Firmware and pairing secrets are excluded from saved documents.
- Performance is an engineering goal, not a blanket claim: native rendering and bounded/coalesced snapshots are measured; identical emulator code does not imply faster CPU execution than a browser.
- The user explicitly delegated design and execution; proceed with sensible defaults without approval checkpoints. Work directly in the requested fresh repository on a feature branch. No commit/push/deploy is requested.

### Work packages
1. Import portable catalogue, examples, board starters, real firmware and emulator assets with hashes/provenance/licenses; build standalone runtime bridge.
2. Implement Python domain/document validation, explicit netlists, bounded undo history and parameterized plugin registry.
3. Implement native canvas, component library/inspector, workspace/source editor, lifecycle, wired instruments and local persistence.
4. Add injected local compiler client, build progress/cancellation, target checks and artifact loading.
5. Verify actual firmware, editing/import/persistence/plugin behavior, GUI and packaging/launcher. Record commands, results and remaining limits here.

### Handoff
- This file is the durable project ledger. Root agent owns updates while parallel agents work in separate directories.
- Design and implementation details: `docs/superpowers/specs/2026-11-26-native-desktop-design.md` and `docs/superpowers/plans/2026-11-26-native-desktop.md`.
- Baseline: repository contained only README; clean `main`, initial commit `d73289b`. Python 3.13.3 and Node 24.13.0 available; no Qt or test dependencies preinstalled.

### Implemented and verified so far
- Created feature branch `feature/native-python-desktop`, a private `.venv`, native Python package/entry point and Windows setup/launch scripts. No source repository was changed outside this desktop repo.
- Imported 33 categorized component definitions (including virtual DEBUG/CONSOLE terminals), four board source starters, five browser-compatible workspaces, genuine compiled AVR/S3 firmware and official WASM. `scripts/import_browser.mjs` produces a standalone framework-free engine bundle and deterministic SHA-256/source-commit provenance; all license notices retained.
- `runtime/bridge.mjs` and `runtime/session.mjs` implement bounded JSON-lines transport, monotonic ownership, genuine AVR I2C/input/GPIO callback integration, S3 disk initialization, coalesced <=30Hz frames, UART, wired instruments, live device inputs and lifecycle. 14 runtime tests passed, including copied standalone package execution and actual S3 boot/GPIO/input.
- Qt-free `core` implements strict circuit/workspace parsing, explicit netlists/ERC, immutable group editing/junctions, atomic file persistence, deep-copy bounded undo history and a transactional trusted-local plugin registry with explicit engine aliases. 17 core tests passed; all packaged examples and the sample plug-in roundtrip.
- Compiler service is standalone in this repo, using a private ephemeral loopback host and memory-only token. It owns and cleans its Node/compiler descendants, forwards genuine progress, bounds/validates source and cancels stale results. 22 focused compiler tests passed. Real Uno builds: fresh-cache 33.718s; identical 0.402s (cached, same SHA-256); changed source 4.944s (not cached, different SHA-256).
- Native UI implements the Graphics View canvas, group edits, pin wiring, rotation, library/inspector, multifile syntax-highlighted C/C++ editor, portable files/recovery, real firmware lifecycle, wired UART/debugger and asynchronous compiler controls. Initial 4 UI tests are green after correcting search to prioritize matching component names over incidental description words.
- Additional native-process integration checks passed (4): actual wired AVR terminal and pause/reset, source edits preserving manual-image ownership, late compilation discarded after source changes, explicit manual takeover despite identical firmware filenames, and Stop preventing queued automatic start.
- Full suite before the additional native checks: `57 passed, 10 subtests passed` in 19.30s. Native window screenshot captured at `artifacts/native-uno.png` and inspected. Final suite/review/packaging and performance evidence are still pending.

### Integration review and actual native verification
- Ran independent UI and whole-application reviews (`docs/ui-review.md`, `docs/final-review.md`). Reproduced each finding before fixing it; added regression tests for target selection with custom source, deleting breakpoint-bearing files, unknown/high LED projection, exact junction coordinates, missing-runtime errors, and compiler startup during window closure.
- Final review exposed a genuine cross-window compiler source race: independent hosts shared a workspace/cache despite per-host busy flags. Fixed by creating exclusive per-host roots under the configured parent and cleaning only verified owned paths after descendants stop. Added deterministic concurrent-source, restart, startup-failure, sentinel and Windows junction escape regressions. Compiler focused run: 26 passed in 11.09s. Ruling: cache reuse lasts for one open host; restarting rebuilds, trading restart speed for strict source isolation and normal-close bounded retention. Abrupt process termination can leave a private cache directory for manual cleanup; normal close/startup-failure cleanup is verified.
- Fixed plugin aliases consistently across controller detection/profile/starter selection, native renderer, instrument selection and bare circuit import; saved custom kinds remain intact. Core/alias/UI focused run: 30 passed and 10 subtests.
- Native custom-source smoke (`scripts/verify_native.py`) passed: actual new Uno source compiled to firmware, wired UART emitted its unique marker, paused AVR exposed real registers (640001 cycles, PC byte 422), reset/restart and source roundtrip worked. Then official S3 MicroPython booted and wired console set/read GPIO4 (`NATIVE S3 GPIO 1`). First compile-to-UART 26.945s, 11 numeric progress observations; Qt heartbeat continued (499 ticks, max observed gap 274.24ms). No physical board was used.
- Added maximum/realtime execution modes. Maximum yields bounded CPU slices without the browser worker's fixed 10ms sleep; realtime pacing uses actual emulator time, never invented CPU progress. Runtime focused speed suite: 18 passed, 2 subtests.
- Actual three-sample equivalent Uno benchmark measured native maximum 11.11M cycles/s versus browser worker 7.02M cycles/s (1.58x this workload); native max pause median 13.7ms and 23.6Hz frames. Both remained below realtime under concurrent load. Reproducible script starts/stops only its own temporary Vite/Chromium; sibling sources stayed clean. This is a workload-specific throughput result, not a universal application speed claim.
- Native scene benchmark identified redundant cached-item invalidation. Avoiding unchanged state/pin repaints reduced stable 1000-part projection median from about 291ms to 1.95ms; first changed frame still reached 189ms. Scene load about 422ms; startup to Qt about 0.99s. Source imports spanning large coordinates now expand scene bounds. Native final screenshot inspected at `artifacts/native-uno-final.png`.
- Added README, architecture/migration/testing guides, Doxygen configuration and reproducible wheel/Windows-folder packaging scripts. Initial wheel and executable build succeeded. Final post-review rebuild and fresh packaged-launch checks are next.

### Final delivery and verification
- Full final suite: `.venv\Scripts\python.exe -m pytest -q` → **79 passed, 12 subtests passed in 24.81s**. Actual output retained in `artifacts/final-tests.log`. Python `compileall`, Node bridge/session/compiler-host syntax checks, and tracked whitespace checks passed.
- Post-review real native smoke passed again: **14.173s** compile-to-unique-UART output with 9 numeric progress observations; actual AVR pause/debug at 960002 cycles/PC byte 482; reset/restart and portable source save; actual S3 console GPIO4 high/readback. Qt heartbeat 257 ticks, max observed gap 194.97ms. All software-only.
- Repeated comparable engine benchmark under the final load: native maximum **14.08M cycles/s**, browser worker **8.31M cycles/s**, about **1.70x** for this equivalent Uno workload. Median native pause 6.08ms and 25.57Hz frames. Earlier run was 1.58x; variation demonstrates machine-load limits. The comparison excludes GUI/cold startup and is not a universal speed claim. Evidence: `artifacts/engine-benchmark.json`.
- Rebuilt final wheel `dist/simulab_desktop-0.1.0-py3-none-any.whl` and Windows folder `dist/SimuLabDesktop/SimuLabDesktop.exe` (about 124MB including Python/Qt/assets). Frozen GUI smoke opened an S3 workspace, captured `artifacts/frozen-native.png`, and exited **0**. Inspected the frozen native screenshot. Frozen package contains the new `pacing.mjs` and standalone compiler/runtime/resources.
- Executed both actual engines directly from the frozen package: AVR UART at 500000 cycles and S3 MicroPython boot at 21198801 cycles; evidence `artifacts/frozen-runtime-validation.json`. No source/sibling imports required by these engines.
- All review findings resolved with regression coverage; see `docs/REVIEW_RESOLUTIONS.md`. Doxygen-compatible comments/configuration are supplied; Doxygen is not installed on this machine, so HTML generation was not run.
- Verified frontend, engine and backend Git porcelain status independently: all clean/unchanged. Desktop work remains local and uncommitted on `feature/native-python-desktop` from initial `d73289b`; no merge/push/deployment or physical upload was requested/performed.
- Run by double-clicking `SimuLab-Desktop.cmd` or `dist/SimuLabDesktop/SimuLabDesktop.exe`. Source setup/launch/build commands and Node/optional toolchain requirements are documented in README. Keep the executable's whole folder together.
- Remaining intentional boundaries: Python/Qt host with real JS/WASM MCU engines in Node; native schematic graphics; local documents instead of browser account/billing; no physical upload, full SPICE or unsupported MCU/source-debug features. Custom plugin files must be supplied when reopening their documents. Compiler cache is private to each open host and rebuilds after restart; abnormal termination can leave a private directory.
- Completion beep command succeeded (two tones); physical audibility was not independently verified.

## 2026-11-26 - Launched desktop app
- Started dist/SimuLabDesktop/SimuLabDesktop.exe for requested interactive use. Initial hidden launch produced no visible window; stopped only the owned hidden PID 51448 and relaunched visibly. Verified nonzero main window handle and Responding=True (PID 51708); title: Untitled circuit — SimuLab Desktop. No source changes or simulation started.

- Corrected Run-Desktop.ps1 to launch the interactive pythonw/Qt application with WindowStyle Normal. Hidden startup suppressed the main window; pythonw already avoids a console. Existing visible desktop PID 51708 remains open and responding.

## 2026-11-26 - Repository publication verification
- User explicitly authorized checking, committing and pushing the new desktop repository. Verified origin is https://github.com/sudipchakraborty/simulab-DesktopApp.git and its default branch is main. The remote was still at initial d73289b before this release; publication uses a normal fast-forward from that commit.
- Fresh release gate: 79 tests and 12 subtests passed in 29.77s; Python compileall, Node bridge/compiler-host syntax and Python wheel build passed. The interactive app was left running.
- Staged source, tests, documentation, scripts, intentional genuine firmware/WASM and upstream license/provenance files only. Excluded .venv, .runtime, .local, .env/secrets, build, dist, artifacts and logs. Independent read-only publication review found no standalone runtime or credential blocker; clarified optional browser benchmark prerequisites.
- Added .gitattributes to preserve all imported resource/compiler bytes and original CRLF in pinned fixtures/notices; normal source uses explicit line endings. Trimmed only extra EOF blank lines in two adapter modules. Staged whitespace verification is clean; firmware/compiler provenance hashes are checked against staged Git blobs.
- Release destination is origin/main; final commit/remote hash and clean ahead/behind verification are reported to the user and recorded in the workspace-level progress ledger after pushing. Windows binaries remain locally built/ignored and can be reproduced with Build-Desktop.ps1.

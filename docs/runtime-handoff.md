# Native runtime and imported resources handoff

Implemented 2026-11-26 for Task 1 of `docs/superpowers/plans/2026-11-26-native-desktop.md`.
Root owns `progress.md`; this scoped handoff records runtime changes and actual verification.

## Files and architecture

- `scripts/import_browser.mjs`: development-only reproducible importer. Optional `--frontend PATH` / `--engine PATH` explicitly select source roots; defaults select the two sibling source repositories. Uses their existing esbuild installation without installing or changing anything there.
- `src/simulab_desktop/resources/engine.mjs`: bundled, framework-free AVR8js/SimuLab engine, component models, circuit validation/netlist/projection, board catalogue and instrument routing. Installed applications do not read any sibling repository or `node_modules` folder.
- `resources/catalog.json`: 33 component kinds, original names/descriptions/defaultProperties, category and physical plus virtual pins. In particular controllers expose DEBUG and S3 also exposes CONSOLE.
- `resources/starters.json`: kind keys (`uno`, `nano`, `mega2560`, `yd-esp32-s3`) map to `{board,content}`.
- `resources/examples/*.json`: five portable browser workspaces, with source files, for Uno Blink, Nano Blink, Mega Blink, S3 GPIO4 and the component laboratory. Generated wire identities are deterministic.
- `resources/firmware/`: the existing genuine compiled AVR fixtures and MicroPython merged S3 image with original metadata/notices.
- `resources/emulators/esp-emu-0.51.0/`: pinned official JS/WASM, original asset manifest/license and local module declaration.
- `resources/licenses/`: AVR8js MIT, official ESP Apache-2.0, MicroPython and existing third-party notices.
- `resources/provenance.json`: exact frontend/engine source commits and dirty flags, all bundled input hashes, importer tool version, installed-resource byte lengths and SHA-256. The manifest intentionally does not hash itself.
- `runtime/session.mjs`: injected real MCU/circuit/instrument lifecycle, exact AVR callbacks, pending-output aggregation, input/device handling.
- `runtime/bridge.mjs`: standalone JSON-lines process, ownership, scheduling/backpressure and disk WASM initialization.
- `runtime/pacing.mjs`: pure parameterized host delay calculation; maximum yields immediately, realtime compares actual emulated microseconds to monotonic wall time.
- `tests/test_runtime.py`: stdlib subprocess integration suite; fixtures and artifacts come from this desktop package only.

## Process contract

Launch `node <installed-package>/runtime/bridge.mjs` with stdin/stdout pipes. No server/browser is started. Stdout contains JSON lines only; stderr is reserved for Node failures.

Every request and response has `version:"1.0.0"`, nonnegative integer `id`, integer `session`, and `type`. Startup is `ready` with id/session 0. Host load-session IDs must increase monotonically, including when the previous load failed. Non-load commands must carry the current session; stale requests fail without mutating the current MCU. Unsolicited snapshots/errors use id 0 and their owning session. Malformed envelopes are sanitized to integer ids/session in the error reply.

Commands:

| type | fields / result |
| --- | --- |
| load | `target:uno/nano/mega2560/esp32s3`, validated portable `project`, AVR `hex` or S3 `firmwareBase64`; returns snapshot |
| start / resume | Real lifecycle change; starts yielding live CPU scheduling |
| pause / stop / reset | Real lifecycle; cancels live scheduling; reset recreates device state and clears instrument history |
| snapshot | Returns current state and drains accumulated serial/transitions once |
| speed | `mode:maximum/realtime`; valid before load at session 0 or with the current session; replies `speed` with `mode`/`speedMode`; never resets MCU time, inputs, firmware or session |
| run | AVR `cycles` or S3 `instructions`, integer 1..100000000; disables live scheduling, starts/resumes the genuine CPU if necessary, executes bounded yielding slices and returns one aggregate snapshot |
| pin | `pin`, `level` (boolean/0/1/null); null is AVR external floating/pull-up semantics; S3 floating release is explicitly unsupported |
| device | `componentId`, validated `properties`; switch changes retain device model state; other parameter changes recreate the circuit device host at the current CPU time |
| uart | Raw bounded UTF-8 `text` (max 4096 bytes); no newline/CR is automatically added |
| step | One genuine AVR instruction from ready/paused; S3 is explicitly rejected |
| instrument | `componentId`, browser `action`, optional `text`; preserves actual wiring/interlock checks and browser newline/CR semantics |
| dispose | Frees active machine, cancels execution and replies `disposed`; process exits when its stdin is closed |

Snapshot response fields: `snapshot` (cycles, timeMicros, state, gpio, serial, transitions), `projection` (component values/warnings/contacts, LEDs, real pin states, instrument histories, I2C log and actual AVR registers), `target`, architecture-specific `capabilities`, and `speedMode`. Startup `ready` also reports `speedMode` and available `speedModes`.

Live unsolicited snapshot transport is limited to 30 Hz; request acknowledgements are immediate. Each CPU batch yields promptly, stdout backpressure suspends further execution, and no arbitrary simulated-60-second cap exists. UART/transitions from all batches are retained until one frame consumes them. Pending memory is bounded at 1 MiB serial/65536 transitions; overflow fails explicitly instead of silently discarding observations. Input command lines are capped at 24 MiB. Deterministic runs are limited by total requested budget and the same explicit output bounds.

AVR batches are cycles (max 250000 in underlying adapter), S3 batches are instructions (max 100000), and all simulation time is derived from real engine cycles. The bridge normally uses smaller Mega batches for responsiveness. A board with no electrical wires does not need per-read circuit solving; omitting those optional hooks avoids redundant work while retaining genuine CPU input/GPIO behavior. Electrically wired circuits retain synchronous per-read/per-edge circuit integration within the Node process.

## Selectable execution speed and measured throughput

The default is **maximum**. Every bounded live batch schedules its next slice with `setImmediate`, yielding to stdin/I/O without the former artificial AVR 10 ms sleep. **Realtime** waits only when actual emulator time is ahead of elapsed host time; a slow machine executes as quickly as it can and may remain below real time. Starting, resuming or changing mode rebases the pacing origin. A backwards emulator clock also rebases it. Waits are capped at 50 ms and can be cancelled immediately for input/lifecycle commands. The correct cancellation primitive handles both pending immediates and timeouts, preventing duplicate live loops after speed changes. Both modes retain <=30 Hz unsolicited snapshots, pending-output aggregation, backpressure and architecture-bounded CPU batches. Deterministic `run` ignores wall-clock pacing in either mode.

Speed tests were written and observed red before implementation: unsupported `speed` replies, absent default mode and missing pure pacing module. They now cover explicit mode selection/rejection, session/cycle preservation, selection before load, live switching, actual pin input and prompt pause in both modes. The pure delay test uses literal independent clocks to check realtime waits, maximum yields, lagging execution and bounded waits; no noisy throughput ratios are asserted in tests.

Final scoped check after this speed update: `.venv\Scripts\python.exe -m pytest tests/test_runtime.py -q` — **18 passed, 2 subtests passed in 12.61s**. `node --check` passed for the bridge, pacing helper and benchmark script. Root owns the concurrent UI/compiler work and the final whole-project verification; no whole-suite rerun was requested for this scope.

Reproduce the optional actual browser comparison with:

```powershell
node scripts/benchmark_engine.mjs --browser --samples 3 --duration-ms 1000
```

Omit `--browser` for native-only measurements. `--frontend PATH` selects an explicit browser checkout. The script starts its own ephemeral loopback Vite instance with watching disabled and a temporary cache outside the repositories, and its own headless Chromium, then closes only those resources. Each sample loads the same one-board/no-wire project and compiled `blink-uart.hex`, warms it up for 150 ms, resets, and measures approximately one wall second including start/pause transport. Actual returned cycles/time, UART evidence, output frame count and pause latency are recorded as JSON; startup/import/warmup are excluded. Browser measurements use the unchanged `src/simulation/avr.worker.ts`, including its existing 10 ms Uno scheduler. It does not compare GUI rendering.

Observed 2026-11-26 06:22 UTC on Windows x64 / Intel Core Ultra 5 135U / Node 24.13.0 / Chromium 156.0.8078.4, while other native development verification was active:

| Host | Median real cycles/wall second | Simulated seconds/wall second | Median pause | Live snapshots/second |
| --- | ---: | ---: | ---: | ---: |
| Native maximum | 11,113,174 | 0.695 | 13.7 ms | 23.6 |
| Native realtime | 10,817,409 | 0.676 | 7.0 ms | 23.8 |
| Unchanged browser worker, 10 ms scheduler | 7,017,544 | 0.439 | 0.8 ms | 43.9 |

Native maximum delivered **1.58x** the browser worker's median firmware throughput in these three short samples. Native maximum sample ratios were 0.629, 0.695 and 0.697; browser ratios were 0.409, 0.449 and 0.439. These measurements do not establish a universal speed improvement or guarantee real-time execution; workload, machine and concurrent activity affect results. Browser message frequency was higher because its current worker does not coalesce transport to the desktop's 30 Hz limit. Both source repository Git statuses remained clean after the run. Firmware SHA-256: `ed281611e1eb43d145095567adc25e563beaf9ca5e200c456c9966178412e087`.

## Verification observed

1. Wrote subprocess tests before implementation; `python -m unittest discover -s tests -p test_runtime.py -v` failed all 8 original cases because the standalone bridge did not exist (explicit missing-file and startup assertions).
2. Implemented resources/bridge. Initial integration exposed expensive unnecessary per-PIN circuit work on a board without wires and an S3 test budget shorter than the guest UART transfer. Kept the real instruction/cycle behavior, omitted the redundant optional read hook for electrically empty circuits, and gave the S3 UART fixture enough actual instructions to finish its command.
3. Added regression tests before fixing duplicate-start scheduler cancellation and malformed-error ids; both tests failed for the intended observable behavior, then passed after correction.
4. Focused commands: `python -m unittest discover -s tests -p test_runtime.py -v` — **14/14 passed**, 7.903 seconds; then `.venv\Scripts\python.exe -m pytest tests/test_runtime.py -q` — **14/14 passed**, 9.52 seconds including the additional standalone S3 boot check. Coverage includes real Uno UART/timing/reset/step, Nano input mirroring, native Mega high pins/UART, actual S3 ROM/MicroPython boot/GPIO output and input, wired serial/debugger/switch, disconnected instrument rejection, stale sessions, malformed protocol, throttling/responsive pause, resource hash integrity and AVR plus S3 execution after copying only installed runtime/resources into a temporary standalone directory.
5. `node --check src/simulab_desktop/runtime/bridge.mjs` and the same command for `session.mjs` passed.
6. Re-running `node scripts/import_browser.mjs` preserves the provenance hash when sources/tools are unchanged; source runtime use requires only copied resources.
7. Broader integration check `.venv\Scripts\python.exe -m pytest -q` — **56 passed, 1 failed, 10 subtests passed** at that snapshot. The unrelated UI failure was `tests/test_ui.py::test_native_palette_and_inspector_emit_real_changes`: searching `resistor` also matched the Ammeter description, while the test expected only the resistor kind. Reported to the root UI owner. A preliminary system-Python unittest discovery could not import pytest/PySide6 or the source package because `python` resolved to the separate BBS embedded interpreter; use this repository's `.venv` for the integrated suite.
8. Final focused suite after a regression-tested boolean I2C capability fix: **14 passed in 12.93s**. Final whole-project `.venv\Scripts\python.exe -m pytest -q` after the UI owner's updates: **61 passed, 10 subtests passed in 25.32s**. No failing checks remain in that integrated snapshot.

## Limits and integration notes

- Node is an explicit installed-app dependency. Existing JS/WASM engines are reused; there is no browser shell or invented Python CPU emulator.
- Circuit/target and binary format are checked. Intel HEX contains no reliable target identity, so a syntactically valid wrong-AVR-chip image cannot always be detected from HEX alone; compile-artifact ownership/target metadata remains the host/compiler's responsibility.
- Preserve capability and model warnings. SPI/ADC/EEPROM/watchdog/sleep/bootloader/self-programming and source/DWARF/GDB functionality are not added. Nano A6/A7 ADC behavior remains unsupported. Mega exposes UART0 and several timer combinations remain unverified.
- S3 is the genuine official Xtensa WASM adapter with GPIO sampled at batch boundaries. External I2C/SPI/RMT callbacks and WS2812 waveform visualization are unavailable. Input byte limit does not establish the modeled board's flash/PSRAM capacity.
- Generic device property edits recreate behavioral device instances while retaining MCU state; live switch pressing uses the persistent model host. A future state-migration contract is needed to retain motor/robot dynamics through arbitrary parameter edits.
- Reset/restart recreates CPU/peripherals; S3 guest filesystem/flash writes are not retained.
- No physical hardware comparison or commercial redistribution review was performed. The browser comparison above covers one real firmware workload, without GUI rendering. Existing notices state that no project-wide SimuLab distribution license has been selected.
- This task did not edit sibling repositories, install dependencies, commit/push, or modify `progress.md`.

# Native SimuLab Desktop design — 2026-11-26

## Intent
Provide a Windows-first native Python circuit and firmware development application, importing the browser product's portable documents and real simulation behavior. Keep every module reusable through explicit parameters and document public APIs using Doxygen-compatible docstrings.

## Chosen approach
Native PySide6 Widgets/Graphics View handles the component library, editable circuit, source editor and instruments. A separately supervised local Node process executes a bundled snapshot of the framework-free SimuLab MCU/model engine. This retains tested AVR8js instruction execution and official ESP32-S3 WASM without browser rendering overhead. Node is an explicit runtime requirement, not a hidden web server. Alternatives considered were a WebView shell (less native and retains browser UI cost) and rewriting AVR/Xtensa emulators in Python (high parity risk and likely slower). The user delegated these choices and asked for autonomous implementation.

## Architecture
- `core`: Qt-free registry, strict portable documents, persistence, edit history and explicit pin topology.
- `services`: Qt process adapter and compilation transport with injected paths/endpoints; tokens are held in memory only.
- `ui`: replaceable native canvas/items, property inspector, palette, source editor and main composition.
- `resources`: imported catalogue, examples, starters, real firmware, official WASM and licenses; provenance manifest pins source commits and hashes.
- `runtime`: standalone JSON-lines bridge and bundled model/engine code. No dependency on sibling repositories at runtime.
- `plugins`: user-selected local Python registration modules. Component definitions initialize using a registry parameter. An engine-kind alias allows new parameterized components to reuse existing electrical models; incompatible models fail explicitly.

## Workflows
New/open/save browser-compatible workspace or circuit JSON; autosave/recovery; searchable categorized library; click/drag placement; named-pin wiring; explicit junctions; group move/copy/paste/delete; undo/redo; rotation; properties; pan/zoom/fit; circuit diagnostics/netlist; multifile C/C++ editor; local compiler build/load/run with genuine progress and cancellation; reference/manual HEX/BIN load; start/pause/resume/stop/reset; live pin/device values; wired serial and AVR instruction debugger.

Reference firmware is explicitly labeled and never substituted for user code. Exactly one compatible MCU is required. Circuit changes invalidate the loaded firmware; source changes invalidate code-owned builds while manual firmware keeps its own session identity. Asynchronous work carries generation IDs so stale results cannot start a new/changed project.

## Limits
Do not copy browser accounts/subscriptions/payment workflows into a local offline engineering tool. Desktop documents are local. Physical uploads remain explicit and outside this initial automatic execution. Full SPICE, unsupported ADC/protocols, source DWARF debugging, and physical-board parity are not invented. Existing device-model limits remain visible. S3 firmware is a merged flash binary. Do not claim performance gains over the browser without comparative measurements.

## Verification
Qt-free domain tests, actual Node firmware integration tests for AVR and S3, offscreen Qt interaction tests and captured native GUI evidence. Test malformed imports, crossings/shared pins, atomic save, source roundtrip, plugin drop-in aliasing, session invalidation, input and lifecycle. Report measured startup/canvas/engine timings and retain a reproducible benchmark tool. Setup and launch scripts must work from this repository alone.

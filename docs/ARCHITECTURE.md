# Native architecture

`application.py` composes native Qt widgets, a Qt-free core and parameterized runtime/compiler services. Installed code never imports sibling repositories.

```text
application → UI → core documents / registry / edits / history / nets
                 → QProcess JSONL → real MCU and behavioral models
                 → worker tasks → private compiler host → installed Arduino CLI
```

| Module | Responsibility / reuse boundary |
|---|---|
| `core/registry.py` | Injected catalogue, copied defaults, local plugins, validated model aliases |
| `core/documents.py` | Bounded portable schemas/source and atomic persistence |
| `core/editing.py` | Immutable pin/junction/group edits with explicit IDs |
| `core/history.py` | Detached bounded undo/redo without UI/files |
| `core/netlist.py` | Explicit nets, YD internal rails and structural checks |
| `ui/canvas.py` | Native scene/items/pin targets, cached incremental state, pan/zoom/drop |
| `ui/editor.py` | Multifile C/C++ editor, highlighting and line numbers |
| `ui/panels.py` | Registry library, detached properties, diagnostics, wired instruments |
| `ui/main_window.py` | Native commands, source/firmware ownership, recovery and composition |
| `services/runtime.py` | Injected QProcess, bounded versioned session-filtered JSON-lines |
| `services/compiler.py` | Qt-free HTTP, real telemetry, cancellation and bounded auth/source/artifacts |
| `services/compiler_host.py` | Private compiler/daemon process tree and installed-toolchain discovery |
| `services/tasks.py` | Reusable background callable/result adapter |
| `runtime/session.mjs` | Genuine CPU/model/instrument state and exact AVR callbacks |
| `runtime/bridge.mjs`, `pacing.mjs` | Versioned ownership, bounded scheduling, actual-time pacing and backpressure |
| `resources/engine.mjs` | Standalone imported engine/domain bundle, independent of browser UI |
| `compiler_runtime/` | Standalone compiler modules with matching source provenance |

Public APIs carry Doxygen-compatible docstrings. Host code passes registry, document, paths, targets and services. Core imports no Qt, Node, server or window.

## Documents and topology

Circuit schemas1.0–1.4 and browser workspace1.0 are accepted. New circuits use1.4. Only portable fields are saved; no tokens/build artifacts/runtime state. Flat source names, UTF-8 sizes, finite values, rotation, IDs and endpoints are bounded. Atomic save validates, writes/fsyncs a same-directory temporary, then replaces.

Pins/junctions define topology; drawing crossings never connect. Duplicate YD grounds/3V3 share rails. Virtual DEBUG/CONSOLE remain separate from electrical propagation. A plugin's native kind stays in saved files; a validated engine copy maps `engineKind` to a bundled model. Aliases also select matching native renderers/controller profiles.

## Ownership and lifecycle

Numeric firmware `session` increases for every load. Python discards other-session frames. Structural circuit edits stop the old runtime. Source/profile changes also invalidate code-owned firmware; manual images remain independent.

Compiler work captures a generation plus source/board/circuit hash. Edits/new/open/Stop/manual takeover cancel pending starts. Late results cannot load another project's image, even if its filename equals a manual image. Automatic start waits for the real load acknowledgement.

Compiler startup is serialized on worker threads. Closing during startup is checked after the handshake and disposes the late child. Closed windows suppress UI callbacks. Windows Job Objects/process groups contain private compiler descendants. Separate hosts use exclusive roots; close removes only their owned files. Reuse is per live host, so restart can require rebuilding. No physical upload occurs.

## Performance and correctness

The Node process retains synchronous AVR GPIO/input-read/I2C hooks beside device models; per-instruction Python IPC would alter timing and reduce speed. Official S3 WASM loads from packaged bytes. UART/transitions are drained once and distributed to instruments.

Bounded slices yield for commands. Maximum mode removes fixed browser-worker sleeps; real-time mode uses actual CPU-derived microseconds against elapsed wall time. It cannot force an overloaded host to keep up. Frames are coalesced to30Hz with backpressure. Native structural edits reconcile items; unchanged values do not invalidate their cached graphics. Benchmarks distinguish stable projections from expensive changing frames.

`scripts/import_browser.mjs` is a development-only importer using explicit frontend/engine locations. It exports catalogue/starters/examples and bundles portable modules with source Git commits/input hashes. Runtime needs this package plus Node. Compiler modules have a separate provenance manifest. Installed CLI/YAML paths may point to any existing toolchain installation.

The wheel includes all resources/runtime/compiler modules. The Windows build includes Python/Qt and these assets; keep `_internal` beside the executable. Node and optional installed Arduino cores remain explicit dependencies.

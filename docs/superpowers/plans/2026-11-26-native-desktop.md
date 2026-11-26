# SimuLab native desktop implementation plan

Spec: `../specs/2026-11-26-native-desktop-design.md`.

## Global constraints
Use genuine compiled, target-compatible firmware; never synthesize MCU behavior or silently substitute a board. Qt-free domain logic, parameterized dependencies, Doxygen-compatible public comments, standalone copied resources with provenance, explicit pin topology and visible unsupported behavior. User delegated autonomous execution. Preserve sibling repos and work in the named desktop repo. Root updates progress.md after each work package. No Git publication.

## Task 1: runtime and imported resources
Write real-runtime tests first; confirm missing bridge failure. Export complete catalogue with category/physical+virtual pins, board starters and browser examples. Bundle framework-free engine/model modules using local esbuild with reproducible script. Copy official WASM and compiled firmware with licenses/hash manifest. Bridge accepts versioned JSON-lines `{id, type, ...}`, replies `{id, type, ...}`; supports `load`, `start`, `pause`, `resume`, `stop`, `reset`, `step`, `uart`, `pin`, `device`, `snapshot`, `dispose`. Load carries `project`, `target`, `hex` or `firmwareBase64`. Snapshot carries real `snapshot` and `projection` matching the browser worker. Live updates are coalesced to <=30 Hz while CPU slices yield promptly. Test Uno/Nano/Mega GPIO/UART, inputs, reset/step and actual S3 boot/GPIO.

## Task 2: reusable Python core
Test document corruption/roundtrip/topology/history/plugin alias before implementation. Files `core/registry.py`, `core/documents.py`, `core/history.py`, `core/netlist.py`, `core/editing.py`. Public contract uses portable dicts. `ComponentRegistry`: `.definitions`, `.get(kind)`, `.pins(kind)`, `.create(kind,x=0,y=0)`, `.load_plugins(paths)`, `.engine_project(project)`; constructor accepts catalogue path. `create_registry(plugin_paths=())` locates installed resources. `parse_project(text,registry)`, `parse_document(text,registry)` (always returns browser workspace v1), `new_workspace(registry,board_kind=None)`, `serialize_document(workspace,registry)`, `save_document(path,workspace,registry)`, `load_document(path,registry)` are Qt-free. `History(initial,limit=100)` exposes `.current`, `.commit(next)`, `.undo()`, `.redo()`, `.reset(next)`, `.can_undo`, `.can_redo`. `build_nets(project,registry)` returns `{id,endpoints}` rows. `validate_circuit` returns `{severity,message}` issues. `editing` provides clone/delete/connect/move helpers with explicit ID parameters. Document JSON remains browser-compatible unless a registered custom component is used (warn at export).

## Task 3: compiler service
Tests against an in-process local HTTP fixture first. Provide stdlib Qt-free `services/compiler.py`: `CompilerClient(base_url='http://127.0.0.1:4317', token=None)` with `status()`, `compile(board,files,on_progress=None,cancel_event=None)`, `fetch_artifact(artifact)`, relevant library/status operations. Inspect the real sibling companion API before implementing; validate loopback and targets, implement actual progress/SSE, polling and timeout/cancellation where supported. UI thread performs no blocking HTTP. Tokens stay in memory. Code-only build cache includes board/files hashes; server remains authority for toolchain cache validity.

## Task 4: native UI and process supervision
Write interaction tests first for placement/wiring/history/source synchronization/lifecycle. Python Qt process wrapper injects node/bridge paths and parses bounded JSON-lines asynchronously. Native QGraphicsView scene with pin items and component/wire items; selected group moves update wires and commit once. Window composes docks, source tabs, menus/toolbars, properties, output/GPIO/netlist and connected instruments; render incrementally rather than rebuild per firmware tick. Async operations use generation/session ownership, cancellation and resource cleanup. File operations validate and write atomically. Add recovery and settings. Provide application entry and Windows setup/launch scripts.

## Task 5: verify, document and deliver
Run Python suite, Node actual firmware suite, import/standalone asset checks, compileall and native GUI smoke. Build wheel and optional runnable desktop executable when feasible. Exercise real cold/current-source compilation through available toolchain. Capture screenshots and benchmark measured native operations without unsupported browser comparisons. Independent reviewer checks final implementation; fix important issues with regression tests. Update README, architecture/plugin guides, testing evidence, progress.md and workspace ledger. Launch app and beep on completion.

## Review focus
- Wrong-target HEX/BIN rejection; malicious or oversized JSON/source inputs.
- Pending compile or runtime replies after edit/open/new/stop.
- Native pin coordinates after rotate/move/group edits; crossings stay disconnected.
- Plugin aliases retain saved native kinds but map correctly for real engine execution.
- Source changes never silently execute reference firmware; native user data survives restart.

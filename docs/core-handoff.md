# Qt-free core handoff — 2026-11-26

The `simulab_desktop.core` package uses portable dictionaries and Python's standard
library only. It imports no Qt, Node, browser or sibling-repository modules.
Public methods include Doxygen-compatible docstrings. The root integration agent
owns the project progress ledger and final application verification.

## Registry and plugins

```python
from simulab_desktop.core import ComponentRegistry, create_registry

registry = create_registry(plugin_paths=())
# Or inject an independent catalogue file:
registry = ComponentRegistry(catalogue_path)
definitions = registry.definitions       # independent {kind: definition} copy
definition = registry.get(kind)          # copy, ValueError for missing kind
pins = registry.pins(kind)               # physical + virtual pins
category = registry.category(kind)
component = registry.create(kind, x=0, y=0)
registry.register(kind, definition)      # rejects duplicate kinds
registry.load_plugins(paths)            # .py files or immediate folder children
engine_project = registry.engine_project(project)
```

Installed data is resolved from `Path(__file__).parents[1] / 'resources'`.
`create` supplies a fresh UUID, copied properties, rotation zero and a copied
position. Definitions never share mutable component state. Load plugins before
reading documents that use their kinds. A plugin exports `register(registry)`;
failed registration rolls back that file's definition changes. Explicit plugins
execute trusted local Python code and are not loaded automatically from project
documents. `plugins/green_indicator.py` is a complete reusable example.

`engine_project` validates and returns a separate schema 1.4 circuit. Built-ins
retain their kinds. Custom kinds must declare `engineKind` naming a bundled
built-in and the same exact pin IDs; missing models or mismatched pins raise a
clear `ValueError`. Saved native documents keep custom kinds. The browser's closed
catalogue requires an explicit converted export to reopen such a circuit. This
conversion loses plugin identity, so keep the native original.

## Documents

```python
from simulab_desktop.core import (
    parse_project, parse_document, new_workspace, serialize_document,
    save_document, load_document,
)

project = parse_project(text, registry)
workspace = parse_document(text, registry)
workspace = new_workspace(registry, board_kind=None)
text = serialize_document(workspace, registry)
save_document(path, workspace, registry)
workspace = load_document(path, registry)
```

`parse_project` accepts circuit schemas 1.0 through 1.4. `parse_document` accepts a
bare circuit or browser IDE workspace v1 and always returns a workspace v1.
Imported workspaces open on Hardware, matching the browser. Bare circuits receive
an empty sketch; no firmware or sample source is silently selected. Default New
is blank. Explicit `board_kind` places Uno/Nano/Mega/YD and loads its packaged
target-compatible source starter when available.

Validators bound sizes, arrays, identifiers, coordinate/property values, source
names/UTF-8 bytes, cursor/breakpoints and referential integrity. They reject
nonfinite coordinates, unsupported rotation/schema, duplicate component/wire IDs,
duplicate reverse connections, unknown kinds/pins, self wires and reserved Windows
source filenames. Registered custom kinds are accepted; unavailable plugins fail
with a useful missing-kind error. Known expanded model parameters share upstream
bounds. Unknown scalar extension properties remain portable.

Serialization emits only the browser's portable fields: no tokens, compiler
artifacts or runtime state. Save validates before touching the destination, writes
and fsyncs a same-directory temporary file, then replaces atomically. Failed
replacement cleans up its temporary file and preserves the prior destination.

## History

```python
history = History(initial, limit=100)
document = history.current
history.commit(next_document)
document_or_none = history.undo()
document_or_none = history.redo()
history.reset(next_document)
can_undo, can_redo = history.can_undo, history.can_redo
```

All document boundaries deep-copy. Undo/redo return a document copy or `None` when
unavailable. Do not interpret a valid empty dictionary as a failed undo; test
`is None`. Commit ignores equal documents and clears redo after changed edits.
The host should commit once at the end of a drag and reset history on confirmed
New/Open. History itself does not load or stop firmware.

## Editing and topology

```python
from simulab_desktop.core.editing import (
    add_component, delete_components, delete_wires, connect,
    clone_components, move_components, split_wire,
)

next_project = add_component(project, component, registry=None)
next_project = delete_components(project, component_ids)
next_project = delete_wires(project, wire_ids)
next_project = connect(project, from_endpoint, to_endpoint, registry,
                       color='#5bbfa8', label='')
next_project = clone_components(project, component_ids, dx=30, dy=30)
next_project = move_components(project, {component_id: {'x': x, 'y': y}})
next_project = split_wire(project, wire_id, x, y, registry)
```

Every helper returns an independent project. Add accepts a component dictionary
from `registry.create`, upgrades to schema 1.4 and optionally performs full
validation when the registry argument is supplied. Clone creates fresh component
and wire UUIDs, offsets the placement and copies only wires wholly within the
selected components. Delete removes incident wires. Move takes absolute positions
and never changes endpoint identity. Short aliases `add`, `delete`, `clone`,
`move` are available.

Endpoints use `{'componentId': ..., 'pinId': ...}`. Shared pins form branches;
crossings remain disconnected. `split_wire` splits exactly one selected wire
through a real `junction.J` component, preserving the original wire's style.

`build_nets(project, registry)` returns deterministic
`[{'id': 'net-1', 'endpoints': [...]}]`, including isolated pins. Definition-level
`internalNets` are supported, with the published YD 3V3/GND pad groups preserved.
`validate_circuit` returns `{'severity': 'error'|'warning', 'message': ...}` rows for
unknown pins, power/ground shorts, incompatible rails, isolated device pins and
virtual service nets mixed with electrical terminals. It is structural ERC, not
an analog or safety solver. The real runtime separately quarantines virtual
DEBUG/CONSOLE service nets from electrical propagation.

## Verification performed

Tests were written first; the initial run failed because the core modules were
absent. After implementation:

```powershell
$env:PYTHONPATH='src'
.venv\Scripts\python.exe -m unittest discover -s tests -p test_core.py -v
.venv\Scripts\python.exe -m compileall -q src/simulab_desktop/core plugins
git diff --check
```

Result: 17 core tests passed. Coverage includes strict malformed/bounded imports,
all five schema versions, explicit branches/crossings/junction splitting,
immutable clone/move/delete, bounded history, failed-save preservation and temp
cleanup, model bounds, plugin alias validation, registration rollback and real
packaged examples/YD shared rails. All 33 exported catalogue definitions loaded;
all five packaged examples parsed; all four explicit board starters serialized;
the sample green-indicator plugin loaded successfully.

This package's verification does not establish Qt interaction behavior, real CPU
execution, compiler transport correctness or physical hardware parity; those are
the separate integration work packages.

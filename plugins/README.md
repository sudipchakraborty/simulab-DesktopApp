# Local component plugins

Load an explicitly selected `.py` file or folder. Each file exports
`register(registry)` and registers a definition with stable `kind`, `pins`,
`defaultProperties`, and optionally `name`, `description`, `category` and
`engineKind`. Copy `green_indicator.py` as a starting point.

Plugins execute local Python code, so load files you trust. They receive the
registry as a parameter and need no Qt or application-global objects. A failed
registration rolls back that plugin's definition changes. Duplicate kind IDs are
rejected. Load the same plugins before reopening their saved projects.

`engineKind` aliases an existing built-in electrical model. Its pin IDs must match
the built-in exactly. Parameters are copied per component. Execution fails with a
clear error when a custom kind has no supported model; no firmware behavior is
invented. The current bridge accepts only the bundled upstream model kinds.

Normal save retains the custom kind and all portable properties. The browser
application has a closed catalogue and cannot reopen custom kinds. A host may
explicitly export `registry.engine_project(project)` for a built-in-kind copy;
keep the native original to retain plugin identity.

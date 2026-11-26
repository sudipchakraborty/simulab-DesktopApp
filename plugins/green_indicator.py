"""@brief Drop-in parameterized LED example using the real upstream electrical model.

Select this file or its containing folder in the desktop plugin loader. Saved
documents retain green-indicator; reopening requires this plugin. Browser export
requires an explicit conversion via registry.engine_project(project).
"""


def register(registry):
    """@brief Initialize the plugin through the caller-owned registry, with no Qt imports.

    @param registry ComponentRegistry-compatible host supplied by the application.
    """
    definition = registry.get("led")
    definition.update(name="Green indicator", engineKind="led")
    definition["defaultProperties"]["color"] = "#38d986"
    registry.register("green-indicator", definition)

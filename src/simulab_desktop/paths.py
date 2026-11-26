"""@brief Resolve relocatable resources and injected local user-data directories."""

from pathlib import Path
import os


def resource_path(*parts: str) -> Path:
    """@brief Return a resource packaged beside this Python module."""
    return Path(__file__).parent.joinpath("resources", *parts)


def data_directory(override: str | Path | None = None) -> Path:
    """@brief Create the writable app directory; an explicit path wins over defaults.
    @param override Optional host/test-owned directory.
    @return Absolute writable directory, separate from installed source.
    """
    supplied = override or os.environ.get("SIMULAB_DESKTOP_DATA")
    root = Path(supplied) if supplied else Path(os.environ.get("LOCALAPPDATA", Path.home() / ".local/share")) / "SimuLabDesktop"
    root.mkdir(parents=True, exist_ok=True)
    return root.resolve()

"""@brief Bounded document history independent of UI and simulation lifecycle."""
from copy import deepcopy


class History:
    """@brief Copy documents at every boundary; transient drags should commit once on release."""

    def __init__(self, initial, limit: int = 100):
        if isinstance(limit, bool) or not isinstance(limit, int) or limit < 1:
            raise ValueError("History limit must be a positive integer")
        self.limit = limit
        self._current = deepcopy(initial)
        self._past = []
        self._future = []

    @property
    def current(self):
        """@brief Return an independent copy of the current document."""
        return deepcopy(self._current)

    @property
    def can_undo(self) -> bool:
        """@brief Whether an older committed document exists."""
        return bool(self._past)

    @property
    def can_redo(self) -> bool:
        """@brief Whether an undone committed document exists."""
        return bool(self._future)

    def commit(self, next_document):
        """@brief Commit one changed document, discard redo and bound retained past entries."""
        if next_document != self._current:
            self._past.append(self._current)
            self._past = self._past[-self.limit:]
            self._current = deepcopy(next_document)
            self._future.clear()
        return self.current

    def undo(self):
        """@brief Return previous document copy, or None when undo is unavailable."""
        if not self._past:
            return None
        self._future.append(self._current)
        self._current = self._past.pop()
        return self.current

    def redo(self):
        """@brief Return next document copy, or None when redo is unavailable."""
        if not self._future:
            return None
        self._past.append(self._current)
        self._current = self._future.pop()
        return self.current

    def reset(self, next_document):
        """@brief Replace the document and clear undo/redo after host-confirmed New/Open."""
        self._current = deepcopy(next_document)
        self._past.clear()
        self._future.clear()
        return self.current

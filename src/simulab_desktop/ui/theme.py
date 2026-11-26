"""@brief Central parameterized native widget palette."""

from PySide6.QtGui import QColor, QPalette, QFont

COLORS = {"background": "#10161f", "panel": "#18212d", "raised": "#202d3b", "line": "#314152", "text": "#dce7ef", "muted": "#9aafc0", "accent": "#44d7b6", "warning": "#f5c36a", "error": "#f77e81"}


def apply_theme(application, *, light=False):
    """@brief Apply Fusion widgets and a consistent palette to an injected QApplication."""
    application.setStyle("Fusion")
    palette = QPalette()
    c = {**COLORS}
    if light:
        c.update(background="#e7eef4", panel="#f8fbfd", raised="#dce8f0", line="#b7cbd8", text="#173044", muted="#536c80", accent="#087f73")
    for role, key in [(QPalette.ColorRole.Window, "panel"), (QPalette.ColorRole.Base, "background"), (QPalette.ColorRole.AlternateBase, "raised"), (QPalette.ColorRole.WindowText, "text"), (QPalette.ColorRole.Text, "text"), (QPalette.ColorRole.Button, "raised"), (QPalette.ColorRole.ButtonText, "text"), (QPalette.ColorRole.Highlight, "accent")]:
        palette.setColor(role, QColor(c[key]))
    palette.setColor(QPalette.ColorRole.HighlightedText, QColor("#10251f"))
    palette.setColor(QPalette.ColorRole.PlaceholderText, QColor(c["muted"]))
    palette.setColor(QPalette.ColorGroup.Disabled, QPalette.ColorRole.Text, QColor(c["muted"]))
    palette.setColor(QPalette.ColorGroup.Disabled, QPalette.ColorRole.ButtonText, QColor(c["muted"]))
    application.setPalette(palette)
    application.setFont(QFont("Segoe UI", 10))
    application.setStyleSheet(f"""
        QMainWindow, QDialog {{ background: {c['background']}; }}
        QDockWidget::title {{ padding: 8px; background: {c['raised']}; font-weight: bold; }}
        QToolBar {{ border: 0; spacing: 8px; padding: 7px; background: {c['panel']}; }}
        QToolButton, QPushButton {{ padding: 6px 10px; border-radius: 5px; border: 1px solid {c['line']}; background: {c['raised']}; }}
        QToolButton:hover, QPushButton:hover {{ border-color: {c['accent']}; }}
        QToolButton:checked {{ background: {c['accent']}; color: #10251f; }}
        QLineEdit, QSpinBox, QDoubleSpinBox, QComboBox {{ padding: 5px; border: 1px solid {c['line']}; border-radius: 4px; }}
        QTreeWidget, QListWidget, QTableWidget, QPlainTextEdit {{ border: 1px solid {c['line']}; }}
        QHeaderView::section {{ padding: 5px; background: {c['raised']}; border: 0; }}
        QTabBar::tab {{ padding: 8px 14px; }}
        QTabBar::tab:selected {{ color: {c['accent']}; }}
        QStatusBar {{ background: {c['panel']}; color: {c['muted']}; }}
        QSplitter::handle {{ background: {c['line']}; }}
        QLabel#muted {{ color: {c['muted']}; }}
        QProgressBar {{ border: 1px solid {c['line']}; border-radius: 4px; text-align: center; min-height: 18px; }}
        QProgressBar::chunk {{ background: {c['accent']}; }}
    """)

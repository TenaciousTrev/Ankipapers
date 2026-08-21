"""
WebView window for Anki Papers.

Opens a QWebEngineView that loads the React frontend and connects
it to the Python backend via QWebChannel.
"""

import os
from aqt.qt import (
    QMainWindow,
    QUrl,
    QWidget,
    QVBoxLayout,
    Qt,
    QTimer,
)
from aqt import mw

try:
    from PyQt6.QtWebEngineWidgets import QWebEngineView
    from PyQt6.QtWebChannel import QWebChannel
    from PyQt6.QtWebEngineCore import QWebEnginePage, QWebEngineSettings
except ImportError:
    try:
        from PyQt5.QtWebEngineWidgets import QWebEngineView
        from PyQt5.QtWebChannel import QWebChannel
        from PyQt5.QtWebEngineCore import QWebEnginePage
    except ImportError:
        QWebEngineView = None
        QWebChannel = None

from .bridge import AnkiPapersBridge


class AnkiPapersWindow(QMainWindow):
    """Main Anki Papers window using a QWebEngineView for the React UI."""

    _instance = None

    @classmethod
    def instance(cls):
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance

    @classmethod
    def show_window(cls):
        if QWebEngineView is None:
            from aqt.qt import QMessageBox
            QMessageBox.critical(
                mw,
                "Anki Papers",
                "QWebEngineView is not available.\n"
                "Please update your Anki installation.",
            )
            return None

        win = cls.instance()
        win.show()
        win.raise_()
        win.activateWindow()
        return win

    def __init__(self):
        super().__init__(mw)
        self.setWindowTitle("Anki Papers")
        self.setMinimumSize(1000, 650)
        self.resize(1200, 750)

        # Create the web view
        self.webview = QWebEngineView(self)
        self.setCentralWidget(self.webview)

        # Setup the bridge
        self.bridge = AnkiPapersBridge(self)
        self.channel = QWebChannel(self)
        self.channel.registerObject("bridge", self.bridge)
        self.webview.page().setWebChannel(self.channel)

        # Tell us when the page's render process dies. Without this a crashed
        # renderer just leaves a blank white window with no explanation and no
        # way back — see _on_render_process_gone below.
        try:
            self.webview.page().renderProcessTerminated.connect(
                self._on_render_process_gone
            )
        except Exception:
            # Older Qt bindings may not expose the signal; a missing crash
            # handler must never stop the window from opening.
            pass

        # Configure web settings
        settings = self.webview.settings()
        settings.setAttribute(QWebEngineSettings.WebAttribute.LocalContentCanAccessFileUrls, True)
        settings.setAttribute(QWebEngineSettings.WebAttribute.LocalContentCanAccessRemoteUrls, True)

        # Load the React app
        self._load_ui()

    def _load_ui(self):
        """Load the React frontend from the web/ directory."""
        addon_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        web_dir = os.path.join(addon_dir, "web")
        index_path = os.path.join(web_dir, "index.html")

        if os.path.exists(index_path):
            url = QUrl.fromLocalFile(index_path)
            self.webview.load(url)
        else:
            # Fallback: show error message
            self.webview.setHtml(
                f"""
                <html>
                <body style="background:#0b0b14;color:#e8e8f0;font-family:Inter,sans-serif;
                             display:flex;align-items:center;justify-content:center;height:100vh;
                             flex-direction:column;gap:16px">
                    <div style="font-size:48px">📝</div>
                    <h1 style="color:#6c5ce7">Anki Papers</h1>
                    <p style="color:#636380">
                        Web UI not found. Please build the React app first.
                    </p>
                    <p style="color:#636380;font-size:12px">
                        Expected: {index_path}
                    </p>
                    <code style="color:#e17055;background:#1a1a2e;padding:8px 16px;border-radius:6px">
                        cd web_src && npm run build
                    </code>
                </body>
                </html>
                """,
                QUrl.fromLocalFile(web_dir + "/"),
            )

    # ─── Render process crashes ──────────────────────
    # The React UI runs in a separate Chromium process. If that process dies,
    # QWebEngineView does not tell the user anything — it just shows an empty
    # white window, forever, and Anki carries on as though nothing happened.
    # This turns that silent failure into something readable and recoverable.

    _RENDER_EXIT_REASONS = {
        0: "the page shut down normally",
        1: "the page exited unexpectedly",
        2: "the page crashed",
        3: "the page was killed, usually because the system ran short of memory",
    }

    _reload_attempts = 0

    def _on_render_process_gone(self, status, exit_code):
        # Closing the window navigates to about:blank on purpose, which ends
        # the render process normally. That is not a crash.
        if self._shutting_down:
            return
        try:
            status_value = int(status)
        except (TypeError, ValueError):
            status_value = -1
        if status_value == 0:
            return

        reason = self._RENDER_EXIT_REASONS.get(status_value, "the page stopped unexpectedly")
        print(f"[Anki Papers] render process gone: {reason} (exit code {exit_code})")

        from aqt.qt import QMessageBox

        self._reload_attempts += 1
        if self._reload_attempts > 3:
            QMessageBox.critical(
                self,
                "Anki Papers",
                f"The Anki Papers window keeps failing — {reason}.\n\n"
                "Close this window and reopen it from the Tools menu. If it "
                "happens again, restarting Anki will clear it.",
            )
            return

        # Anki 2.1.50+ ships PyQt6 (scoped enums); older builds use PyQt5.
        try:
            reload_button = QMessageBox.StandardButton.Reload
            close_button = QMessageBox.StandardButton.Close
        except AttributeError:
            reload_button = QMessageBox.Reload
            close_button = QMessageBox.Close

        answer = QMessageBox.warning(
            self,
            "Anki Papers",
            f"The Anki Papers window stopped because {reason}.\n\n"
            "Your papers are safe on disk up to the last save. Anything typed "
            "since then could not be recovered.\n\nReload the window?",
            reload_button | close_button,
            reload_button,
        )
        if answer == reload_button:
            # Rebuild the page from scratch. reload() on a dead render process
            # is unreliable, so load the file again instead.
            QTimer.singleShot(0, self._load_ui)
        else:
            self.close()

    # ─── Shutdown ────────────────────────────────────
    # Closing the window used to only clear the singleton. The QWebEngineView
    # was never torn down and the window stayed alive as a child of `mw`, so
    # the React app kept running after the window disappeared — including its
    # autosave timer, which held the document as it looked at close time and
    # kept writing that stale snapshot back to storage. Every open/close cycle
    # left another one of these behind, so a hidden, forgotten window could
    # silently overwrite work done in the current one.
    #
    # Now closing does two things, in order:
    #   1. asks the page to flush a final save (nothing recent is lost), then
    #   2. navigates the page to about:blank and deletes it, so no JavaScript
    #      — and no autosave timer — can outlive the window.

    _shutting_down = False

    def closeEvent(self, event):
        # Second pass (after the flush): actually tear everything down.
        if self._shutting_down:
            self._teardown_webview()
            AnkiPapersWindow._instance = None
            super().closeEvent(event)
            return

        # First pass: defer the close until the page has saved.
        self._shutting_down = True
        event.ignore()
        self._flush_then_close()

    def _flush_then_close(self):
        """Ask the page to save, then close for real (with a safety timeout)."""
        finished = {"done": False}

        def finish(*_args):
            if finished["done"]:
                return
            finished["done"] = True
            self.close()  # re-enters closeEvent with _shutting_down = True

        js = (
            "(function(){ try {"
            "  return window.ankiPapersFlush ? window.ankiPapersFlush() : false;"
            "} catch (e) { return false; } })()"
        )
        try:
            self.webview.page().runJavaScript(js, lambda _res: finish())
        except Exception:
            finish()
            return
        # Never let a wedged page block the window from closing.
        QTimer.singleShot(2000, finish)

    def _teardown_webview(self):
        """Stop the page for good so nothing keeps running in the background."""
        try:
            self.webview.page().setWebChannel(None)
        except Exception:
            pass
        try:
            # Navigating away destroys the React app and every timer it owns.
            self.webview.setUrl(QUrl("about:blank"))
        except Exception:
            pass
        try:
            self.webview.deleteLater()
        except Exception:
            pass
        self.deleteLater()

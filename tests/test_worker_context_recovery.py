from playwright.async_api import Error as PlaywrightError

from auto_yt.worker import _is_dead_browser_context_error


def test_detects_plain_driver_connection_error() -> None:
    error = Exception(
        "BrowserContext.new_page: Connection closed while reading from the driver"
    )

    assert _is_dead_browser_context_error(error)


def test_detects_playwright_error() -> None:
    assert _is_dead_browser_context_error(PlaywrightError("Browser has been closed"))


def test_ignores_unrelated_error() -> None:
    assert not _is_dead_browser_context_error(ValueError("Invalid JSON response"))

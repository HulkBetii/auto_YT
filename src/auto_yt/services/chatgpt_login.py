from __future__ import annotations

import asyncio
import json
import logging

logger = logging.getLogger(__name__)

# --- Constants -----------------------------------------------------------

CHATGPT_URL = "https://chatgpt.com"
AUTH_DOMAIN = "auth.openai.com"

# Timeouts (ms)
NAVIGATION_TIMEOUT_MS = 30_000
CLOUDFLARE_WAIT_MS = 15_000   # max wait for Cloudflare challenge to clear
LOGIN_BUTTON_TIMEOUT_MS = 10_000
INPUT_TIMEOUT_MS = 10_000
POST_LOGIN_TIMEOUT_MS = 45_000

# Selectors – stable attributes only, no react-aria-* IDs
SEL_LOGIN_BUTTON = (
    'button:has-text("Log in"), '
    'a:has-text("Log in"), '
    '[data-testid="login-button"]'
)
SEL_EMAIL_INPUT    = 'input[name="email"], input[autocomplete="email"]'
SEL_PASSWORD_INPUT = 'input[name="password"], input[type="password"][autocomplete="current-password"]'
SEL_SUBMIT_BUTTON  = 'button[type="submit"]'
SEL_MFA_INPUT      = 'input[inputmode="numeric"], input[name="code"], input[autocomplete="one-time-code"]'
SEL_PROFILE_BUTTON = '[data-testid="accounts-profile-button"]'
SEL_BOOTSTRAP      = 'script#client-bootstrap'

# Cloudflare injects this title while the JS challenge runs
_CLOUDFLARE_TITLES = {"just a moment...", "checking your browser"}


class ChatGPTLoginError(Exception):
    """Raised when login fails for a known reason."""


class ChatGPTLoginCredentialError(ChatGPTLoginError):
    """Wrong email or password."""


class ChatGPTLoginMFAError(ChatGPTLoginError):
    """MFA required but no totp_secret provided, or TOTP rejected."""


class ChatGPTLoginVerifyError(ChatGPTLoginError):
    """Anti-bot / captcha / extra verification required."""


# --- Helpers -------------------------------------------------------------

async def _wait_past_cloudflare(page, timeout_ms: int = CLOUDFLARE_WAIT_MS) -> None:
    """
    Poll until the page title is no longer the Cloudflare challenge title.
    Raises ChatGPTLoginVerifyError if the challenge doesn't clear in time.
    This is a best-effort guard; the challenge self-resolves in headed mode.
    """
    deadline = asyncio.get_event_loop().time() + timeout_ms / 1000
    while asyncio.get_event_loop().time() < deadline:
        title = await page.title()
        if title.lower() not in _CLOUDFLARE_TITLES:
            return
        await asyncio.sleep(1)
    raise ChatGPTLoginVerifyError(
        "Cloudflare challenge did not clear. "
        "Run in headed mode (headless=False) and ensure the browser is not detected."
    )


async def _fill_and_submit(page, selector: str, value: str, timeout_ms: int = INPUT_TIMEOUT_MS) -> None:
    """Wait for a visible input, fill it, then click the submit button."""
    field = page.locator(selector).first
    await field.wait_for(state="visible", timeout=timeout_ms)
    await field.fill(value)
    await asyncio.sleep(0.3)
    submit = page.locator(SEL_SUBMIT_BUTTON).first
    await submit.click()


async def _get_bootstrap_data(page) -> dict | None:
    """Parse the JSON inside <script id='client-bootstrap'>."""
    try:
        content = await page.locator(SEL_BOOTSTRAP).first.inner_text(timeout=3_000)
        return json.loads(content)
    except Exception:
        return None


async def _verify_logged_in(page) -> dict:
    """
    Return {"logged_in": bool, "user": dict | None}.

    Primary:  client-bootstrap authStatus == "logged_in".
    Fallback: profile button visible + not on auth domain.
    """
    bootstrap = await _get_bootstrap_data(page)
    if bootstrap:
        auth_status = bootstrap.get("authStatus")
        session = bootstrap.get("session")
        if auth_status == "logged_in" and isinstance(session, dict):
            user_info = session.get("user") or {}
            return {
                "logged_in": True,
                "user": {
                    "email": user_info.get("email", ""),
                    "name":  user_info.get("name", ""),
                    "plan":  user_info.get("plan", ""),
                },
            }
        if auth_status == "logged_out":
            return {"logged_in": False, "user": None}

    # DOM fallback
    try:
        await page.locator(SEL_PROFILE_BUTTON).first.wait_for(state="visible", timeout=5_000)
        if AUTH_DOMAIN not in page.url:
            return {"logged_in": True, "user": {"email": "", "name": "", "plan": ""}}
    except Exception:
        pass

    return {"logged_in": False, "user": None}


async def _detect_error_state(page) -> str | None:
    """Return visible error banner text, or None."""
    for sel in ('[data-testid="error-message"]', '[role="alert"]', ".error-message"):
        try:
            el = page.locator(sel).first
            if await el.is_visible(timeout=1_000):
                return (await el.inner_text(timeout=2_000)).strip()
        except Exception:
            continue
    return None


# --- Main ----------------------------------------------------------------

async def login_gpt_auto(account: dict, page) -> dict:
    """
    Log in to chatgpt.com using Playwright.

    Parameters
    ----------
    account : dict
        Required keys: "email", "password".
        Optional key:  "totp_secret" (base-32 string) for MFA accounts.
    page : playwright.async_api.Page
        Playwright page from a dedicated browser context (one per account).
        The browser MUST be launched with headless=False to pass Cloudflare.

    Returns
    -------
    dict  {"success": True, "cookies": list[dict], "user": dict}
        cookies — full context cookie jar (all domains)
        user    — {"email": str, "name": str, "plan": str}

    Raises
    ------
    ChatGPTLoginCredentialError  — wrong email or password
    ChatGPTLoginMFAError         — MFA issue
    ChatGPTLoginVerifyError      — Cloudflare / captcha / anti-bot wall
    ChatGPTLoginError            — any other login failure
    """
    email       = str(account.get("email", "")).strip()
    password    = str(account.get("password", ""))
    totp_secret = str(account.get("totp_secret") or "").strip() or None

    if not email or not password:
        raise ChatGPTLoginError("Missing 'email' or 'password' in account dict.")

    context = page.context

    # --- Step 1: Navigate and wait past Cloudflare -----------------------
    logger.info("[1] Navigating to %s", CHATGPT_URL)
    await page.goto(CHATGPT_URL, wait_until="domcontentloaded", timeout=NAVIGATION_TIMEOUT_MS)
    await _wait_past_cloudflare(page)
    await asyncio.sleep(1)

    # Already logged in? (e.g. existing cookies from a previous run)
    verify = await _verify_logged_in(page)
    if verify["logged_in"]:
        logger.info("[1] Already logged in as %s", verify["user"])
        return {"success": True, "cookies": await context.cookies(), "user": verify["user"]}

    # --- Step 2: Click "Log in" ------------------------------------------
    logger.info("[2] Clicking Log in")
    login_btn = page.locator(SEL_LOGIN_BUTTON).first
    await login_btn.wait_for(state="visible", timeout=LOGIN_BUTTON_TIMEOUT_MS)
    await login_btn.click()
    await page.wait_for_url(f"**/{AUTH_DOMAIN}/**", timeout=NAVIGATION_TIMEOUT_MS)
    await asyncio.sleep(1)

    # --- Step 3: Email ---------------------------------------------------
    logger.info("[3] Entering email")
    await _fill_and_submit(page, SEL_EMAIL_INPUT, email)
    await asyncio.sleep(1.5)

    error = await _detect_error_state(page)
    if error:
        raise ChatGPTLoginCredentialError(f"Email step rejected: {error}")

    # --- Step 4: Password ------------------------------------------------
    logger.info("[4] Entering password")
    try:
        await _fill_and_submit(page, SEL_PASSWORD_INPUT, password)
    except Exception as exc:
        error = await _detect_error_state(page)
        if error:
            raise ChatGPTLoginCredentialError(f"Password form error: {error}") from exc
        raise ChatGPTLoginError(f"Password field not found: {exc}") from exc

    await asyncio.sleep(2)

    error = await _detect_error_state(page)
    if error:
        lower = error.lower()
        if any(kw in lower for kw in ("password", "incorrect", "credential", "wrong")):
            raise ChatGPTLoginCredentialError(f"Wrong password: {error}")
        raise ChatGPTLoginError(f"Login error after password: {error}")

    # --- Step 5: MFA (TOTP) if prompted ----------------------------------
    try:
        mfa_input = page.locator(SEL_MFA_INPUT).first
        await mfa_input.wait_for(state="visible", timeout=5_000)
        # MFA prompt appeared
        if not totp_secret:
            raise ChatGPTLoginMFAError("MFA form appeared but no totp_secret in account dict.")
        import pyotp  # lazy — only needed when MFA is active
        totp_code = pyotp.TOTP(totp_secret).now()
        logger.info("[5] Submitting TOTP code")
        await mfa_input.fill(totp_code)
        await asyncio.sleep(0.3)
        await page.locator(SEL_SUBMIT_BUTTON).first.click()
        await asyncio.sleep(2)
        mfa_error = await _detect_error_state(page)
        if mfa_error:
            raise ChatGPTLoginMFAError(f"TOTP rejected: {mfa_error}")
    except (ChatGPTLoginMFAError, ChatGPTLoginError):
        raise
    except Exception:
        # No MFA form — normal flow
        pass

    # --- Step 6: Wait for redirect to chatgpt.com ------------------------
    logger.info("[6] Waiting for redirect back to chatgpt.com")
    try:
        await page.wait_for_url("**/chatgpt.com/**", timeout=POST_LOGIN_TIMEOUT_MS)
    except Exception:
        if AUTH_DOMAIN in page.url:
            raise ChatGPTLoginVerifyError(
                f"Still on {AUTH_DOMAIN} — captcha or extra verification required. URL: {page.url}"
            )

    await asyncio.sleep(2)

    # --- Step 7: Verify --------------------------------------------------
    logger.info("[7] Verifying login")
    verify = await _verify_logged_in(page)
    if not verify["logged_in"]:
        # NextAuth hydration can lag — one reload retry
        await page.reload(wait_until="domcontentloaded", timeout=NAVIGATION_TIMEOUT_MS)
        await asyncio.sleep(3)
        verify = await _verify_logged_in(page)

    if not verify["logged_in"]:
        raise ChatGPTLoginError(
            "Login flow completed but authStatus is not 'logged_in'. "
            "Possible anti-bot block or session issue."
        )

    # --- Step 8: Collect cookies -----------------------------------------
    cookies = await context.cookies()
    logger.info("[8] Done — captured %d cookies for %s", len(cookies), email)

    return {"success": True, "cookies": cookies, "user": verify["user"]}


async def restore_session(cookies: list[dict], page) -> dict:
    """
    Restore a previously captured session by injecting saved cookies.

    Returns the same dict shape as login_gpt_auto.
    Raises ChatGPTLoginError if the cookies are expired / invalid.
    """
    context = page.context
    await context.add_cookies(cookies)
    await page.goto(CHATGPT_URL, wait_until="domcontentloaded", timeout=NAVIGATION_TIMEOUT_MS)
    await _wait_past_cloudflare(page)
    await asyncio.sleep(2)

    verify = await _verify_logged_in(page)
    if not verify["logged_in"]:
        raise ChatGPTLoginError("Session restore failed — cookies expired or invalid.")

    return {"success": True, "cookies": await context.cookies(), "user": verify["user"]}


# TODO: Error states cụ thể (sai pass exact wording, captcha detection heuristics)
# TODO: Cấu trúc thư mục lưu trữ local (vd chrome_user_data/PROFILE_X)

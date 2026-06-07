# auto_YT — ChatGPT Auto Login

Desktop tool to auto-login ChatGPT accounts via Playwright, with session persistence.

## Setup

```bash
pip install -r requirements.txt
python -m playwright install chromium
```

## Usage

```bash
python run_app.py
```

Fill in **Email**, **Password**, and (optionally) **TOTP Secret**, then click **Save** or **Auto Login**.

## Storage Schema

Local account data is stored in `data/account.json` under `gpt_account1`:

```json
{
  "gpt_account1": {
    "email": "YOUR_EMAIL@gmail.com",
    "password": "YOUR_PASSWORD",
    "totp_secret": "YOUR_BASE32_TOTP_SECRET",
    "session_cookie": [],
    "folder_user_data": "PROFILE_GPT_1",
    "type_account": "plus"
  }
}
```

Decisions:

- `gpt_account1` is the default key for the first ChatGPT account.
- `session_cookie` stores the full cookie jar returned by Playwright.
- `folder_user_data` points to a dedicated GPT profile under `data/chrome_user_data/PROFILE_GPT_1`.
- GPT uses a separate Chrome profile instead of sharing profiles with other services.

## Project Structure

```
auto_YT/
├── run_app.py                  # launch UI
├── requirements.txt
├── config/
│   └── account.example.json    # schema template (no real secrets)
├── data/                       # gitignored — local secrets, sessions, profiles
│   ├── account.json
│   ├── session_chatgpt.json
│   └── chrome_user_data/
├── src/auto_yt/
│   ├── app.py                  # QApplication entrypoint
│   ├── paths.py                # central path constants
│   ├── services/
│   │   └── chatgpt_login.py    # login_gpt_auto + restore_session
│   └── ui/
│       └── login_window.py     # LoginWindow + LoginWorker
└── tests/
    └── test_login_e2e.py       # e2e test (needs real credentials)
```

## Known Error Handling

`chatgpt_login.py` raises precise exceptions for common OpenAI/Auth0 states:

- `ChatGPTLoginCredentialError`: wrong email/password, including the current text `Incorrect email address or password`.
- `ChatGPTLoginMFAError`: missing, invalid, incorrect, or expired TOTP code.
- `ChatGPTLoginVerifyError`: Cloudflare, Turnstile, captcha, or `Verify you are human` challenge.
- `ChatGPTLoginDeviceVerificationError`: new-device, email, or identity verification requirement.

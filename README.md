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

Fill in **Email**, **Password**, and (optionally) **TOTP Secret**, then click **Auto Login**.

## Project Structure

```
auto_YT/
├── run_app.py                  # launch UI
├── requirements.txt
├── config/
│   └── account.example.json    # schema template (no real secrets)
├── data/                       # gitignored — local secrets & sessions
│   ├── account.json
│   └── session_chatgpt.json
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

## Config

Copy `config/account.example.json` → `data/account.json` and fill in your credentials.
The UI also saves/loads from `data/account.json` automatically.

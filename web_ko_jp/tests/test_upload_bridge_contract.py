"""
test_upload_bridge_contract.py
==============================
Validates that Nexus's browser_youtube_uploader functions match the exact contract
and parameter signatures expected by web_ko_jp's upload bridge.
"""

from __future__ import annotations

import inspect
from pathlib import Path
import sys
import pytest

from upload_preflight import DEFAULT_NEXUS_PYTHON, DEFAULT_NEXUS_ROOT, REQUIRED_NEXUS_PARAMS, check_nexus_contract

NEXUS_AVAILABLE = DEFAULT_NEXUS_PYTHON.exists() and (DEFAULT_NEXUS_ROOT / "src").exists()


@pytest.mark.skipif(not NEXUS_AVAILABLE, reason="Nexus venv not found at default path")
def test_nexus_uploader_contract_via_preflight():
    ok, msg = check_nexus_contract(DEFAULT_NEXUS_PYTHON, DEFAULT_NEXUS_ROOT)
    assert ok is True, f"Nexus contract check failed: {msg}"


@pytest.mark.skipif(not NEXUS_AVAILABLE, reason="Nexus venv not found at default path")
def test_nexus_function_signatures_via_nexus_python():
    import json
    import subprocess

    code = (
        "import sys; "
        f"sys.path.insert(0, r'{DEFAULT_NEXUS_ROOT / 'src'}'); "
        "import inspect; "
        "from auto_yt.services import browser_youtube_uploader as uploader; "
        "u_params = list(inspect.signature(uploader.upload_video_via_browser).parameters.keys()); "
        "p_params = list(inspect.signature(uploader.make_video_public_via_browser).parameters.keys()); "
        "import json; print(json.dumps({'upload': u_params, 'public': p_params}))"
    )
    res = subprocess.run(
        [str(DEFAULT_NEXUS_PYTHON), "-c", code],
        capture_output=True,
        text=True,
        timeout=15,
        encoding="utf-8",
        errors="replace",
    )
    assert res.returncode == 0, f"Failed to inspect Nexus signatures: {res.stderr}"
    data = json.loads(res.stdout.strip())
    upload_params = set(data["upload"])
    for req in REQUIRED_NEXUS_PARAMS:
        assert req in upload_params, f"Parameter '{req}' missing from Nexus upload signature"

    public_params = set(data["public"])
    assert "profile_id" in public_params
    assert "youtube_video_id" in public_params


@pytest.mark.skipif(not NEXUS_AVAILABLE, reason="Nexus venv not found at default path")
def test_bridge_check_action(tmp_path):
    import json
    import subprocess

    job_file = tmp_path / "test_check_job.json"
    log_file = tmp_path / "test_check_log.jsonl"
    job_file.write_text(json.dumps({"action": "check", "nexus_root": str(DEFAULT_NEXUS_ROOT)}), encoding="utf-8")

    bridge_script = Path(__file__).resolve().parents[1] / "scripts" / "youtube_upload_bridge.py"
    cmd = [
        str(DEFAULT_NEXUS_PYTHON),
        str(bridge_script),
        "--job-file",
        str(job_file),
        "--log-file",
        str(log_file),
    ]

    res = subprocess.run(cmd, capture_output=True, text=True, errors="replace", timeout=15)
    assert res.returncode == 0
    assert log_file.exists()

    events = [json.loads(line) for line in log_file.read_text(encoding="utf-8").splitlines() if line.strip()]
    assert len(events) >= 1
    assert events[0].get("type") == "result"
    assert events[0].get("status") == "check_ok"

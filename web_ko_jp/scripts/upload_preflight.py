"""
upload_preflight.py
===================
Pure, testable preflight validation engine for YouTube video uploads in web_ko_jp.
Validates:
  1. Metadata pre-publish gate (FAIL blocks, WARN requires --ack-warn).
  2. Rendered MP4 specifications (duration within ±2s of audio, min 720p, 16:9).
  3. Thumbnail image (exists, 16:9, <= 2MB YouTube limit).
  4. Japanese subtitles file (.srt).
  5. Upload configuration, Nexus venv, Nexus contract signature, and GPM profile API.
  6. Database state (scheduled/published prevents duplicate upload without --force-new).
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

sys.stdout.reconfigure(encoding="utf-8")

REPO_ROOT = Path(__file__).resolve().parents[2]
SRC_DIR = REPO_ROOT / "src"
SCRIPTS_DIR = Path(__file__).resolve().parent
if str(SRC_DIR) not in sys.path:
    sys.path.insert(0, str(SRC_DIR))
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

from build_metadata_kit import (
    DEFAULT_REGISTRY_PATH,
    OUTPUT_BASE,
    build_gate,
    collect_kit_inputs,
    fetch_video_record,
    find_output_folder,
    load_data_json,
)
from channel_profile import (
    CONTAINS_SYNTHETIC_MEDIA,
    MADE_FOR_KIDS,
    PUBLISH_TIMEZONE,
    RENDER_SUBDIR,
    VIDEO_LANGUAGE,
    YOUTUBE_CATEGORY_ID,
    YOUTUBE_CHANNEL_ID,
)
from channel_registry import ChannelRegistry
from metadata_gate import GateReport
import upload_store


MAX_THUMBNAIL_BYTES = 2 * 1024 * 1024  # 2MB strict YouTube Studio limit
MIN_VIDEO_WIDTH = 1280
MIN_VIDEO_HEIGHT = 720
TARGET_ASPECT_RATIO = 16.0 / 9.0
ASPECT_RATIO_TOLERANCE = 0.05
MAX_DURATION_DIFF_SECONDS = 2.0
DEFAULT_CONFIG_PATH = REPO_ROOT / "web_ko_jp" / "data" / "upload_config.json"
DEFAULT_NEXUS_ROOT = Path(r"D:\VibeCoding\auto_upload\Nexus")
DEFAULT_NEXUS_PYTHON = DEFAULT_NEXUS_ROOT / ".venv" / "Scripts" / "python.exe"

REQUIRED_NEXUS_PARAMS = (
    "profile_id",
    "video_path",
    "thumbnail_path",
    "title",
    "description",
    "tags",
    "category_id",
    "made_for_kids",
    "contains_synthetic_media",
    "publish_mode",
    "expected_channel_id",
    "existing_video_id",
)


@dataclass
class PreflightCheck:
    id: str
    name: str
    passed: bool
    severity: str  # "fail" or "warn"
    detail: str = ""


@dataclass
class PreflightResult:
    ok: bool
    status: str  # "PASS", "WARN_ACK_REQUIRED", "FAIL"
    checks: List[PreflightCheck] = field(default_factory=list)
    errors: List[str] = field(default_factory=list)
    warnings: List[str] = field(default_factory=list)
    video_id: int = 0
    folder: Optional[Path] = None
    mp4_path: Optional[Path] = None
    thumbnail_path: Optional[Path] = None
    srt_path: Optional[Path] = None
    audio_path: Optional[Path] = None
    audio_duration: Optional[float] = None
    mp4_duration: Optional[float] = None
    sha256: Optional[str] = None
    metadata_snapshot: Dict[str, Any] = field(default_factory=dict)
    gate_report: Optional[GateReport] = None
    config: Dict[str, Any] = field(default_factory=dict)


def compute_file_sha256(file_path: Path) -> str:
    """Computes SHA-256 digest of a file in 64KB chunks."""
    h = hashlib.sha256()
    with open(file_path, "rb") as f:
        while chunk := f.read(65536):
            h.update(chunk)
    return h.hexdigest()


def probe_media(file_path: Path) -> Dict[str, Any]:
    """
    Probes audio/video/image properties using imageio_ffmpeg binary.
    Returns dict: duration (float sec or None), width (int or None), height (int or None).
    """
    try:
        import imageio_ffmpeg
        ffmpeg_exe = imageio_ffmpeg.get_ffmpeg_exe()
    except Exception as err:
        return {"error": f"Failed to get ffmpeg exe: {err}", "duration": None, "width": None, "height": None}

    cmd = [ffmpeg_exe, "-i", str(file_path)]
    res = subprocess.run(cmd, capture_output=True, text=True, errors="replace")

    duration = None
    width = None
    height = None

    # Parse Duration: 00:21:27.28
    m_dur = re.search(r"Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)", res.stderr)
    if m_dur:
        h, m, s = float(m_dur.group(1)), float(m_dur.group(2)), float(m_dur.group(3))
        duration = h * 3600.0 + m * 60.0 + s

    # Parse Video Stream dimensions: e.g. 1920x1080 or 1280x720
    m_dim = re.search(r"Stream.*Video:.*?(\d{3,4})x(\d{3,4})", res.stderr)
    if m_dim:
        width = int(m_dim.group(1))
        height = int(m_dim.group(2))

    return {
        "duration": duration,
        "width": width,
        "height": height,
        "raw_stderr": res.stderr[:500],
    }


def load_upload_config(config_path: Optional[Path] = None) -> Tuple[Optional[Dict[str, Any]], List[str]]:
    """Loads and validates upload_config.json."""
    path = config_path or DEFAULT_CONFIG_PATH
    errors = []
    if not path.exists():
        errors.append(
            f"Config file not found at {path}. "
            "Please copy web_ko_jp/data/upload_config.example.json to upload_config.json."
        )
        return None, errors

    try:
        with open(path, encoding="utf-8") as f:
            cfg = json.load(f)
    except Exception as err:
        errors.append(f"Invalid JSON in {path}: {err}")
        return None, errors

    # Check GPM profile id
    gpm_profile = (cfg.get("gpm_profile_id") or "").strip()
    if not gpm_profile or gpm_profile == "REPLACE_WITH_YOUR_GPM_PROFILE_ID":
        errors.append("gpm_profile_id is missing or set to placeholder in upload_config.json")

    # Resolve nexus root and python
    nexus_root = Path(cfg.get("nexus_root") or DEFAULT_NEXUS_ROOT)
    nexus_python = Path(cfg.get("nexus_python") or (nexus_root / ".venv" / "Scripts" / "python.exe"))

    if not nexus_root.exists():
        errors.append(f"nexus_root directory not found at {nexus_root}")
    if not nexus_python.exists():
        errors.append(f"nexus_python executable not found at {nexus_python}")

    cfg["nexus_root"] = str(nexus_root)
    cfg["nexus_python"] = str(nexus_python)
    return cfg, errors


def check_nexus_contract(nexus_python: Path, nexus_root: Path) -> Tuple[bool, str]:
    """
    Contract check: verifies that Nexus upload_video_via_browser accepts all expected parameters.
    Prevents runtime failures if Nexus modifies its function signature.
    """
    code = (
        "import sys; "
        f"sys.path.insert(0, r'{nexus_root / 'src'}'); "
        "import inspect; "
        "from auto_yt.services import browser_youtube_uploader as m; "
        "params = list(inspect.signature(m.upload_video_via_browser).parameters.keys()); "
        "import json; print(json.dumps(params))"
    )
    try:
        res = subprocess.run(
            [str(nexus_python), "-c", code],
            capture_output=True,
            text=True,
            timeout=15,
            encoding="utf-8",
            errors="replace",
        )
        if res.returncode != 0:
            return False, f"Contract inspection failed: {res.stderr.strip()[:300]}"
        params = set(json.loads(res.stdout.strip()))
        missing = [p for p in REQUIRED_NEXUS_PARAMS if p not in params]
        if missing:
            return False, f"Nexus upload_video_via_browser signature missing expected parameters: {missing}"
        return True, "Nexus uploader parameter contract matches expected signature"
    except Exception as err:
        return False, f"Contract inspection error: {err}"


def check_gpm_api(nexus_python: Path, nexus_root: Path) -> Tuple[bool, str]:
    """Checks whether GPM-Login API is reachable via Nexus gpm_service."""
    code = (
        "import sys; "
        f"sys.path.insert(0, r'{nexus_root / 'src'}'); "
        "from auto_yt.services import gpm_service; "
        "import json; print(json.dumps(gpm_service.check_gpm_connection()))"
    )
    try:
        res = subprocess.run(
            [str(nexus_python), "-c", code],
            capture_output=True,
            text=True,
            timeout=10,
            encoding="utf-8",
            errors="replace",
        )
        if res.returncode != 0:
            return False, f"GPM check script failed: {res.stderr.strip()[:300]}"
        data = json.loads(res.stdout.strip())
        if not data.get("online"):
            return False, f"GPM-Login API is offline: {data.get('message', 'No response')}"
        return True, f"GPM-Login API online ({data.get('total_profiles', 0)} profiles found)"
    except Exception as err:
        return False, f"GPM check error: {err}"


def run_preflight(
    video_id: int,
    ack_warn: bool = False,
    force_new: bool = False,
    config_path: Optional[Path] = None,
    skip_gpm_check: bool = False,
    output_base: Optional[Path] = None,
    registry_path: Optional[Path] = None,
) -> PreflightResult:
    """
    Main preflight runner. Pure and deterministic.
    Evaluates gate, media specs, configurations, and database state.
    """
    result = PreflightResult(ok=False, status="FAIL", video_id=video_id)
    base_dir = output_base or OUTPUT_BASE
    checks: List[PreflightCheck] = []
    errors: List[str] = []
    warnings: List[str] = []

    # 1. Config & Environment
    cfg, cfg_errors = load_upload_config(config_path)
    if cfg_errors or not cfg:
        for err in cfg_errors:
            errors.append(err)
            checks.append(PreflightCheck(id="config_valid", name="Upload Config", passed=False, severity="fail", detail=err))
    else:
        result.config = cfg
        checks.append(PreflightCheck(id="config_valid", name="Upload Config", passed=True, severity="fail", detail=f"gpm_profile={cfg['gpm_profile_id']}"))

        # Nexus Contract Check
        nexus_py = Path(cfg["nexus_python"])
        nexus_rt = Path(cfg["nexus_root"])
        contract_ok, contract_msg = check_nexus_contract(nexus_py, nexus_rt)
        checks.append(PreflightCheck(id="nexus_contract", name="Nexus Contract", passed=contract_ok, severity="fail", detail=contract_msg))
        if not contract_ok:
            errors.append(contract_msg)

        # GPM API Check
        if not skip_gpm_check:
            gpm_ok, gpm_msg = check_gpm_api(nexus_py, nexus_rt)
            checks.append(PreflightCheck(id="gpm_api", name="GPM API Connection", passed=gpm_ok, severity="fail", detail=gpm_msg))
            if not gpm_ok:
                errors.append(gpm_msg)
        else:
            checks.append(PreflightCheck(id="gpm_api", name="GPM API Connection", passed=True, severity="warn", detail="Skipped (--skip-gpm-check)"))

    # 2. Database Record & Output Folder
    record = None
    try:
        record = fetch_video_record(video_id)
    except Exception as err:
        errors.append(f"DB error fetching video {video_id}: {err}")
        checks.append(PreflightCheck(id="db_record", name="DB Video Record", passed=False, severity="fail", detail=str(err)))

    if not record:
        if not any(c.id == "db_record" for c in checks):
            msg = f"No database record found for video ID {video_id}"
            errors.append(msg)
            checks.append(PreflightCheck(id="db_record", name="DB Video Record", passed=False, severity="fail", detail=msg))
    else:
        checks.append(PreflightCheck(id="db_record", name="DB Video Record", passed=True, severity="fail", detail=f"title={record.get('title_jp', '')[:30]}"))

    folder = find_output_folder(video_id, base_dir)
    result.folder = folder
    if not folder or not folder.is_dir():
        msg = f"Output folder for v{video_id}_* not found in {base_dir}"
        errors.append(msg)
        checks.append(PreflightCheck(id="output_folder", name="Output Folder", passed=False, severity="fail", detail=msg))
    else:
        checks.append(PreflightCheck(id="output_folder", name="Output Folder", passed=True, severity="fail", detail=str(folder.name)))

    # 3. State Check in ko_jp_youtube_uploads
    try:
        active_upload = upload_store.get_active_upload(video_id)
        if active_upload and active_upload.get("stage") in ("scheduled", "published") and not force_new:
            msg = f"Video v{video_id} is already in '{active_upload['stage']}' stage (video_id={active_upload.get('youtube_video_id')}). Pass --force-new to upload again."
            errors.append(msg)
            checks.append(PreflightCheck(id="no_duplicate_upload", name="Duplicate Upload Check", passed=False, severity="fail", detail=msg))
        else:
            detail = f"Active upload stage: {active_upload['stage']}" if active_upload else "No prior active upload"
            checks.append(PreflightCheck(id="no_duplicate_upload", name="Duplicate Upload Check", passed=True, severity="fail", detail=detail))
    except Exception as err:
        msg = f"Database check for active uploads failed: {err}"
        errors.append(msg)
        checks.append(PreflightCheck(id="no_duplicate_upload", name="Duplicate Upload Check", passed=False, severity="fail", detail=msg))

    # If folder and record are present, collect metadata inputs and evaluate gate
    data_json = load_data_json(folder) if folder else {}
    inputs = collect_kit_inputs(record or {}, data_json, folder)

    # 4. Metadata Pre-Publish Gate Check
    reg_path = registry_path or DEFAULT_REGISTRY_PATH
    registry = ChannelRegistry.load(reg_path)
    gate_report = build_gate(inputs, registry, video_id, stored_title=record.get("title_jp") or "" if record else "")
    result.gate_report = gate_report

    if gate_report.status == "FAIL":
        fail_details = [c.detail or c.id for c in gate_report.checks if not c.passed and c.severity == "fail"]
        msg = f"Metadata gate status is FAIL ({'; '.join(fail_details)})"
        errors.append(msg)
        checks.append(PreflightCheck(id="metadata_gate", name="Metadata Pre-Publish Gate", passed=False, severity="fail", detail=msg))
    elif gate_report.status == "WARN":
        warn_details = [c.detail or c.id for c in gate_report.checks if not c.passed and c.severity == "warn"]
        if ack_warn:
            checks.append(PreflightCheck(id="metadata_gate", name="Metadata Pre-Publish Gate", passed=True, severity="warn", detail=f"WARN acknowledged ({'; '.join(warn_details)})"))
            warnings.append(f"Gate warnings acknowledged: {'; '.join(warn_details)}")
        else:
            msg = f"Metadata gate reported warnings: {'; '.join(warn_details)}. Must pass --ack-warn to proceed."
            errors.append(msg)
            checks.append(PreflightCheck(id="metadata_gate", name="Metadata Pre-Publish Gate", passed=False, severity="fail", detail=msg))
    else:
        checks.append(PreflightCheck(id="metadata_gate", name="Metadata Pre-Publish Gate", passed=True, severity="fail", detail="Gate status: PASS"))

    # 5. Audio Duration Probing
    audio_dur = inputs.get("duration")
    audio_path = None
    if folder:
        wav_files = list(folder.glob("*.wav"))
        if wav_files:
            audio_path = wav_files[0]
            result.audio_path = audio_path
            if audio_dur is None:
                audio_probe = probe_media(audio_path)
                audio_dur = audio_probe.get("duration")
    result.audio_duration = audio_dur

    # 6. Rendered MP4 Video Validation
    mp4_file = (folder / RENDER_SUBDIR / f"final_v{video_id}.mp4") if folder else None
    result.mp4_path = mp4_file

    if not mp4_file or not mp4_file.exists():
        expected = str(mp4_file) if mp4_file else f"render/final_v{video_id}.mp4"
        msg = f"Missing final rendered MP4 at '{expected}'. Please render video into render/ subfolder."
        errors.append(msg)
        checks.append(PreflightCheck(id="mp4_exists", name="Rendered MP4 File", passed=False, severity="fail", detail=msg))
    else:
        # Probe MP4
        mp4_probe = probe_media(mp4_file)
        mp4_dur = mp4_probe.get("duration")
        width = mp4_probe.get("width")
        height = mp4_probe.get("height")
        result.mp4_duration = mp4_dur

        if mp4_dur is None or width is None or height is None:
            msg = f"Unable to probe MP4 video properties via ffmpeg: {mp4_probe.get('raw_stderr', '')}"
            errors.append(msg)
            checks.append(PreflightCheck(id="mp4_specs", name="MP4 Video Specs", passed=False, severity="fail", detail=msg))
        else:
            # Check duration tolerance (within 2s)
            dur_ok = True
            dur_detail = f"duration={mp4_dur:.1f}s"
            if audio_dur is not None:
                diff = abs(mp4_dur - audio_dur)
                dur_detail += f" (audio={audio_dur:.1f}s, diff={diff:.1f}s)"
                if diff > MAX_DURATION_DIFF_SECONDS:
                    dur_ok = False
                    msg = f"MP4 duration ({mp4_dur:.1f}s) differs from audio duration ({audio_dur:.1f}s) by {diff:.1f}s (> {MAX_DURATION_DIFF_SECONDS}s)"
                    errors.append(msg)
                    checks.append(PreflightCheck(id="mp4_duration", name="MP4 Duration Sync", passed=False, severity="fail", detail=msg))

            if dur_ok:
                checks.append(PreflightCheck(id="mp4_duration", name="MP4 Duration Sync", passed=True, severity="fail", detail=dur_detail))

            # Check resolution (min 1280x720) and aspect ratio (16:9)
            res_ok = width >= MIN_VIDEO_WIDTH and height >= MIN_VIDEO_HEIGHT
            aspect = width / height if height > 0 else 0
            aspect_ok = abs(aspect - TARGET_ASPECT_RATIO) <= ASPECT_RATIO_TOLERANCE

            if not res_ok:
                msg = f"MP4 resolution {width}x{height} is below minimum {MIN_VIDEO_WIDTH}x{MIN_VIDEO_HEIGHT}"
                errors.append(msg)
            if not aspect_ok:
                msg = f"MP4 aspect ratio {aspect:.2f} is not 16:9 ({TARGET_ASPECT_RATIO:.2f})"
                errors.append(msg)

            mp4_spec_ok = res_ok and aspect_ok
            checks.append(
                PreflightCheck(
                    id="mp4_specs",
                    name="MP4 Resolution & Aspect",
                    passed=mp4_spec_ok,
                    severity="fail",
                    detail=f"{width}x{height} (aspect {aspect:.2f})",
                )
            )

        # Compute SHA256 of MP4
        try:
            result.sha256 = compute_file_sha256(mp4_file)
            checks.append(PreflightCheck(id="mp4_sha256", name="MP4 Checksum (SHA-256)", passed=True, severity="fail", detail=result.sha256[:16] + "…"))
        except Exception as err:
            msg = f"Failed to compute SHA-256 of MP4: {err}"
            errors.append(msg)
            checks.append(PreflightCheck(id="mp4_sha256", name="MP4 Checksum (SHA-256)", passed=False, severity="fail", detail=msg))

    # 7. Thumbnail Validation
    thumb_path = None
    if folder:
        # Search for thumb_*.jpg, thumb_*.png in folder or public/thumbnails/
        candidates = (
            list(folder.glob("thumb_*.jpg"))
            + list(folder.glob("thumb_*.jpeg"))
            + list(folder.glob("thumb_*.png"))
            + list(folder.glob("*.jpg"))
            + list(folder.glob("*.png"))
        )
        pub_thumb_jpg = REPO_ROOT / "web_ko_jp" / "public" / "thumbnails" / f"thumb_{video_id}.jpg"
        pub_thumb_png = REPO_ROOT / "web_ko_jp" / "public" / "thumbnails" / f"thumb_{video_id}.png"
        for pt in [pub_thumb_jpg, pub_thumb_png]:
            if pt.exists():
                candidates.insert(0, pt)
        valid_candidates = [c for c in candidates if "debug" not in c.name.lower()]
        # Prioritize files <= 2MB first
        compliant = [c for c in valid_candidates if c.stat().st_size <= MAX_THUMBNAIL_BYTES]
        if compliant:
            thumb_path = compliant[0]
        elif valid_candidates:
            thumb_path = valid_candidates[0]

    result.thumbnail_path = thumb_path
    if not thumb_path or not thumb_path.exists():
        msg = f"Thumbnail image file (PNG/JPG) missing in {folder or 'output directory'}"
        errors.append(msg)
        checks.append(PreflightCheck(id="thumbnail_exists", name="Thumbnail File", passed=False, severity="fail", detail=msg))
    else:
        # Check thumbnail size <= 2MB
        file_bytes = os.path.getsize(thumb_path)
        size_mb = file_bytes / (1024.0 * 1024.0)
        size_ok = file_bytes <= MAX_THUMBNAIL_BYTES
        if not size_ok:
            msg = f"Thumbnail file size {size_mb:.2f}MB exceeds YouTube's 2MB limit ({MAX_THUMBNAIL_BYTES} bytes)"
            errors.append(msg)
            checks.append(PreflightCheck(id="thumbnail_size", name="Thumbnail Size <= 2MB", passed=False, severity="fail", detail=msg))
        else:
            checks.append(PreflightCheck(id="thumbnail_size", name="Thumbnail Size <= 2MB", passed=True, severity="fail", detail=f"{size_mb:.2f}MB"))

        # Check thumbnail aspect ratio (16:9)
        t_probe = probe_media(thumb_path)
        tw = t_probe.get("width")
        th = t_probe.get("height")
        if tw and th:
            t_aspect = tw / th
            t_aspect_ok = abs(t_aspect - TARGET_ASPECT_RATIO) <= ASPECT_RATIO_TOLERANCE
            if not t_aspect_ok:
                msg = f"Thumbnail aspect ratio {t_aspect:.2f} ({tw}x{th}) is not 16:9"
                warnings.append(msg)
                checks.append(PreflightCheck(id="thumbnail_aspect", name="Thumbnail Aspect Ratio", passed=False, severity="warn", detail=msg))
            else:
                checks.append(PreflightCheck(id="thumbnail_aspect", name="Thumbnail Aspect Ratio", passed=True, severity="warn", detail=f"{tw}x{th} (16:9)"))

    # 8. SRT Subtitles Validation
    srt_path = None
    if folder:
        srt_files = list(folder.glob("sub_*.srt")) or list(folder.glob("*.srt"))
        if srt_files:
            srt_path = srt_files[0]
    result.srt_path = srt_path

    if not srt_path or not srt_path.exists():
        msg = f"Japanese subtitles (.srt) file missing in {folder or 'output directory'}"
        errors.append(msg)
        checks.append(PreflightCheck(id="srt_exists", name="Japanese SRT Subtitles", passed=False, severity="fail", detail=msg))
    else:
        checks.append(PreflightCheck(id="srt_exists", name="Japanese SRT Subtitles", passed=True, severity="fail", detail=srt_path.name))

    # 9. Build Metadata Snapshot
    result.metadata_snapshot = {
        "video_id": video_id,
        "title": inputs.get("title_a", ""),
        "title_b": inputs.get("title_b", ""),
        "title_c": inputs.get("title_c", ""),
        "description": inputs.get("description_jp", ""),
        "tags": [t.strip() for t in inputs.get("tags_flat", "").split(",") if t.strip()],
        "category_id": YOUTUBE_CATEGORY_ID,
        "language": VIDEO_LANGUAGE,
        "publication_timezone": PUBLISH_TIMEZONE,
        "expected_channel_id": YOUTUBE_CHANNEL_ID,
        "made_for_kids": MADE_FOR_KIDS,
        "contains_synthetic_media": CONTAINS_SYNTHETIC_MEDIA,
        "mp4_path": str(result.mp4_path) if result.mp4_path else None,
        "thumbnail_path": str(result.thumbnail_path) if result.thumbnail_path else None,
        "srt_path": str(result.srt_path) if result.srt_path else None,
        "sha256": result.sha256,
        "gate_status": gate_report.status if gate_report else "UNKNOWN",
        "ack_warn": ack_warn,
    }

    # Evaluate Overall Status
    result.checks = checks
    result.errors = errors
    result.warnings = warnings

    has_failures = any(not c.passed and c.severity == "fail" for c in checks)
    if has_failures:
        result.ok = False
        result.status = "FAIL"
    elif any(not c.passed and c.severity == "warn" for c in checks) and not ack_warn:
        result.ok = False
        result.status = "WARN_ACK_REQUIRED"
    else:
        result.ok = True
        result.status = "PASS"

    return result


def render_preflight_summary(result: PreflightResult) -> str:
    """Formats the preflight check results into a clean CLI table."""
    sep = "=" * 80
    lines = [sep, f"  UPLOAD PREFLIGHT REPORT — Video v{result.video_id}", sep]
    for c in result.checks:
        icon = "✅" if c.passed else ("❌" if c.severity == "fail" else "⚠")
        lines.append(f"  {icon} [{c.severity.upper():4}] {c.name:<25}: {c.detail}")
    lines.append(sep)
    lines.append(f"  VERDICT: {result.status} (ok={result.ok})")
    if result.errors:
        lines.append("\n  Blocking Errors:")
        for err in result.errors:
            lines.append(f"    ❌ {err}")
    if result.warnings:
        lines.append("\n  Warnings:")
        for w in result.warnings:
            lines.append(f"    ⚠ {w}")
    lines.append(sep)
    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser(description="Run upload preflight validation for web_ko_jp")
    parser.add_argument("--video_id", type=int, required=True, help="DB Video ID")
    parser.add_argument("--ack-warn", action="store_true", help="Acknowledge gate and spec warnings")
    parser.add_argument("--force-new", action="store_true", help="Allow upload even if already scheduled/published")
    parser.add_argument("--skip-gpm-check", action="store_true", help="Skip live GPM API check")
    parser.add_argument("--config", type=Path, default=DEFAULT_CONFIG_PATH, help="Path to upload_config.json")
    args = parser.parse_args()

    result = run_preflight(
        video_id=args.video_id,
        ack_warn=args.ack_warn,
        force_new=args.force_new,
        config_path=args.config,
        skip_gpm_check=args.skip_gpm_check,
    )
    print(render_preflight_summary(result))
    sys.exit(0 if result.ok else 1)


if __name__ == "__main__":
    main()

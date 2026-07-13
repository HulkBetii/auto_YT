from pathlib import Path

from auto_yt.paths import GPT_PROFILE_DIR, gpt_profile_dir


EXPECTED_GPT_PROFILE_DIR = Path(
    "D:/VibeCoding/auto_YT/data/chrome_user_data/" + "PROFILE_GPT_1"
)


def test_gpt_profile_dir_is_fixed() -> None:
    assert GPT_PROFILE_DIR == EXPECTED_GPT_PROFILE_DIR
    assert gpt_profile_dir() == EXPECTED_GPT_PROFILE_DIR


def test_playwright_calls_do_not_select_named_profiles() -> None:
    project_root = Path(__file__).resolve().parents[1]
    forbidden_call = "gpt_profile_dir(" + '"PROFILE_GPT_1")'
    profile_name_prefix = "PROFILE" + "_GPT_"

    for folder in ("src", "scripts", "tests"):
        for path in (project_root / folder).rglob("*"):
            if path.suffix not in {".py", ".ps1"}:
                continue
            content = path.read_text(encoding="utf-8")
            assert forbidden_call not in content
            if path not in {project_root / "src/auto_yt/paths.py", Path(__file__)}:
                assert profile_name_prefix not in content

            if "launch_persistent_context" in content:
                assert "gpt_profile_dir()" in content

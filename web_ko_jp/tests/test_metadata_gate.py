import json

import pytest

from build_metadata_kit import build_gate, build_kit_content, collect_kit_inputs
from channel_registry import ChannelRegistry
from conftest import FIXTURES_DIR
from metadata_gate import run_gate
from metadata_rules import clean_description


@pytest.fixture
def v5():
    return json.loads((FIXTURES_DIR / "v5_data.json").read_text(encoding="utf-8"))


def _ids(report, status):
    return {c.id for c in report.checks if not c.passed and c.severity == status}


def _gate(v5, **overrides):
    inputs = collect_kit_inputs({"audio_duration": None}, v5, None)
    inputs.update(overrides)
    return build_gate(inputs, ChannelRegistry(), video_id=5)


def test_v5_as_shipped_fails_on_leaked_headers(v5):
    """The kit that once said READY TO UPLOAD."""
    report = _gate(v5)
    assert report.status == "FAIL"
    assert "description_clean" in _ids(report, "fail")
    detail = next(c.detail for c in report.checks if c.id == "description_clean")
    assert "BLOCK" in detail and "Vietnamese" in detail


def test_v5_with_clean_description_only_warns(v5):
    report = _gate(v5, description_jp=clean_description(v5["description_jp"]))
    assert _ids(report, "fail") == set()
    warned = _ids(report, "warn")
    # Thumbnail 「身内でも／この8人は／距離を置け」 repeats 身内でも from the title.
    assert "thumbnail_repeats_title" in warned
    # No SRT folder and no sync record in this fixture.
    assert "captions_file" in warned
    assert report.status == "WARN"


def test_title_rules_apply_to_the_shipped_title(v5):
    report = _gate(v5, description_jp=clean_description(v5["description_jp"]),
                   title_a="【99％が知らない】" + v5["title_a_jp"])
    assert "title_validated" in _ids(report, "fail")


def test_count_mismatch_with_numbered_chapters(v5):
    report = _gate(v5, description_jp=clean_description(v5["description_jp"]),
                   title_a=v5["title_a_jp"].replace("8種類", "7種類"))
    failed = _ids(report, "fail")
    assert "title_number_matches_chapters" in failed
    assert "title_validated" in failed   # script has 八つ目, title promises 7


def test_duplicate_against_registry(v5):
    registry = ChannelRegistry()
    registry.record_kit(v5["title_a_jp"], [], db_video_id=99)
    inputs = collect_kit_inputs({}, {**v5, "description_jp": clean_description(v5["description_jp"])}, None)
    report = build_gate(inputs, registry, video_id=5)
    assert "title_not_duplicate" in _ids(report, "fail")


@pytest.mark.parametrize("lines, ok", [
    (["00:00 はじめに", "01:00 ① a", "02:00 まとめ"], True),
    (["00:05 はじめに", "01:00 ① a", "02:00 まとめ"], False),
    (["00:00 はじめに", "00:05 ① a", "02:00 まとめ"], False),
    (["00:00 はじめに", "02:00 まとめ"], False),
    (["00:00 — はじめに", "01:00 ① a", "02:00 まとめ"], False),  # em dash after timestamp hides chapters
    (["00:00 はじめに｜理由", "01:00 ① a", "02:00 まとめ｜心"], True),
])
def test_chapter_rules(lines, ok):
    report = run_gate(title="関わってはいけない人の特徴", description="#a #b #c 合成音声",
                      chapter_lines=lines, script_jp="")
    assert ("chapters_valid" not in _ids(report, "fail")) is ok


def test_interpolated_chapters_warn(v5):
    sync = [{"title": "まとめ", "seconds": 842.0, "source": "interpolated"}]
    report = _gate(v5, description_jp=clean_description(v5["description_jp"]), chapter_sync=sync)
    assert "chapters_interpolated" in _ids(report, "warn")


def test_kit_starts_with_gate_banner(v5):
    inputs = collect_kit_inputs({"source_url": "u"}, v5, None)
    gate = build_gate(inputs, ChannelRegistry(), video_id=5)
    kit = build_kit_content(5, {"source_url": "u"}, inputs, gate)
    assert kit.splitlines()[1].startswith("PRE-PUBLISH GATE: ❌ FAIL")
    assert "OVERALL: FAIL" in kit


@pytest.mark.parametrize("count, fail_id, warn_id", [(3, None, None), (10, None, "hashtags_3_to_5"), (61, "hashtags_ignored", "hashtags_3_to_5")])
def test_hashtag_rules(count, fail_id, warn_id):
    tags = " ".join(f"#t{i}" for i in range(count))
    report = run_gate(title="関わってはいけない人", description=f"合成音声\n{tags}",
                      chapter_lines=["00:00 a", "01:00 b", "02:00 c"], script_jp="")
    assert ("hashtags_ignored" in _ids(report, "fail")) is (fail_id is not None)
    assert ("hashtags_3_to_5" in _ids(report, "warn")) is (warn_id is not None)


def test_vietnamese_thumbnail_text_fails(v5):
    report = _gate(v5, description_jp=clean_description(v5["description_jp"]),
                   thumbnail_text="Tiêu đề A đã chốt: 関わってはいけない人\n(Trắng, cỡ lớn): 悪い人は")
    assert "thumbnail_clean" in _ids(report, "fail")

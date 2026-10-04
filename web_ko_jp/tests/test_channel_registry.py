from channel_registry import ChannelRegistry
from conftest import FIXTURES_DIR

SEVEN_WORDS_ID = "1B3UU9t7NU0"


def _registry(tmp_path):
    return ChannelRegistry.load(tmp_path / "registry.json")


def test_import_content_csv_reads_every_video(tmp_path):
    reg = _registry(tmp_path)
    assert reg.import_content_csv(FIXTURES_DIR / "studio_content") == 4
    seven = next(v for v in reg.videos if v.video_id == SEVEN_WORDS_ID)
    assert seven.impressions == 1205
    assert seven.ctr == 3.57
    assert "7つの言葉" in seven.title


def test_import_is_idempotent_and_persists(tmp_path):
    reg = _registry(tmp_path)
    reg.import_content_csv(FIXTURES_DIR / "studio_content")
    reg.import_content_csv(FIXTURES_DIR / "studio_content")
    reg.save()
    assert len(ChannelRegistry.load(tmp_path / "registry.json").videos) == 4


def test_import_suggested_csv_ranks_hosts(tmp_path):
    reg = _registry(tmp_path)
    assert reg.import_suggested_csv(FIXTURES_DIR / "studio_suggested", SEVEN_WORDS_ID) == 6
    top = reg.top_hosts()[0]
    assert top.video_id == "oEgjfubsgFI"
    assert top.impressions == 416
    assert top.for_video == SEVEN_WORDS_ID


def test_kit_rerun_is_not_its_own_duplicate(tmp_path):
    reg = _registry(tmp_path)
    reg.import_content_csv(FIXTURES_DIR / "studio_content")
    reg.record_kit("身内でもこの8種類の人間とは距離を置け", ["00:00 はじめに"], db_video_id=5, source_video_id="3Qw3ZquL1wk")
    reg.record_kit("身内でもこの8種類の人間とは距離を置け", ["00:00 はじめに"], db_video_id=5, source_video_id="3Qw3ZquL1wk")
    assert sum(1 for v in reg.videos if v.origin == "upload_kit") == 1
    assert "身内でもこの8種類の人間とは距離を置け" not in reg.titles_for_dedup(exclude_db_video_id=5)
    assert "身内でもこの8種類の人間とは距離を置け" in reg.titles_for_dedup(exclude_db_video_id=6)
    assert reg.cloned_source_ids() == {"3Qw3ZquL1wk"}


def test_published_video_rekit_is_not_its_own_duplicate(tmp_path):
    reg = _registry(tmp_path)
    reg.import_content_csv(FIXTURES_DIR / "studio_content")
    seven = next(v.title for v in reg.videos if v.video_id == SEVEN_WORDS_ID)
    assert seven in reg.titles_for_dedup(exclude_db_video_id=3)
    assert seven not in reg.titles_for_dedup(exclude_db_video_id=3, own_titles=[seven])

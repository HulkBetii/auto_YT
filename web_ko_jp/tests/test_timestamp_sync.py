import timestamp_sync
from timestamp_sync import sync_chapters_detailed, sync_chapters_with_srt

SRT = """1
00:00:00,000 --> 00:00:05,000
血がつながっているから何だ。

2
00:01:03,000 --> 00:01:08,000
一つ目。暴力を振るう人間だ。

3
00:02:45,000 --> 00:02:50,000
二つ目。金の無心を繰り返す人間だ。

4
00:05:00,000 --> 00:05:05,000
ここで少し休もう。

5
00:09:00,000 --> 00:09:05,000
最後に、自分の心を守れ。
"""

DESCRIPTION = """今回は距離を置くべき人について話します。

▼目次
00:00 はじめに｜我慢してはいけない理由
XX:XX ① 暴力や暴言で人を傷つける人間
XX:XX ② 金の無心を繰り返す人間
XX:XX ③ 他人の成功を妬む人間
XX:XX まとめ｜心を守るために

#人間関係 #人生哲学 #先人の知恵"""


def _srt(tmp_path):
    path = tmp_path / "sub.srt"
    path.write_text(SRT, encoding="utf-8")
    return path


def test_detailed_sync_marks_matched_and_interpolated(tmp_path):
    desc, chapters = sync_chapters_detailed(DESCRIPTION, _srt(tmp_path), audio_duration_sec=600)
    by_title = {c["title"]: c for c in chapters}
    assert chapters[0]["seconds"] == 0.0 and chapters[0]["source"] == "start"
    assert by_title["① 暴力や暴言で人を傷つける人間"]["seconds"] == 63.0
    assert by_title["② 金の無心を繰り返す人間"]["source"] == "matched"
    # No cue says 三つ目 -> proportional guess, which the gate must flag.
    assert by_title["③ 他人の成功を妬む人間"]["source"] == "interpolated"
    assert by_title["まとめ｜心を守るために"]["seconds"] == 540.0
    assert "XX:XX" not in desc
    assert "01:03 ① 暴力や暴言で人を傷つける人間" in desc
    assert desc.endswith("#人間関係 #人生哲学 #先人の知恵")


def test_legacy_wrapper_keeps_its_contract(tmp_path):
    desc, lines = sync_chapters_with_srt(DESCRIPTION, _srt(tmp_path), audio_duration_sec=600)
    assert lines[0] == "00:00 はじめに｜我慢してはいけない理由"
    assert len(lines) == 5


def test_no_script_specific_keywords_left():
    assert not hasattr(timestamp_sync, "INTRO_KEYWORDS")
    assert "ふざけるな" not in timestamp_sync.SUMMARY_KEYWORDS

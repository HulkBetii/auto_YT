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


def _srt_from(tmp_path, lines):
    """lines: [(seconds, text)] -> SRT file with 5s cues."""
    def ts(x):
        return f"00:{int(x // 60):02d}:{int(x % 60):02d},000"
    body = "\n".join(f"{i}\n{ts(s)} --> {ts(s + 5)}\n{t}\n" for i, (s, t) in enumerate(lines, 1))
    path = tmp_path / "sim.srt"
    path.write_text(body, encoding="utf-8")
    return path


V6_STYLE_DESC = """▼目次
00:00 はじめに｜味方の顔をした相手ほど見抜きにくい
XX ① 「正直に言うけど」で人を傷つける人
XX ② 「まだ気にしてるの？」で責任をすり替える人
XX まとめ｜優しくしても、人生まで差し出してはいけない

#人間関係"""


def test_v6_regression_quotes_ordinals_and_last_closer(tmp_path):
    srt = _srt_from(tmp_path, [
        (0, "人間はな、言葉で殺すんだ。"),
        (30, "あの人は何を言ってるの？"),            # hiragana fragment "るの" must not match ②
        (60, "「正直に言うけど」と前置きする奴だ。"),
        (200, "二つ目。"),
        (210, "「まだ気にしてるの？」と言う奴だ。"),
        (300, "最後には家の鍵まで欲しがる。"),        # mid-item "最後に" must not open the summary
        (500, "わしが最後に言いたいのは一つだけだ。"),
    ])
    _, chapters = sync_chapters_detailed(V6_STYLE_DESC, srt, audio_duration_sec=560)
    assert [(c["seconds"], c["source"]) for c in chapters] == [
        (0.0, "start"), (60.0, "matched"), (200.0, "matched"), (500.0, "matched"),
    ]


def test_closing_without_closer_phrase_is_interpolated(tmp_path):
    """v5: title nouns (人生) recur near the end; matching them faked a confident timestamp."""
    srt = _srt_from(tmp_path, [(60, "「正直に言うけど」"), (200, "二つ目。"), (500, "自分の人生を差し出すな。")])
    _, chapters = sync_chapters_detailed(V6_STYLE_DESC, srt, audio_duration_sec=560)
    assert chapters[-1]["source"] == "interpolated"


def test_recap_quotes_do_not_steal_chapters(tmp_path):
    """v7: the title quote 「正直だから」 only occurs verbatim in the 20:31 recap; the ordinal
    anchors and neighbour windows must keep ① near the start."""
    desc = """▼目次
00:00 はじめに｜本性
XX ① 「正直だから」と言って人を傷つける
XX ② 「あなたのため」と言って支配する
XX ③ 「運」で片づける人
XX まとめ｜自分を踏ませるな

#a"""
    srt = _srt_from(tmp_path, [
        (0, "笑顔で刺す人間がいる。"),
        (80, "「正直に言っただけ」と平気で人を傷つける。"),
        (260, "二つ目。「あなたのためを思って」"),
        (500, "三つ目。「運がいいよね」"),
        (900, "「俺は正直だから」「あなたのため」「運」"),     # recap
        (1400, "最後に、もう一度だけ言う。"),
    ])
    _, chapters = sync_chapters_detailed(desc, srt, audio_duration_sec=1500)
    assert [c["seconds"] for c in chapters] == [0.0, 80.0, 260.0, 500.0, 1400.0]

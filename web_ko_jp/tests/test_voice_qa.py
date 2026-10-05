from metadata_gate import run_gate
from voice_qa import compare_readings

# Readings are passed through unchanged so the test needs no pyopenjtalk (katakana in, katakana out).
IDENTITY = lambda text: "".join(ch for ch in text if "゠" <= ch <= "ヿ")  # noqa: E731

SCRIPT = "コレガゲンジツダ。\nマエハヤッテクレタ。\nツカエルアイダダケチカヅク。"


def test_perfect_read():
    segs = [{"start": 0, "end": 3, "text": "コレガゲンジツダ"}, {"start": 3, "end": 6, "text": "マエハヤッテクレタ"},
            {"start": 6, "end": 9, "text": "ツカエルアイダダケチカヅク"}]
    report = compare_readings(SCRIPT, segs, IDENTITY)
    assert report["reading_match"] == 1.0 and report["onset_match"] == 1.0 and report["flagged"] == []


def test_v8_failure_modes_are_flagged():
    """v8: onset swallowed (これが現実だ -> 現実だ), sentence missing, つかえる -> かえる."""
    segs = [{"start": 0, "end": 2, "text": "ゲンジツダ"}, {"start": 5, "end": 9, "text": "カエルアイダダケチカヅク"}]
    report = compare_readings(SCRIPT, segs, IDENTITY)
    assert report["onset_match"] < 0.5
    flagged = [f["sentence"] for f in report["flagged"]]
    assert "マエハヤッテクレタ。" in flagged
    assert report["reading_match"] < 0.8


def _gate(voice_qa):
    return run_gate(title="関わってはいけない人の口癖7選", description="#a #b #c 合成音声",
                    chapter_lines=["00:00 a", "01:00 b", "02:00 c"], script_jp="",
                    thumbnail_text="善人の仮面\n本性が出る\n縁を切れ", voice_qa=voice_qa)


def _ids(report, severity):
    return {c.id for c in report.checks if not c.passed and c.severity == severity}


def test_gate_fails_on_poor_read_and_lists_times():
    report = _gate({"reading_match": 0.76, "onset_match": 0.6,
                    "flagged": [{"time": 939.0, "sentence": "秘密を守れない", "match": 0.5}]})
    assert "voice_read_quality" in _ids(report, "fail")
    detail = next(c.detail for c in report.checks if c.id == "voice_flagged_sentences")
    assert "15:39" in detail


def test_gate_passes_good_read_and_warns_when_missing():
    good = _gate({"reading_match": 0.93, "onset_match": 0.9, "flagged": []})
    assert "voice_read_quality" not in _ids(good, "fail")
    assert "voice_read_quality" in _ids(_gate(None), "warn")


def test_tts_text_joins_one_sentence_lines():
    """GPT-SoVITS splits on newlines; v8's one-sentence lines lost their onsets."""
    from tts_gpt_sovits import TTS_SPLIT_METHOD, prepare_tts_text

    script = "最初は困っている。\n\nだから助ける。\n金を貸す\n「冷たいね」\n「昔はそんな人じゃなかった」\n"
    assert prepare_tts_text(script) == "最初は困っている。だから助ける。金を貸す。「冷たいね」「昔はそんな人じゃなかった」"
    assert "\n" not in prepare_tts_text(script)
    assert TTS_SPLIT_METHOD != "cut_drama_cadence"

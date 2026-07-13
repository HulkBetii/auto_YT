import pytest

from auto_yt.render.subtitles import (
    Card,
    align_tts_text_to_words,
    build_aligned_cards,
    build_cards_for_segment,
    build_srt_from_cards,
    clean_tts_display_text,
    parse_ass_cards,
)


def test_rebalances_short_trailing_card_within_same_sentence() -> None:
    text = "もし、今日の話が少しでも心に残ったなら、コメントにこう書いてください。"

    cards = build_cards_for_segment(394.08, 400.08, text)

    assert cards[-2].lines[-1] == "に残ったなら、コメントに"
    assert cards[-1].lines == ["こう書いてください。"]
    assert "".join(line for card in cards for line in card.lines) == text


def test_rebalances_short_trailing_line_within_same_card() -> None:
    text = "コメントにこう書いてください。"

    cards = build_cards_for_segment(398.14, 400.08, text)

    assert len(cards) == 1
    assert cards[0].lines == ["コメントにこう書", "いてください。"]


def test_keeps_short_trailing_sentence_separate() -> None:
    text = "これは十分に長い前の文章として表示される内容です。ありがとう。"

    cards = build_cards_for_segment(0.0, 10.0, text)

    assert cards[-2].lines[-1] == "して表示される内容です。"
    assert cards[-1].lines == ["ありがとう。"]


def test_aligned_cards_keep_tts_source_text_and_remove_pause_tags() -> None:
    tts_text = "今日は、<#1.2#>晴れです。"
    words = [
        {"word": "今日は", "start": 0.0, "end": 0.8},
        {"word": "晴れです", "start": 1.8, "end": 2.8},
    ]

    cards, coverage = build_aligned_cards(tts_text, words, max_chars=4)

    displayed = "".join(line for card in cards for line in card.lines)
    assert displayed == clean_tts_display_text(tts_text)
    assert "<#" not in displayed
    assert coverage == 1.0
    assert cards[0].start == 0.0
    assert cards[-1].end >= 2.8


def test_alignment_interpolates_a_missed_japanese_character() -> None:
    timed, coverage = align_tts_text_to_words(
        "今日は晴れです。",
        [{"word": "今日は晴です", "start": 0.0, "end": 2.0}],
    )

    assert "".join(item.char for item in timed) == "今日は晴れです。"
    assert coverage >= 0.7
    assert all(current.start <= following.start for current, following in zip(timed, timed[1:]))


def test_alignment_rejects_low_coverage() -> None:
    with pytest.raises(ValueError, match="coverage"):
        align_tts_text_to_words(
            "今日は晴れです。",
            [{"word": "猫", "start": 0.0, "end": 1.0}],
        )


def test_alignment_rejects_empty_whisper_words() -> None:
    with pytest.raises(ValueError, match="no usable word timestamps"):
        align_tts_text_to_words("今日は晴れです。", [])


def test_srt_uses_card_text_and_millisecond_timestamps() -> None:
    cards = [
        Card(start=0.0, end=1.234, lines=["今日は、", "晴れです。"]),
        Card(start=2.5, end=4.0, lines=["ありがとう。"]),
    ]

    srt = build_srt_from_cards(cards)

    assert "00:00:00,000 --> 00:00:01,230" in srt
    assert "今日は、\n晴れです。" in srt
    assert "00:00:02,500 --> 00:00:04,000" in srt
    assert "<#" not in srt


def test_ass_cards_round_trip_for_srt_backfill(tmp_path) -> None:
    ass_path = tmp_path / "sub.ass"
    ass_path.write_text(
        "\n".join(
            [
                "[Events]",
                "Dialogue: 0,0:00:01.20,0:00:03.40,Quote,,0,0,0,,"
                r"{\an4\pos(80,515)}一行目です。\N二行目です。",
            ]
        ),
        encoding="utf-8",
    )

    cards = parse_ass_cards(ass_path)

    assert len(cards) == 1
    assert cards[0].start == 1.2
    assert cards[0].end == 3.4
    assert cards[0].lines == ["一行目です。", "二行目です。"]

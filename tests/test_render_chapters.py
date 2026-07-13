from auto_yt.render.chapters import (
    MIN_CHAPTER_GAP_SECONDS,
    format_chapter_lines,
    parse_chapter_specs,
    replace_description_chapters,
    resolve_chapters,
)
from auto_yt.render.subtitles import Card


def test_parses_new_anchor_format_and_hides_anchor_from_title() -> None:
    specs = parse_chapter_specs(
        """■ チャプター設計（00:00形式）
00:00　導入　｜　ANCHOR: 最初の言葉を始めます
01:10　心を整える　| ANCHOR=心を静かに整えます
02:20　まとめ
"""
    )

    assert [spec.title for spec in specs] == ["導入", "心を整える", "まとめ"]
    assert specs[0].anchor == "最初の言葉を始めます"
    assert specs[1].anchor == "心を静かに整えます"
    assert specs[2].anchor is None


def test_exact_anchor_uses_order_and_nearest_expected_occurrence() -> None:
    specs = parse_chapter_specs(
        """■ チャプター設計
00:00 導入 | ANCHOR: 導入を始めます
01:00 第二章 | ANCHOR: 同じ合図です
02:00 結び | ANCHOR: 最後の結論です
"""
    )
    cards = [
        Card(0.0, 12.0, ["導入を始めます。"]),
        Card(20.0, 32.0, ["同じ合図です。"]),
        Card(70.0, 82.0, ["同じ合図です。"]),
        Card(120.0, 132.0, ["最後の結論です。"]),
        Card(140.0, 150.0, ["締めくくります。"]),
    ]

    resolved = resolve_chapters(specs, cards)

    assert [chapter.seconds for chapter in resolved] == [0.0, 70.0, 120.0]
    assert resolved[1].method == "anchor"
    assert resolved[1].confidence == 1.0


def test_legacy_chapters_are_monotonic_and_inside_duration() -> None:
    specs = parse_chapter_specs(
        """■ チャプター設計
00:00 静かな導入
02:00 心が疲れる理由
04:00 境界線を作る
06:00 最後の約束
"""
    )
    cards = [
        Card(0.0, 12.0, ["静かな導入です。"]),
        Card(40.0, 55.0, ["心が疲れる理由を話します。"]),
        Card(85.0, 100.0, ["境界線を作る方法です。"]),
        Card(125.0, 140.0, ["最後の約束を伝えます。"]),
        Card(150.0, 160.0, ["終わりです。"]),
    ]

    resolved = resolve_chapters(specs, cards)

    assert resolved[0].seconds == 0.0
    assert all(
        following.seconds - current.seconds >= MIN_CHAPTER_GAP_SECONDS
        for current, following in zip(resolved, resolved[1:])
    )
    assert resolved[-1].seconds <= 150.0
    assert format_chapter_lines(resolved).startswith("00:00 静かな導入")


def test_short_video_can_keep_three_chapters_with_ten_second_gaps() -> None:
    specs = parse_chapter_specs(
        """■ チャプター設計
00:00 導入
00:10 本編
00:20 結び
"""
    )
    cards = [
        Card(0.0, 5.0, ["導入"]),
        Card(10.0, 15.0, ["本編"]),
        Card(20.0, 25.0, ["結び"]),
    ]

    resolved = resolve_chapters(specs, cards)

    assert [chapter.seconds for chapter in resolved] == [0.0, 10.0, 20.0]


def test_duration_override_keeps_chapters_inside_rendered_video() -> None:
    specs = parse_chapter_specs(
        """■ チャプター設計
00:00 導入
00:10 本編
00:20 結び
"""
    )
    cards = [
        Card(0.0, 5.0, ["導入"]),
        Card(10.0, 15.0, ["本編"]),
        Card(20.0, 25.0, ["結び"]),
        Card(26.0, 30.0, ["音声だけ長い末尾"]),
    ]

    resolved = resolve_chapters(specs, cards, duration_seconds=21.0)

    assert resolved[-1].seconds <= 21.0


def test_description_replacement_preserves_other_sections() -> None:
    specs = parse_chapter_specs(
        """■ チャプター設計
00:00 導入
01:00 本編
02:00 結び
"""
    )
    cards = [
        Card(0.0, 20.0, ["導入"]),
        Card(40.0, 60.0, ["本編"]),
        Card(80.0, 100.0, ["結び"]),
        Card(110.0, 120.0, ["終了"]),
    ]
    resolved = resolve_chapters(specs, cards)
    description = """冒頭

━━━━━━━━━━━━━━━━━━━━━━━━
⏱ チャプター
━━━━━━━━━━━━━━━━━━━━━━━━
00:00 古い導入
09:00 古い本編
18:00 古い結び

━━━━━━━━━━━━━━━━━━━━━━━━
🎬 おすすめの動画
━━━━━━━━━━━━━━━━━━━━━━━━
末尾
"""

    updated = replace_description_chapters(description, resolved)

    assert updated is not None
    assert "09:00 古い本編" not in updated
    assert "🎬 おすすめの動画" in updated
    assert updated.startswith("冒頭")
    assert updated.endswith("末尾\n")

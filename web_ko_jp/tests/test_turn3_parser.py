import pytest

from chatgpt_drama_pipeline import parse_turn3_result
from metadata_rules import clean_description, has_vietnamese

TURN3_BODY = """{h1}
「身内だから」と我慢するほど、残りの人生は削られていきます。
今回は、距離を置くべき8種類の人についてお話しします。

{h2}
こんな方におすすめです。
・親戚付き合いに疲れている方

{h4}
▼目次
00:00 はじめに｜我慢してはいけない理由
XX:XX ① 暴言で人を傷つける人間
XX:XX まとめ｜心を守るために

{h6}
※本動画では合成音声を使用しています。
#人間関係 #人生哲学 #先人の知恵

{h7}
TIER1_CORE: 処世術, 人生哲学
TIER2_TOPIC: 関わってはいけない人, 縁を切るべき人

{h8}
📌 距離を置くべき8種類の人について話しました。
"""


@pytest.mark.parametrize("decorate", [
    lambda s: s,
    lambda s: f"**{s}**",
    lambda s: f"### {s}",
    lambda s: f"- {s}",
])
def test_headers_with_markdown_never_leak(decorate):
    raw = TURN3_BODY.format(
        h1=decorate("【BLOCK 1 — HOOK】"),
        h2=decorate("【BLOCK 2 — KÊNH NÀY DÀNH CHO AI】"),
        h4=decorate("【BLOCK 4 — MỤC LỤC TIMESTAMPS】"),
        h6=decorate("【BLOCK 6 — DISCLAIMER + HASHTAGS】"),
        h7=decorate("【BLOCK 7 — TAGS 4 TẦNG】"),
        h8=decorate("【BLOCK 8 — PINNED COMMENT】"),
    )
    result = parse_turn3_result(raw)
    desc = result["description_jp"]
    assert "BLOCK" not in desc
    assert not has_vietnamese(desc)
    assert desc.startswith("「身内だから」")
    assert "#人間関係 #人生哲学 #先人の知恵" in desc
    assert result["tags_tiered"]["tier1"] == ["処世術", "人生哲学"]
    assert result["chapters_raw"][0].startswith("00:00")
    assert result["pinned_comment"].startswith("📌")


def test_no_block_fallback_is_still_cleaned():
    raw = "━━━ PHẦN 1: MÔ TẢ VIDEO ━━━\n本文です。\n#人間関係"
    assert parse_turn3_result(raw)["description_jp"] == "本文です。\n#人間関係"


def test_clean_description_keeps_japanese_lines():
    text = "【BLOCK 1 — HOOK】\n本文\n\n\n\nLiệt kê 4-5 dòng\n・項目"
    assert clean_description(text) == "本文\n\n・項目"


# Regression from the v6 end-to-end run (2026-10-04): ChatGPT wrote "XX ①" instead of "XX:XX ①".
V6_TOC = """▼目次
00:00 はじめに｜味方の顔をした相手ほど見抜きにくい
XX ① 「正直に言うけど」で人を傷つける人
XX ② 「あなたのため」で人生を支配する人
XX まとめ｜優しくしても、人生まで差し出してはいけない

▼このチャンネルについて"""


def test_bare_xx_placeholder_chapters_are_kept():
    from timestamp_sync import extract_raw_chapter_lines
    from metadata_rules import PLACEHOLDER_TIMESTAMP_RE

    assert len(extract_raw_chapter_lines(V6_TOC)) == 4
    assert PLACEHOLDER_TIMESTAMP_RE.search(V6_TOC)
    raw = "【BLOCK 4 — MỤC LỤC】\n" + V6_TOC.split("\n\n")[0]
    assert len(parse_turn3_result(raw)["chapters_raw"]) == 4


def test_thumbnail_parser_ignores_echoed_vietnamese_rules():
    from chatgpt_drama_pipeline import parse_thumbnail_response

    raw = (
        "Tiêu đề A đã chốt: 関わってはいけない人が必ず口にする危険な言葉7選\n"
        "DÒNG 1 (Trắng, cỡ lớn): Mô tả chủ thể — Ví dụ: 悪い人は / 本性は\n"
        "Dòng 1: その口癖\nDòng 2: 本性が出る\nDòng 3: 近づくな"
    )
    chosen, _ = parse_thumbnail_response(raw)
    assert chosen == "その口癖\n本性が出る\n近づくな"

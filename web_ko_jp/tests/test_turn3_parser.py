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

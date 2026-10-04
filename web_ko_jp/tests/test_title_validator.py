import pytest

from title_validator import reorder_variants, retry_feedback, validate_title, validate_variants

ORDINALS = ["一つ目", "二つ目", "三つ目", "四つ目", "五つ目", "六つ目", "七つ目", "八つ目"]


def script_with(n: int) -> str:
    return "\n".join(f"{o}。こういう人間には近づくな。" for o in ORDINALS[:n])


V5_TITLE = "身内でもこの8種類の人間とは絶対に深く付き合うな｜情に流されれば人生を食い潰される"


def test_v5_title_passes_with_matching_script():
    check = validate_title(V5_TITLE, script_jp=script_with(8))
    assert check.passed, check.reasons
    assert check.anchor == "身内"


def test_count_must_match_script_items():
    check = validate_title(V5_TITLE, script_jp=script_with(7))
    assert not check.passed
    assert any("script has 7" in r for r in check.reasons)


@pytest.mark.parametrize("title, passes", [
    # The two packaging patterns of the published channel, judged by today's rules.
    ("【99％が知らない】顔に出る悪人の特徴5選｜近づいた瞬間、人生が壊れる", False),
    ("性根が腐った人間は必ず口にする「7つの言葉」｜こんな奴とは今すぐ縁を切れ", True),
    ("知らずに生きると必ず後悔する「人生の10の鉄則」｜先人が血と涙で残した", False),
])
def test_published_patterns(title, passes):
    script = "\n".join(f"{o}。" for o in ["一つ目", "二つ目", "三つ目", "四つ目", "五つ目", "六つ目", "七つ目"])
    assert validate_title(title, script_jp=script).passed is passes


def test_classic_citation_needs_source_evidence():
    title = "論語が教える関わってはいけない人の特徴"
    assert not validate_title(title, script_jp="", transcript="Cổ nhân dạy rằng...").passed
    assert validate_title(title, script_jp="", transcript="Trong Luận Ngữ, Khổng Tử nói...").passed


def test_near_duplicate_of_registry_is_rejected():
    earlier = "身内でもこの8種類の人間とは絶対に付き合うな｜情に流されれば人生を食い潰される"
    check = validate_title(V5_TITLE, script_jp=script_with(8), registry_titles=[earlier])
    assert not check.passed
    assert "near-duplicate" in check.reasons[0]


def test_anchor_must_be_early():
    title = "長く生きてきた私が、どうしても今のうちに皆さんへ伝えておきたい関わってはいけない人の特徴"
    check = validate_title(title, script_jp="")
    assert not check.passed
    assert "must be within" in check.reasons[0]


def test_reorder_puts_best_passing_title_first():
    variants = {
        "A": "【99％が知らない】身内の悪口を言う人",
        "B": "60代から縁を切るべき人の特徴｜老後を守る先人の知恵",
        "C": "",
    }
    validation = validate_variants(variants, script_jp="")
    assert validation.status == "validated"
    reordered = reorder_variants(variants, validation)
    assert reordered["A"] == variants["B"]
    assert reordered["B"] == variants["A"]
    assert "banned phrase" in retry_feedback(validation)


def test_all_failing_variants_report_failed():
    validation = validate_variants({"A": "人生の鉄則10選", "B": "愚かな行動10選"}, script_jp="")
    assert validation.status == "failed"
    assert validation.best() is None

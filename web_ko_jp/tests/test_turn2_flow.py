import asyncio

import chatgpt_drama_pipeline as pipeline
from channel_registry import ChannelRegistry

SCRIPT = "一つ目。二つ目。三つ目。"
BAD = "A: 【99％が知らない】人生の鉄則3選\nB: 愚かな行動3選\nC: 人生で損する3つの習慣"
GOOD = "A: 人生の鉄則3選\nB: 関わってはいけない人の特徴3選｜先人の知恵\nC: 老後に縁を切るべき人3つのタイプ"


def _run(monkeypatch, tmp_path, responses):
    sent = []

    async def fake_send(page, message, timeout_seconds=0):
        sent.append(message)
        return responses[len(sent) - 1]

    async def no_sleep(_):
        return None

    monkeypatch.setattr(pipeline, "send_chatgpt_message", fake_send)
    monkeypatch.setattr(pipeline.asyncio, "sleep", no_sleep)
    monkeypatch.setattr(pipeline.ChannelRegistry, "load", classmethod(lambda cls, path=None: ChannelRegistry()))
    parsed, validation = asyncio.run(pipeline.generate_validated_titles(None, SCRIPT, "transcript"))
    return parsed, validation, sent


def test_retry_once_and_promote_passing_title(monkeypatch, tmp_path):
    parsed, validation, sent = _run(monkeypatch, tmp_path, [BAD, GOOD])
    assert len(sent) == 2
    assert "banned phrase" in sent[1] and "(3 mục)" in sent[1]
    assert validation.status == "validated" and validation.retried
    assert parsed["title_a"] == "関わってはいけない人の特徴3選｜先人の知恵"
    assert parsed["title_primary"] == parsed["title_a"]


def test_no_retry_when_first_draft_passes(monkeypatch, tmp_path):
    parsed, validation, sent = _run(monkeypatch, tmp_path, [GOOD])
    assert len(sent) == 1
    assert not validation.retried


def test_failed_retry_keeps_original_drafts(monkeypatch, tmp_path):
    parsed, validation, sent = _run(monkeypatch, tmp_path, [BAD, BAD.replace("3選", "4選")])
    assert validation.status == "failed" and validation.retried
    assert parsed["title_a"] == "【99％が知らない】人生の鉄則3選"


def test_prompt_placeholders_are_resolved():
    for prompt in (pipeline.PROMPT_TURN2_TEMPLATE, pipeline.PROMPT_TURN3_TEMPLATE):
        assert "[[" not in prompt
    assert "TIER1_CORE: 処世術" in pipeline.PROMPT_TURN3_TEMPLATE
    assert "関わってはいけない人" in pipeline.PROMPT_TURN2_TEMPLATE


def test_turn1_requires_spoken_ordinals():
    """Chapter timestamps anchor on 一つ目/二つ目; v6/v7 scripts opened items with まず/次は instead."""
    assert "一つ目。二つ目。三つ目。" in pipeline.PROMPT_TURN1_TEMPLATE
    pipeline.PROMPT_TURN1_TEMPLATE.format(title="t", url="u", transcript="x")  # still a valid template

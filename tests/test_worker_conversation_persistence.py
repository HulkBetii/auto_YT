from auto_yt.worker import _ah_conversation_key, _is_chatgpt_conversation_url


def test_ah_conversation_key_is_scoped_by_video_id():
    assert _ah_conversation_key(14) == "ah_conversation_url:14"


def test_chatgpt_conversation_url_validation_accepts_conversation_links_only():
    assert _is_chatgpt_conversation_url("https://chatgpt.com/c/abc123")
    assert not _is_chatgpt_conversation_url("https://chatgpt.com/")
    assert not _is_chatgpt_conversation_url("https://example.com/c/abc123")

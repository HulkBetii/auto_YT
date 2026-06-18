from auto_yt.services.chat_gpt import (
    DEFAULT_MIN_RESPONSE_CHARS,
    SCRIPT_MIN_CHARS,
    _expected_min_response_chars,
    _stability_key,
)


def test_expected_min_chars_detects_long_script_prompt_with_comma_range():
    prompt = "Length: 1,500-2,400 words (approximately 8-13 minutes narration)"

    assert _expected_min_response_chars(prompt) == SCRIPT_MIN_CHARS


def test_expected_min_chars_detects_long_script_prompt_with_en_dash_range():
    prompt = "Length: 1,500–2,400 words"

    assert _expected_min_response_chars(prompt) == SCRIPT_MIN_CHARS


def test_expected_min_chars_keeps_short_prompts_lightweight():
    prompt = "Return ONLY valid JSON."

    assert _expected_min_response_chars(prompt) == DEFAULT_MIN_RESPONSE_CHARS


def test_stability_key_ignores_chatgpt_thinking_timer():
    assert _stability_key("Thought for 41s\nAnswer") == _stability_key("Thought for 42s\nAnswer")

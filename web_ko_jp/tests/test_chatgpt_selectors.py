"""Static guards for the ChatGPT DOM contract (2026-10 app-shell UI). Live check: see the
verify_selectors scratch script used on conversation 6ac27bba (v7)."""
import chatgpt_drama_pipeline as pipeline


def test_composer_selector_is_scoped_to_the_composer():
    # A bare ProseMirror/contenteditable selector also matches ChatGPT's editable writing blocks.
    parts = [p.strip() for p in pipeline.PROMPT_INPUT_SELECTOR.split(",")]
    assert "div.ProseMirror" not in parts
    assert 'div[contenteditable="true"][role="textbox"]' not in parts
    assert parts[0].startswith("[data-chatgpt-composer]")


def test_reader_knows_the_app_shell_markers():
    assert "data-chatgpt-selection-message-id" in pipeline.GET_LATEST_ASSISTANT_TEXT_SCRIPT
    assert "data-chatgpt-selection-message-id" in pipeline.ASSISTANT_SELECTOR

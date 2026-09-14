import asyncio

from auto_yt import worker


def test_process_job_heartbeats_while_waiting_for_chatgpt(monkeypatch) -> None:
    heartbeat_calls: list[tuple[str, str]] = []
    complete_calls: list[tuple[str, int, str]] = []
    chain_calls: list[tuple[str, str]] = []

    async def fake_record_heartbeat(dsn: str, status: str) -> None:
        heartbeat_calls.append((dsn, status))

    async def fake_send_prompt(prompt_text: str, page, *, timeout_s: int) -> str:
        await asyncio.sleep(0.12)
        return "assistant response"

    async def fake_complete_job(dsn: str, job_id: int, *, result: str) -> None:
        complete_calls.append((dsn, job_id, result))

    async def fake_trigger_chain_cycle(web_url: str, dashboard_secret: str) -> None:
        chain_calls.append((web_url, dashboard_secret))

    async def scenario() -> None:
        monkeypatch.setattr(worker, "POLL_INTERVAL_S", 0.03)
        monkeypatch.setattr(worker, "record_heartbeat", fake_record_heartbeat)
        monkeypatch.setattr(worker, "send_prompt", fake_send_prompt)
        monkeypatch.setattr(worker, "complete_job", fake_complete_job)
        monkeypatch.setattr(worker, "trigger_chain_cycle", fake_trigger_chain_cycle)

        await worker.process_job(
            object(),
            "postgres://local",
            {"id": 123, "stage": "P3", "prompt_text": "prompt", "retry_count": 0},
            web_url="http://localhost:3000",
            dashboard_secret="",
        )

    asyncio.run(scenario())

    assert len(heartbeat_calls) >= 2
    assert all(call == ("postgres://local", "running") for call in heartbeat_calls)
    assert complete_calls == [("postgres://local", 123, "assistant response")]
    assert chain_calls == [("http://localhost:3000", "")]

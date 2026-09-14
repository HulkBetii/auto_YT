import os
import subprocess
import sys

import pytest


@pytest.mark.skipif(
    os.getenv("KO_RUN_PLAYWRIGHT_SMOKE") != "1",
    reason="Set KO_RUN_PLAYWRIGHT_SMOKE=1 to run against the fixed signed-in profile.",
)
def test_exact_model_smoke_is_operator_opt_in() -> None:
    subprocess.run(
        [sys.executable, "-m", "auto_yt.ko_model_smoke"],
        check=True,
        timeout=180,
    )

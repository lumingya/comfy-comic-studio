"""A real process exit after file fsync must leave a locally recoverable result."""

import subprocess
import sys
from pathlib import Path
from unittest import mock

from mio_server.pipeline import cloud_jobs

from .test_result_delivery import DeliveryCase

CHILD = r"""
import os
import sys
from pathlib import Path

sys.path.insert(0, sys.argv[1])
from mio_server.context import AppContext
from mio_server.jobs import Candidate
from mio_server.pipeline import cloud_jobs
from tests.test_compile_executor import FakeClient
from tests.test_render_qa import FakeCloudRenderer, FakeVLM

root = Path(sys.argv[2])
ctx = AppContext.create(root, autostart=False, seed_instance=False,
    comfy_client_factory=FakeClient, llm_factory=FakeVLM)

class CountedCloud(FakeCloudRenderer):
    def panel(self, *args, **kwargs):
        with (root / "upstream-calls.txt").open("ab") as output:
            output.write(b"one simulated paid request\n")
            output.flush()
            os.fsync(output.fileno())
        return super().panel(*args, **kwargs)

cloud_jobs.CloudRenderer = CountedCloud
profile = ctx.render.profile(None).model_copy(update={
    "id": "real-process-exit", "cloud_shape": True, "cloud_refine": False})
ctx.store.put_doc(profile)
job = ctx.render.render(sys.argv[3], profile_id=profile.id, candidates=1)
item = ctx.engine._claim(Candidate(job["id"], 0, "local"), None)
replace = os.replace

def exit_before_rename(source, target):
    if Path(source).name.endswith(".publishing"):
        os._exit(91)
    return replace(source, target)

os.replace = exit_before_rename
ctx.engine.executors["cloud.render"].execute(item)
raise AssertionError("expected process exit before result rename")
"""


class RealProcessPublicationTests(DeliveryCase):
    def test_complete_staging_survives_actual_process_exit_without_a_second_request(self):
        self.ctx.close()
        self.ctx = None
        child = subprocess.run(
            [
                sys.executable,
                "-X",
                "utf8",
                "-c",
                CHILD,
                str(Path(__file__).parents[1]),
                str(self.root),
                self.episode.id,
            ],
            capture_output=True,
            text=True,
            encoding="utf-8",
            timeout=30,
        )
        self.assertEqual(child.returncode, 91, child.stderr)
        self.assertTrue(list((self.root / "assets").rglob("*.publishing")))
        with mock.patch.object(
            cloud_jobs, "CloudRenderer", side_effect=AssertionError("resubmitted")
        ):
            self.open()
            self.reopen()
        jobs = self.ctx.engine.list()
        self.assertEqual(len(jobs), 1)
        self.assertEqual(jobs[0]["state"], "completed")
        saved = self.ctx.store.get_episode(self.episode.id)
        self.assertEqual(len(saved.takes), 1)
        self.assertTrue(self.ctx.assets.read(saved.takes[0].asset_id).startswith(b"\x89PNG"))
        self.assertEqual(
            (self.root / "upstream-calls.txt").read_bytes().splitlines(),
            [b"one simulated paid request"],
        )
        self.assertFalse(list((self.root / "assets").rglob("*.publishing")))

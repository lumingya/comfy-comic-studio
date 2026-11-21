"""Small, entirely local long-form documents; no rendered assets or remote requests."""

import tempfile
import unittest
from pathlib import Path

from mio_server.context import AppContext
from mio_server.longform.models import PanelTransfer
from mio_server.models import (
    ControlInput,
    Dialogue,
    Episode,
    LetteringLayer,
    Panel,
    Series,
    Strip,
    Take,
)


class LongformFixture(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.ctx = AppContext.create(Path(tmp.name), autostart=False, seed_instance=False)
        self.addCleanup(self.ctx.close)
        # TestClient starts the app lifespan. Keep update checks out of the
        # fixture so their background writes cannot race temporary cleanup.
        self.ctx.updater.preferences(False)
        self.store = self.ctx.store
        self.series = self.store.create_series(
            Series(title="Long story", variables={"hero": "Alice"})
        )
        self.source = self.store.create_episode(
            Episode(
                id="source",
                series_id=self.series.id,
                title="One",
                order=0,
                panels=[
                    Panel(id="a", order=0, dialogues=[Dialogue(text="{hero}", bridge=True)]),
                    Panel(id="b", order=1, controls=[ControlInput(source="take", take_id="ta")]),
                    Panel(id="c", order=2),
                ],
                takes=[
                    Take(
                        id="ta",
                        panel_id="a",
                        asset_id="art-a",
                        status="adopted",
                        job_id="job-origin",
                    ),
                    Take(id="tb", panel_id="b", asset_id="art-b", parent_take_id="ta"),
                    Take(id="tc", panel_id="c", asset_id="art-c"),
                ],
                strip=Strip(
                    width=800,
                    manual=True,
                    height=1000,
                    panel_boxes={
                        "a": (24, 30, 300, 230),
                        "b": (24, 300, 300, 500),
                        "c": (24, 600, 300, 800),
                    },
                    crops={"a": (0.1, 0.2, 0.9, 0.8)},
                    lettering=[
                        LetteringLayer(
                            id="la",
                            panel_id="a",
                            bridge_to="b",
                            text="Together",
                            box=(30, 200, 120, 320),
                            tail_to=(45, 190),
                        ),
                        LetteringLayer(id="lc", panel_id="c", text="Stay", box=(30, 610, 100, 650)),
                        LetteringLayer(id="global", text="Chapter", box=(10, 0, 200, 20)),
                    ],
                ),
            )
        )
        self.target = self.store.create_episode(
            Episode(
                id="target",
                series_id=self.series.id,
                title="Two",
                order=1,
                panels=[Panel(id="d", order=0)],
                strip=Strip(width=800, height=400, panel_boxes={"d": (24, 24, 300, 224)}),
            )
        )

    def transfer(self, **kwargs):
        values = dict(
            source_episode_id="source",
            target_episode_id="target",
            source_revision=self.source.revision,
            target_revision=self.target.revision,
            panel_ids=["a", "b"],
        )
        values.update(kwargs)
        return PanelTransfer(**values)

    def documents(self):
        return [e.model_dump() for e in self.store.list_episodes(self.series.id)]

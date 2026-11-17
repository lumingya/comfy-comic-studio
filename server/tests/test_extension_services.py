"""Extension-owned services share the same atomic lifecycle as routes and contributions."""

from .api_harness import ApiCase
from .test_extensions import write_ext

MAIN = """
class Service:
    busy = False
    closed = False

    def close(self):
        self.closed = True

def activate(mio):
    service = mio.service(Service())
    mio.contribute("text_provider", "service-test", lambda: service)
"""


class ExtensionServiceTests(ApiCase):
    def enable(self):
        info = self.ctx.extensions.info("demo")
        return self.client.post("/api/extensions/demo/enable", json={"digest": info.digest})

    def test_failed_reactivation_restores_previous_service_and_reviewed_state(self):
        folder = write_ext(self.ctx.extensions.root, main=MAIN)
        self.assertEqual(self.enable().json()["status"], "active")
        previous = self.ctx.extension_services["demo"]
        state = self.ctx.settings().extensions["demo"]
        original = self.ctx.registry.get("text_provider", "service-test")
        (folder / "main.py").write_text(
            MAIN + "\n    raise RuntimeError('activation failed')\n", encoding="utf-8"
        )
        result = self.enable()
        self.assertEqual(result.status_code, 200, result.text)
        self.assertIs(self.ctx.extension_services["demo"], previous)
        self.assertFalse(previous.closed)
        self.assertIs(self.ctx.registry.get("text_provider", "service-test"), original)
        self.assertEqual(self.ctx.settings().extensions["demo"], state)

    def test_busy_reactivation_does_not_persist_an_unreviewed_digest(self):
        folder = write_ext(self.ctx.extensions.root, main=MAIN)
        self.assertEqual(self.enable().json()["status"], "active")
        service = self.ctx.extension_services["demo"]
        previous = self.ctx.settings().extensions["demo"]
        service.busy = True
        (folder / "main.py").write_text(MAIN + "\n# changed\n", encoding="utf-8")
        result = self.enable()
        self.assertEqual(result.status_code, 409, result.text)
        self.assertEqual(self.ctx.settings().extensions["demo"], previous)
        self.assertIs(self.ctx.extension_services["demo"], service)
        service.busy = False

    def test_close_failure_does_not_leave_contributions_or_a_service_active(self):
        write_ext(
            self.ctx.extensions.root,
            main=MAIN.replace("self.closed = True", "raise RuntimeError('close failed')"),
        )
        self.assertEqual(self.enable().json()["status"], "active")
        result = self.client.post("/api/extensions/demo/disable")
        self.assertEqual(result.status_code, 200, result.text)
        self.assertEqual(result.json()["status"], "disabled")
        self.assertNotIn("demo", self.ctx.extension_services)
        self.assertEqual(self.ctx.registry.all("text_provider"), [])

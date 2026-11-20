"""The example cloud adapter is exercised with an in-memory HTTP transport."""

from __future__ import annotations

import base64
import importlib.util
import json
from contextlib import contextmanager
from pathlib import Path
from unittest import TestCase

import httpx

from mio_server.extensions.sdk import ExtensionAPI
from mio_server.pipeline import providers as PV
from mio_server.registry import Registry

PNG = b"\x89PNG\r\n\x1a\n\x00\x00\x00\x00IEND\xaeB`\x82"
PRIVATE = "offline-demo-secret"


def load_example():
    path = Path(__file__).resolve().parents[2] / "examples/extensions/offline-cloud-adapter/main.py"
    spec = importlib.util.spec_from_file_location("offline_cloud_example", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class OfflineCloudAdapterTests(TestCase):
    def test_extension_registers_public_metadata_and_generates_without_network(self):
        class Engine:
            catalog_loading = True

            @staticmethod
            @contextmanager
            def hold_operation():
                yield

        class Context:
            registry = Registry()
            engine = Engine()
            extension_services = {}

        context = Context()
        extension = ExtensionAPI("offline-cloud-adapter", Path(__file__).parent, context)
        module = load_example()
        module.activate(extension)

        descriptor = PV.public_cloud_adapter(context.registry.all("cloud_adapter")[0])
        self.assertEqual(descriptor["id"], "offline_demo")
        self.assertEqual(descriptor["capabilities"], ["generate", "custom-options"])
        self.assertNotIn("default", json.dumps(descriptor["schema"]))

        requests = []

        def respond(request):
            requests.append(request)
            return httpx.Response(
                200,
                json={"image": base64.b64encode(PNG).decode("ascii")},
            )

        channel = PV.ImageChannel(
            id="offline-test",
            kind="offline_demo",
            base_url="https://offline.invalid",
            api_key=PRIVATE,
            model="demo-v1",
            extra_options={"style": "watercolor", "quality": "final", "api_key": PRIVATE},
        )
        client = PV.build(
            channel,
            lambda: None,
            transport=httpx.MockTransport(respond),
            kinds={item.id: item.value for item in context.registry.all("cloud_adapter")},
        )
        image, reply = client.generate_image("a lighthouse at dusk", retries=0)

        self.assertEqual(image, PNG)
        self.assertEqual(len(requests), 1)
        self.assertEqual(requests[0].url.path, "/generate")
        self.assertEqual(requests[0].headers["authorization"], f"Bearer {PRIVATE}")
        self.assertEqual(
            json.loads(requests[0].content),
            {
                "prompt": "a lighthouse at dusk",
                "model": "demo-v1",
                "style": "watercolor",
                "quality": "final",
            },
        )
        self.assertNotIn(PRIVATE, json.dumps(reply.image_request))
        self.assertEqual(reply.image_request["effective"]["options"]["style"], "watercolor")

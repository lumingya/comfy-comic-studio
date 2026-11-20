# Offline cloud adapter

This extension demonstrates a channel-specific `cloud_adapter` and its
`extra_options` contract. It uses the shared `HttpChannel` retry and request
snapshot behavior, while the endpoint and channel options belong to this
extension. Install the adapter on the Mio server, then create an image channel
with kind `offline_demo`, a test endpoint in `base_url`, and options such as:

```json
{"style":"watercolor","quality":"final"}
```

The example intentionally targets a reserved `.invalid` hostname by default.
It cannot contact a real provider unless an operator explicitly changes the
endpoint. `server/tests/test_offline_cloud_adapter.py` injects an
`httpx.MockTransport` and verifies the generated payload, extension discovery,
and credential redaction without network access.

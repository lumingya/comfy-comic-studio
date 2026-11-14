"""A small extension using actual operation, export and open-route contracts."""

import io


def activate(mio):
    @mio.operation("POST /series")
    async def name_new_work(next, ctx, payload):
        prefix = mio.load_settings().get("title_prefix", "")
        if prefix:
            payload = payload.model_copy(update={"title": f"{prefix}{payload.title}"})
        return await next(payload=payload)

    def jpeg(image, strip, fmt, *, preset_id, title, subtitle, quality):
        out = io.BytesIO()
        image.convert("RGB").save(out, "JPEG", quality=quality or 90)
        return out.getvalue(), "image/jpeg", "page.jpg"

    mio.contribute("exporter", "page-jpeg", jpeg, title="JPEG page", interface="strip")

    @mio.route("GET", "/notes/{episode_id}", scope="read")
    def notes(episode_id: str) -> dict:
        episode = mio.internal.store.get_episode(episode_id)
        return {
            "title": episode.title,
            "revision": episode.revision,
            "panels": [
                {
                    "id": panel.id,
                    "description": panel.description,
                    "dialogue": [line.text for line in panel.dialogues],
                }
                for panel in episode.ordered_panels()
            ],
        }

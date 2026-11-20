"""Reviewed, declarative entry points; actions can only open their own existing panel."""

from ..extensions.manifest import HostSlotSpec, PanelSpec
from ..extensions.panel_bridge import active_panel
from ..storage import NotFound
from .deps import Ctx
from .operations import Router

router = Router(tags=["extensions"])


class HostSlotPanel(PanelSpec):
    extension: str
    url: str
    activation: str
    digest: str


class HostSlotEntry(HostSlotSpec):
    extension: str
    panel: HostSlotPanel


@router.get("/extension-host-slots", response_model=list[HostSlotEntry])
def host_slots(ctx: Ctx) -> list[HostSlotEntry]:
    result = []
    for info in ctx.extensions.list():
        if info.status != "active" or info.manifest is None:
            continue
        for slot in info.manifest.contributes.host_slots:
            try:
                panel, loaded, pinned = active_panel(ctx, info.id, slot.action.panel_id)
            except NotFound:
                continue
            result.append(
                HostSlotEntry(
                    **slot.model_dump(),
                    extension=info.id,
                    panel=HostSlotPanel(
                        **panel.model_dump(),
                        extension=info.id,
                        url=f"/api/extensions/{info.id}/files/{panel.entry}",
                        activation=loaded.api.activation_id,
                        digest=pinned,
                    ),
                )
            )
    return sorted(result, key=lambda item: (-item.priority, item.extension, item.id))

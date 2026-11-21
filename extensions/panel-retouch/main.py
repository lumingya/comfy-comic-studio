"""Optional single-panel retouch workspace."""


def activate(mio):
    mio.contribute(
        "workspace_surface",
        "panel-retouch",
        {"title": "单格精修", "mode": "page", "entry": "index.html"},
        title="单格精修",
    )

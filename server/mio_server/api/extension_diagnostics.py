"""Opt-in static diagnostics; never expose workspace paths or private values."""

from ..extensions.ctk import ExtensionDiagnosticReport, diagnose_workspace
from ..extensions.manager import BUILTIN_ROOT
from .deps import Ctx
from .operations import Router

router = Router(tags=["extensions"])


@router.get("/extensions/diagnostics", response_model=ExtensionDiagnosticReport)
def extension_diagnostics(ctx: Ctx) -> ExtensionDiagnosticReport:
    """Read static package/private-state findings without running extension code or migrations."""
    with ctx.engine.hold_operation(), ctx.theme_packages._lock:
        return diagnose_workspace(
            ctx.data_dir,
            extension_roots=[("installed", ctx.extensions.root), ("builtin", BUILTIN_ROOT)],
            theme_roots=[
                ("theme-package", ctx.theme_packages.root),
                ("builtin", ctx.theme_packages.bundled_root),
            ],
            expected_digests={
                identifier: state.digest
                for identifier, state in ctx.settings().extensions.items()
                if state.digest
            },
            failed_extensions=set(ctx.extensions.errors),
        )

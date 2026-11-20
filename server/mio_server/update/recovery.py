"""Load the stable installation host even when only server/ is on sys.path."""

import importlib.util
import sys
from pathlib import Path

NAME = "mio_update_bootstrap"
if NAME not in sys.modules:
    spec = importlib.util.spec_from_file_location(
        NAME, Path(__file__).resolve().parents[3] / f"{NAME}.py"
    )
    host = importlib.util.module_from_spec(spec)
    sys.modules[NAME] = host
    spec.loader.exec_module(host)
else:
    host = sys.modules[NAME]

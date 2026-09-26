"""Where the shipped data/ lives relative to the program directory.

Two layouts are supported:

* release package / old checkout: ``<program>/data`` next to ``server.py``;
* repository after the v3 move: the program is ``<repo>/legacy`` and the data stays at
  ``<repo>/data`` (personal workspaces are never moved; the v3 importer reads it there too).

The manifest ``data/distribution.json`` marks a real shipped data directory, so an empty or
half-created ``<program>/data`` never shadows the repository one.
"""
from pathlib import Path

MANIFEST = 'distribution.json'


def shipped_data_dir(program_dir):
    """Return the shipped data directory for ``program_dir`` (the folder holding server.py)."""
    program = Path(program_dir)
    own = program / 'data'
    if (own / MANIFEST).is_file():
        return own
    parent = program.parent / 'data'
    if (parent / MANIFEST).is_file():
        return parent
    return own


def inside_repository_subfolder(program_dir):
    """True when the program folder is a subfolder of a git checkout (``<repo>/legacy``)."""
    program = Path(program_dir)
    return not (program / '.git').exists() and (program.parent / '.git').exists()

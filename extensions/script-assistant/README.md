# Script Assistant

This optional extension adds a review workspace to an episode. It is inert until opened and never edits the script without an explicit apply action.

The script assistant creates a named work checkpoint before applying selected changes. Proposals are checked against their base revision; a stale proposal is disabled. A timeout or ambiguous write result disables the old proposal so it cannot be submitted again. Locked panels remain unselectable. Pacing suggestions are also reviewed individually and applied with the episode revision returned by the API.

## Install

Import this directory from **Extensions → Installed**, inspect its content digest, then explicitly enable it. It contributes an episode panel and does not add a main-navigation entry. Disabling the extension removes the panel; accepted edits and named checkpoints remain part of the work history.

## API requests

The panel uses only its declared bridge operations:

| Operation | Scope | Purpose |
| --- | --- | --- |
| `GET /episodes/{episode_id}` | read | Load script and check its revision |
| `GET /series/{series_id}` | read | Resolve the work context |
| `POST /episodes/{episode_id}/assistant/propose` | render | Generate a structured script proposal |
| `POST /episodes/{episode_id}/assistant/apply` | write | Apply explicitly selected proposal operations |
| `POST /episodes/{episode_id}/pacing/suggest` | write | Preview deterministic pacing suggestions |
| `POST /episodes/{episode_id}/pacing/apply` | write | Apply selected pacing changes at a base revision |
| `GET /series/{series_id}/head` | read | Read the work checkpoint head |
| `POST /series/{series_id}/checkpoints` | write | Save a named pre-apply checkpoint |

Generating script suggestions may use a configured paid text model. It happens only after the user clicks **Generate proposal**. Pacing suggestions are deterministic and do not invoke a model.

## Local checks

```bash
python tools/check_extension_package.py extensions/script-assistant
node extensions/script-assistant/panel.test.cjs
```

# Core slot dispatch and keyed defaults

Scope: `comfy/workflow_slots.py`, `slot_adapters.py`, `builtin_slot_adapters.py`, and
`tests/test_core_slot_dispatch.py`. Work performed on the shared integration branch; no personal
data or generated clients were modified by this agent.

## Implementation

- Five generic codecs recognize and write chain, numbered/object stack, object-list, embedded,
  and tag-syntax slots. They share `inspect` / `write` dispatch with the external-codec wrapper.
  The external `inspect(node)` / `write(node, slot, loras)` contract remains unchanged.
- `register_builtins` publishes stable built-in IDs and contract digests. The parent agent added
  startup registration in `context.py`. Control queries report per-group provenance and adapter
  identities without changing the legacy raw `analyze()` result or fixtures.
- Discovery and compilation share `resolved_loras` and deterministic keys, so configured extra
  defaults appear as `pinned: false`, can be switched independently, and preserve model/CLIP
  weights in their saved source configuration.
- Originally disabled object/stack entries remain discoverable and can be enabled with their
  original weights. Distinct same-name object rows keep their own extra metadata.
- A disabled extra chain node keeps the extra LoRA name rather than the cloned predecessor name.
  A codec with no safe independent-disable capability rejects a disable request.

## Verification

- `python -m unittest discover -s server/tests -t server -p test_workflow*.py -q`: **42 passed**,
  including exact legacy semantic-plan/apply fixtures and the extension-discovery regression.
- `python -m unittest discover -s server/tests -t server -p test_slot_*.py -q`: **12 passed**,
  including the parallel agent's topology/lifecycle/portable-cloud-kit regressions as present at
  the time of the run.
- `python -m unittest discover -s server/tests -t server -p test_core_slot_dispatch.py -q`:
  **6 passed**. These cover five dispatch shapes, source immutability and restoring defaults,
  native disabled entries, appended defaults, same-name rows, prompt-bound tag syntax, and a
  disabled extra chain entry.
- Scoped Ruff, format, UTF-8 text guard, and `git diff --check`: passed. The legacy
  `workflow_slots.py` Ruff exclusion remains in place; the file was not globally reformatted.

Initial new-test failures were fixture assumptions, not relaxed production assertions: an
embedded fixture included an unused checkpoint that the established compile pruner removes,
and a tag expectation retained a file suffix that the established tag formatter strips. The
fixture now contains only live nodes and asserts the existing normalized tag spelling.

No external service, local ComfyUI generation, browser installation, or paid API was used.

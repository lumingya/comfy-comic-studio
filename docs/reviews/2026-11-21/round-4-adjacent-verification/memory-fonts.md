# Round 4 independent verification: in-memory region fonts

- Date: 2026-11-21.
- Finding: `R4-RENDER-FONT-01`.
- Environment: Windows, existing project `.venv`, Python 3.13, Pillow 12.3.0.
- Review target: stable working-tree changes to `server/mio_server/pipeline/regions.py`
  and `server/tests/test_review_region_memory_font.py`, with HEAD `caade74` at verification.
- Ownership: this reviewer added only this report. No production/test edits, delegation,
  commit, push, font installation, running service, or user-data access.

## Decision

**Close `R4-RENDER-FONT-01` for the verified scope.** The former font-copy/reopen path is
absent. Pillow's built-in in-memory fallback, an explicitly supplied `BytesIO` TrueType
font, and a temporary font file all render without copying or reopening the loaded font.
The shared original method/state remain unchanged. Native full-image bytes and joined
region bytes match, including multiline title rendering and negative local origins.
No new confirmed defect was found in this narrow review.

## Implementation inspected

`_PhaseFont` subclasses `FreeTypeFont` to preserve Pillow's glyph-offset handling, but
does not call the base constructor. It stores the source and phase on the new view and
delegates other access to the loaded font. Its `getmask2` supplies the draw-specific
start fraction to the original method; there is no temporary replacement of that method
or assignment to the source font.

`_RegionDraw.text` creates the view only for a single laid-out line. With current Pillow,
multiline text uses its native `ImageText.Text._split` layout and then applies each line's
phase using the original font. The older recursive branch passes the original font and
coordinates into `multiline_text`, avoiding an outer proxy/phase around recursive calls.
Non-FreeType font handling continues through the native draw method.

## Executed regression tests

From the repository root, using the existing `.venv/Scripts/python.exe -B` with `server`
prepended to `sys.path`, independently ran the entire
`tests.test_review_region_memory_font` module:

```text
test_bytesio_ttf_regions_never_reopen_font                               ok
test_concurrent_shared_memory_font_keeps_original_method_and_phase      ok
test_default_memory_font_regions_match_native_full_drawing              ok
test_file_ttf_regions_never_reopen_font                                 ok
test_multiline_text_preserves_native_alignment_and_phase                ok
test_no_system_fonts_snapshot_bands_match_full_compositor               ok
test_recursive_multiline_path_receives_original_font_per_line           ok

Ran 7 tests in 0.128s
OK
```

There were **zero skips**. Important exercised properties:

- The default font really has a `BytesIO` path; this is the built-in fallback rather
  than an installed system font. Its stream position remains unchanged after drawing.
- Both the explicit `BytesIO` font and the temporary file-backed font run with
  `FreeTypeFont.__init__` patched to raise if drawing attempts a reopen.
- Eight synchronized workers share one in-memory font across four fractional phases.
  Their results match serial results, and the original bound `getmask2` and font
  `__dict__` remain equal to the pre-render values.
- Single-line and multiline native-versus-band comparisons cross odd seams at 257 and
  513, including negative local glyph coordinates and left/center/right alignment.
- The controlled older-Pillow recursion test asserts that every forwarded multiline
  call receives the original font. Its joined bands also match native line drawing.
- Patching `layout.find_font` to return `None` forces every snapshot font onto the
  actual built-in `BytesIO` fallback. Speech, thought, caption, a multiline title,
  and end decoration render with exact full-compositor versus joined-band equality.

## Independent guard probe

Also ran a separate, non-persisted Python probe, not another invocation of the test
helper. It preloaded three fonts from Pillow's bundled font bytes: `load_default(24)`,
explicit `BytesIO`, and a font file inside a fresh temporary directory. No system font
was needed for any form.

For each source it drew a stroked single line, a centered three-line title through
`text`, and a two-line block through `multiline_text`. It used horizontal origins
`0`, `13`, and `121`, and vertical bands `[0,257)`, `[257,513)`, and `[513,800)`.
Every joined result was byte-for-byte equal to the corresponding crop of native
`ImageDraw` full rendering.

During those region draws, `copy.copy`, `copy.deepcopy`, `FreeTypeFont.__init__`, and
`builtins.open` were patched to fail immediately. A wrapper around `_PhaseFont.__init__`
also asserted that its source was never already a `_PhaseFont`. All three font forms
passed, producing 54 phase views each (162 total), with no copy, reopen, nested proxy,
or change to the original bound `getmask2` or font dictionary.

```text
builtin PASS phase_views=54 no_copy_open_or_nested_proxy
bytesio PASS phase_views=54 no_copy_open_or_nested_proxy
file    PASS phase_views=54 no_copy_open_or_nested_proxy
Independent guard probe: PASS; native bytes identical.
```

## Evidence identity and limits

SHA-256 of the verified stable files:

```text
regions.py
668f2cb7817e85d09aabb850b48a11f0ad8fe2196fff5e972222edaab5a8f21c

test_review_region_memory_font.py
3c0258544a6be63cfc958d767231ad2cf4aea73a678e6ab3597bd6594cbc1ce8
```

This review executed Pillow 12.3.0 locally. The older recursive behavior was exercised
through the explicit controlled test, not by installing/running a second Pillow version.
The no-system-font case was forced through the production font-discovery seam; this
was not a separate Ubuntu run. This report does not claim full export-format coverage,
full backend regression, CI success, or verification of unrelated modules. Broader
export regressions and the final remote CI remain the integration owner's checks.

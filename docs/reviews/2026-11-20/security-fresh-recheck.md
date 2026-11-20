# Fresh independent security recheck

Reviewer: `sdk_acceptance`, previously responsible for SDK acceptance and not an author of
these production security fixes. Review target: the six findings in
`final-security-adversarial.md`, through HEAD `e462731f03f75888b302b8200aaac46609c35488`
plus the current integration changes. The review kept production files read-only.

## Standards axis

Credential privacy and the instruction to use isolated fake services were the material
standards. Synthetic regression data lives only in fresh `ApiCase` temporary workspaces.
No personal data, external request, real generation or browser installation was involved.
The new regression file is below 400 lines; Ruff, formatting, UTF-8 and diff checks pass.

## Spec axis

Independent inspection and `server/tests/test_security_review_regressions.py` verify:

| Original finding | Evidence after fixes |
| --- | --- |
| S1, precise workflow format code | Local and v2 POST import and PATCH both reject UI-format graphs with HTTP 400, `code=ui_format` and API-export guidance; saved graph remains unchanged. |
| S2, Cookie/session privacy | Real settings responses mask Cookie, Set-Cookie and session key/id/token variants; mask round trips retain stored values; frozen requests omit them; binding restores rotated current credentials and keeps frozen ordinary options. |
| S3, credential URLs | Six variants, including userinfo, secret query, leading space/newline, scheme-relative URL and secret fragment, are rejected through the settings API. Ordinary URLs and explicitly named credential fields still work. Historical invalid settings produce a client error without echoing their short stored credential in local/v2 GET/PATCH responses. |
| S4, automatic navigation | Case and entity-encoded refresh directives, abrupt-comment forms and noscript-hidden META are rejected both when parsing imports and when rendering older stored template objects. |
| S5, deep JSON | A 600-level payload below 32 KiB returns JSON HTTP 400/422 through both APIs. Extension metadata rejects depth 600 and more than 8,192 nodes before recursive copying; valid shallow metadata remains discoverable. |
| S6, lost preset update | A deterministic two-thread barrier forces both independent PATCH calls to reach `update_series` before the title update commits first. The subsequent entries update preserves the title; both responses and the stored result reflect their committed values. |

## Additional findings closed during this recheck

1. P1: URL validation originally checked the raw string prefix before parsing. Leading C0
   whitespace bypassed it, and scheme-relative URLs/credential fragments survived. The
   owner now normalizes the URL prefix and inspects query and fragment credential keys.
2. P2: BODY comments such as `<!--><meta http-equiv=refresh ...> -->` hid a refresh directive
   from Python's parser while the existing jsdom HTML5 parser produced an actual META DOM
   node. Noscript contents exposed the same offline navigation risk with scripting disabled.
   The owner now rejects ambiguous comments throughout the document and META in noscript.
3. P1: Rejecting an older persisted credential URL still echoed its input through
   `str(ValidationError)`. A short synthetic password reproduced this in four local/v2
   settings read/patch combinations; a longer URL had merely been truncated. The owner
   enabled `hide_input_in_errors` on `StrictModel`; all four subcases now pass.

## Verification and boundary

- Nine integration regression cases passed after the URL/comment fixes (11.737 seconds).
- The subsequently added historical credential-URL case first failed all four subcases,
  then passed after input hiding (1.437 seconds). Only that affected case was rerun.
- Ruff check, Ruff format check, UTF-8 guard and `git diff --check` passed for the new file.

No remaining P0-P2 issue was established in these six rechecked security boundaries. This
does not assert full-repository security, actual browser navigation execution, live-provider
behavior or the parent's complete CI result; those require their own evidence.

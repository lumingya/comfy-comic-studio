# Independent scheduler regression test recheck

Reviewed the two Windows failures from CI for HEAD 5448758 and the subsequent test-only
changes in test_other_engine_review.py and test_other_fresh_recheck.py. Production
runtime.py and pool.py were read-only. Only this review document is owned by the reviewer.

## Finding and repair

Both original tests submitted independent tasks with equal priority, then assumed the first
submit call must produce the first scheduled task. Windows can give both submissions the
same created timestamp. SQL orders candidates by priority, created and item index; those
keys were identical, so submission-call order was not a valid premise for the callback test.

The repaired fixtures force both submissions to timestamp 1 and assign the callback source
priority 10. The resource pool orders local candidates by (-priority, created, index), so
the source is now guaranteed to be claimed before the target, even when timestamps tie.
The pause, pending/canceled state, attempts=0 and tick-started-count=1 assertions remain
unchanged. No timing sleep, weakened assertion or production behavior change was added.

Independent mutation checking found that the fresh self-pause case originally had the
default window of 1, so its second item never entered the planned claims. The root agent
strengthened that fixture to window=2. It now exercises two planned same-job claims and
requires the started listener's pause to stop the second claim.

## Verification

- Both affected test methods pass with forced equal timestamps and explicit priority.
  The fresh method exercises its self_pause and cancel_other subcases.
- A memory-only mutation used the current _claim source with only its paused/blocked/
  canceled recheck removed; no source file was edited. Both paused-other and self-pause
  regressions then fail, detecting the missing guard. cancel_other remains correctly
  protected by cancellation changing the pending item's state before its claim.
- An independent pool probe supplied the lower-priority candidate first with identical
  timestamps; the callback source still planned first, confirming the test premise.
- The job-flag recheck remains under engine and pool locks before reading/claiming the
  item. All production pause/cancel logic and original safety assertions are preserved.
- Ruff check and format checks passed for the two affected test files before the final
  window fixture strengthening; the final two-method baseline and mutation rerun passed
  after that strengthening.

No remaining P0-P2 defect was established in this narrow test-order repair. This validates
the fixtures and their sensitivity to the claim guard, not the full remote Windows suite.
No network, service, personal data or full-suite run was used.

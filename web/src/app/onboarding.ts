const DISMISSED_KEY = 'mio.quick-start.dismissed';
const INITIALIZED_KEY = 'mio.quick-start.initialized';

/** Treat saved UI preferences without an onboarding marker as an existing workspace. */
export function quickStartDismissed(): boolean {
  try {
    const saved = localStorage.getItem(DISMISSED_KEY);
    if (saved !== null) return saved === 'yes';
    const wasInitialized = localStorage.getItem(INITIALIZED_KEY) === 'yes';
    if (wasInitialized) return false;
    const existingWorkspace = localStorage.getItem('mio.ui') !== null;
    localStorage.setItem(INITIALIZED_KEY, 'yes');
    if (existingWorkspace) localStorage.setItem(DISMISSED_KEY, 'yes');
    return existingWorkspace;
  } catch {
    return false;
  }
}

export function setQuickStartDismissed(dismissed: boolean) {
  try {
    localStorage.setItem(DISMISSED_KEY, dismissed ? 'yes' : 'no');
  } catch {
    // Private browsing can disable storage; the guide still works for this visit.
  }
}

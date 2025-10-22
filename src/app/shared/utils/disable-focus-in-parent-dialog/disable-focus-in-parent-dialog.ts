export type RestoreFocusFn = () => void;

// Module-level variable to hold the timeout ID, ensuring it's a singleton.
let restoreTimeoutId: any = null;

/**
 * Schedules the focus restoration after a delay, cancelling any previously scheduled restoration.
 * This prevents race conditions when multiple child dialogs are opened and closed quickly.
 */
export function scheduleRestoreFocus(restoreFn: RestoreFocusFn): void {
  if (restoreTimeoutId) {
    clearTimeout(restoreTimeoutId);
  }

  restoreTimeoutId = setTimeout(() => {
    restoreFn();
    restoreTimeoutId = null;
  }, 250);
}

/**
 * Temporarily disables focusability of elements inside the parent PrimeNG DynamicDialog.
 * This prevents the default behavior of focusing the first focusable element in parent dialog, which can scroll the dialog back up to the top.
 * Returns a cleanup function that should be passed to `scheduleRestoreFocus` when the child dialog closes.
 */
export function disableFocusInParentDialog(): RestoreFocusFn {
  const parentDialog = document.querySelector('p-dynamicdialog') as HTMLElement | null;
  if (!parentDialog) {
    return () => {
    };
  }

  const focusableSelectors = [
    'a[href]',
    'area[href]',
    'input:not([type="hidden"])',
    'select',
    'textarea',
    'button',
    'iframe',
    'object',
    'embed',
    '[contenteditable]',
    '[tabindex]:not([tabindex="-1"])'
  ].join(',');

  const elements = Array.from(parentDialog.querySelectorAll<HTMLElement>(focusableSelectors));
  const modified: Array<{ el: HTMLElement; hadTabIndexAttr: boolean; previousTabIndex: number | null }> = [];

  for (const el of elements) {
    const hadTabIndexAttr = el.hasAttribute('tabindex');
    const previousTabIndex = hadTabIndexAttr ? el.tabIndex : null;

    modified.push({el, hadTabIndexAttr, previousTabIndex});

    try {
      el.setAttribute('tabindex', '-1');
    } catch {
      // ignore if element doesn't allow attribute change
    }
  }

  // Return a cleanup function
  let restored = false;
  return function restore() {
    if (restored) {
      return;
    }

    restored = true;

    for (const {el, hadTabIndexAttr, previousTabIndex} of modified) {
      try {
        if (hadTabIndexAttr) {
          // restore previous numeric tabindex
          if (previousTabIndex === null) {
            el.removeAttribute('tabindex');
          } else {
            el.tabIndex = previousTabIndex;
          }
        } else {
          // element didn't have tabindex attribute originally - remove the attribute
          el.removeAttribute('tabindex');
        }
      } catch {
        // ignore restore failures
      }
    }
  };
}

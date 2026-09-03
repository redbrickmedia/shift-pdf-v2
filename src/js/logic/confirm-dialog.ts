export type ConfirmDialogOptions = {
  root?: Document;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
};

const DIALOG_ID = 'shift-confirm-dialog';

export function closeConfirmDialog(root: Document = document): void {
  root.getElementById(DIALOG_ID)?.remove();
}

export function confirmAction({
  root = document,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive = false,
}: ConfirmDialogOptions): Promise<boolean> {
  closeConfirmDialog(root);

  return new Promise((resolve) => {
    const previouslyFocused = root.activeElement as HTMLElement | null;
    let settled = false;

    const overlay = root.createElement('div');
    overlay.id = DIALOG_ID;
    overlay.className = 'shift-confirm-overlay';
    overlay.setAttribute('role', 'alertdialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'shift-confirm-title');
    overlay.setAttribute('aria-describedby', 'shift-confirm-message');

    const panel = root.createElement('div');
    panel.className = 'shift-confirm-panel';

    const heading = root.createElement('h2');
    heading.id = 'shift-confirm-title';
    heading.className = 'shift-confirm-title';
    heading.textContent = title;

    const body = root.createElement('p');
    body.id = 'shift-confirm-message';
    body.className = 'shift-confirm-message';
    body.textContent = message;

    const actions = root.createElement('div');
    actions.className = 'shift-confirm-actions';

    const cancel = root.createElement('button');
    cancel.type = 'button';
    cancel.className =
      'shift-button shift-button-secondary shift-confirm-cancel';
    cancel.textContent = cancelLabel;

    const confirm = root.createElement('button');
    confirm.type = 'button';
    confirm.className = destructive
      ? 'shift-button shift-confirm-accept is-destructive'
      : 'shift-button shift-confirm-accept';
    confirm.textContent = confirmLabel;

    const settle = (result: boolean) => {
      if (settled) return;
      settled = true;
      root.removeEventListener('keydown', onKeydown, true);
      overlay.remove();
      previouslyFocused?.focus?.();
      resolve(result);
    };

    function onKeydown(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        event.preventDefault();
        settle(false);
      }
    }

    cancel.addEventListener('click', () => settle(false));
    confirm.addEventListener('click', () => settle(true));
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) settle(false);
    });
    root.addEventListener('keydown', onKeydown, true);

    actions.append(cancel, confirm);
    panel.append(heading, body, actions);
    overlay.append(panel);
    root.body.appendChild(overlay);

    // Destructive actions open on the safe choice so a stray Enter cannot
    // confirm the deletion.
    (destructive ? cancel : confirm).focus();
  });
}

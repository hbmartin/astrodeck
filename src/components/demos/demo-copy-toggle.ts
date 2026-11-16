interface FeedbackTimers {
  setTimeout: (callback: () => void, delay: number) => number;
  clearTimeout: (timer: number) => void;
}

function showFeedback(button: HTMLButtonElement, label: 'Copy Code' | 'Hide Code' | 'Copied!') {
  button.textContent = label;
  button.classList.toggle('bg-primary', label === 'Copied!');
  button.classList.toggle('text-primary-foreground', label === 'Copied!');
}

export function createDemoCopyToggle(
  copyText: (text: string) => Promise<boolean>,
  timers: FeedbackTimers
) {
  const open = new WeakMap<HTMLButtonElement, { timer?: number }>();

  return async function toggleCode(button: HTMLButtonElement, panel: HTMLElement) {
    if (!panel.hidden) {
      const timer = open.get(button)?.timer;
      if (timer !== undefined) timers.clearTimeout(timer);
      open.delete(button);
      panel.hidden = true;
      button.setAttribute('aria-expanded', 'false');
      showFeedback(button, 'Copy Code');
      return;
    }

    const current: { timer?: number } = {};
    open.set(button, current);
    panel.hidden = false;
    button.setAttribute('aria-expanded', 'true');
    showFeedback(button, 'Hide Code');
    const copied = await copyText(panel.querySelector('code')?.textContent ?? '');
    if (!copied || open.get(button) !== current) return;

    showFeedback(button, 'Copied!');
    current.timer = timers.setTimeout(() => {
      if (open.get(button) !== current) return;
      delete current.timer;
      showFeedback(button, 'Hide Code');
    }, 1500);
  };
}

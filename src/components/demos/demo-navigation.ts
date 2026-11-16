const activeClasses = ['bg-foreground', 'text-background'];
let observer: IntersectionObserver | undefined;
let listeners: AbortController | undefined;

function updateCount(link: HTMLAnchorElement, active: boolean) {
  const count = link.querySelector('[data-nav-count]');
  count?.classList.toggle('text-muted-foreground', !active);
  count?.classList.toggle('text-muted-foreground/60', active);
}

function updateLabel(label: HTMLElement | null, text = '') {
  if (label) label.textContent = text;
}

function highlight(links: NodeListOf<HTMLAnchorElement>, section: string) {
  const label = document.getElementById('mobile-subnav-current');
  for (const link of links) {
    const active = link.dataset.section === section;
    for (const token of activeClasses) link.classList.toggle(token, active);
    updateCount(link, active);
    if (active) updateLabel(label, link.dataset.navLabel);
  }
}

function observeSections() {
  const links = document.querySelectorAll<HTMLAnchorElement>('.nav-link[data-section]');
  const current = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) highlight(links, entry.target.id);
      }
    },
    { rootMargin: '-100px 0px -66%' }
  );
  document.querySelectorAll('section[id]').forEach((section) => current.observe(section));
  return current;
}

function wireMobileMenu(signal: AbortSignal) {
  const toggle = document.getElementById('mobile-subnav-toggle');
  const menu = document.getElementById('mobile-subnav-menu');
  const chevron = document.getElementById('mobile-subnav-chevron');
  if (!toggle || !menu) return;
  const setOpen = (open: boolean) => {
    menu.classList.toggle('hidden', !open);
    chevron?.classList.toggle('rotate-180', open);
    toggle.setAttribute('aria-expanded', String(open));
  };
  toggle.addEventListener('click', () => setOpen(menu.classList.contains('hidden')), { signal });
  menu
    .querySelectorAll('a')
    .forEach((link) => link.addEventListener('click', () => setOpen(false), { signal }));
}

export function initDemoNavigation() {
  observer?.disconnect();
  listeners?.abort();
  if (!document.getElementById('mobile-subnav-toggle')) return;
  listeners = new AbortController();
  wireMobileMenu(listeners.signal);
  observer = observeSections();
}

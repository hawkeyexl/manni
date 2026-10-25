/** Native fullscreen when supported, with an accessible viewport-filling fallback for phones. */
export function fullscreenControls(
  root: HTMLElement,
  button: HTMLButtonElement,
) {
  let expanded = false;
  let native = false;
  let previousOverflow = "";
  let previousRole: string | null = null;
  let previousModal: string | null = null;
  let previousFocus: Element | null = null;
  let placeholder: Comment | null = null;
  let siblings: { element: HTMLElement; inert: boolean }[] = [];

  function restore(): void {
    if (!expanded) return;
    expanded = false;
    native = false;
    delete root.dataset.expanded;
    button.textContent = "Fullscreen";
    button.setAttribute("aria-pressed", "false");
    document.body.style.overflow = previousOverflow;
    if (previousRole === null) root.removeAttribute("role");
    else root.setAttribute("role", previousRole);
    if (previousModal === null) root.removeAttribute("aria-modal");
    else root.setAttribute("aria-modal", previousModal);
    for (const item of siblings) item.element.inert = item.inert;
    siblings = [];
    placeholder?.replaceWith(root);
    placeholder = null;
    if (previousFocus instanceof HTMLElement && previousFocus.isConnected)
      previousFocus.focus({ preventScroll: true });
  }
  async function exit(): Promise<void> {
    if (document.fullscreenElement === root) {
      try {
        await document.exitFullscreen();
      } catch {
        /* The visible exit control remains available. */
      }
    }
    if (document.fullscreenElement !== root) restore();
  }
  async function toggle(): Promise<void> {
    if (expanded) {
      await exit();
      return;
    }
    previousFocus = document.activeElement;
    previousOverflow = document.body.style.overflow;
    previousRole = root.getAttribute("role");
    previousModal = root.getAttribute("aria-modal");
    expanded = true;
    root.dataset.expanded = "true";
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-modal", "true");
    button.textContent = "Exit fullscreen";
    button.setAttribute("aria-pressed", "true");
    document.body.style.overflow = "hidden";
    // Escape Starlight's stacking contexts as well as filling the viewport.
    placeholder = document.createComment("graph-explorer-fullscreen");
    root.before(placeholder);
    document.body.append(root);
    let current: HTMLElement | null = root;
    while (current?.parentElement && current !== document.body) {
      for (const sibling of current.parentElement.children) {
        if (sibling !== current && sibling instanceof HTMLElement) {
          siblings.push({ element: sibling, inert: sibling.inert });
          sibling.inert = true;
        }
      }
      current = current.parentElement;
    }
    button.focus({ preventScroll: true });
    if (
      document.fullscreenEnabled &&
      typeof root.requestFullscreen === "function"
    ) {
      try {
        await root.requestFullscreen({ navigationUI: "hide" });
        native = true;
        if (!expanded && document.fullscreenElement === root)
          await document.exitFullscreen();
      } catch {
        /* The viewport fallback is already active and needs no native API. */
      }
    }
  }
  const onFullscreen = () => {
    if (native && document.fullscreenElement !== root) restore();
  };
  const onKey = (event: KeyboardEvent) => {
    if (!expanded) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      void exit();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = [
      ...root.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input:not(:disabled), select:not(:disabled), a[href], summary, [tabindex="0"]',
      ),
    ].filter(
      (item) => item.getClientRects().length > 0 && !item.closest("[hidden]"),
    );
    const first = focusable[0];
    const last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first && last) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last && first) {
      event.preventDefault();
      first.focus();
    }
  };
  document.addEventListener("fullscreenchange", onFullscreen);
  root.addEventListener("keydown", onKey, true);
  return {
    toggle,
    exit,
    dispose() {
      document.removeEventListener("fullscreenchange", onFullscreen);
      root.removeEventListener("keydown", onKey, true);
      void exit();
    },
  };
}

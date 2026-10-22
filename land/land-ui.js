(() => {
  "use strict";
  let expanded = null,
    priorOverflow = "",
    priorFocus = null;
  const icon =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M8 3H3v5M16 3h5v5M3 16v5h5M21 16v5h-5"/></svg>';
  function resize() {
    requestAnimationFrame(() => window.dispatchEvent(new Event("resize")));
  }
  function close() {
    if (!expanded) return;
    expanded.classList.remove("land-map-expanded");
    const button = expanded.querySelector(".land-map-expand");
    button?.setAttribute("aria-pressed", "false");
    button?.setAttribute("aria-label", "Expand map");
    document.body.style.overflow = priorOverflow;
    expanded = null;
    priorFocus?.focus();
    resize();
  }
  function enhance() {
    for (const map of document.querySelectorAll(".leaflet-container")) {
      if (map.dataset.landExpand || map.id === "weatherFieldMap" || map.closest("dialog")) continue;
      map.dataset.landExpand = "true";
      const button = document.createElement("button");
      button.type = "button";
      button.className = "land-map-expand";
      button.setAttribute("aria-label", "Expand map");
      button.setAttribute("aria-pressed", "false");
      button.innerHTML =
        icon + '<span class="land-map-close-label">Close map</span>';
      for (const name of ["mousedown", "pointerdown", "touchstart", "dblclick"])
        button.addEventListener(name, (e) => e.stopPropagation());
      button.addEventListener("click", (e) => {
        e.stopPropagation();
        if (expanded === map) {
          close();
          return;
        }
        close();
        priorOverflow = document.body.style.overflow;
        priorFocus = document.activeElement;
        expanded = map;
        map.classList.add("land-map-expanded");
        document.body.style.overflow = "hidden";
        button.setAttribute("aria-pressed", "true");
        button.setAttribute("aria-label", "Close expanded map");
        button.focus();
        resize();
      });
      map.append(button);
    }
  }
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && expanded) {
      e.preventDefault();
      close();
    }
  });
  document.addEventListener("land:resize", resize);
  const observer = new MutationObserver(() => {
    enhance();
    if (expanded && !expanded.isConnected) close();
  });
  observer.observe(document.body, { childList: true, subtree: true });
  enhance();
  const nav = document.querySelector(".land-navigation"),
    active = nav?.querySelector("[aria-current=page]");
  function centerNav() {
    if (active && nav.scrollWidth > nav.clientWidth)
      nav.scrollLeft = Math.max(
        0,
        active.offsetLeft - nav.offsetWidth / 2 + active.offsetWidth / 2,
      );
  }
  centerNav();
  window.addEventListener("resize", centerNav);
})();

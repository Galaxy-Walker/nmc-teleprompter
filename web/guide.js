const SEEN_KEY = "teleprompter.guide.v1";

const modal = document.querySelector("#guide-modal");
const closeBtn = document.querySelector("#guide-close");
const doneBtn = document.querySelector("#guide-done");
const openers = [
  document.querySelector("#guide-btn"),
  document.querySelector("#start-guide"),
  document.querySelector("#controls-guide"),
];

let lastFocus = null;

function markSeen() {
  try {
    localStorage.setItem(SEEN_KEY, "1");
  } catch {
    // Private mode: the guide simply opens again next time.
  }
}

function hasSeen() {
  try {
    return localStorage.getItem(SEEN_KEY) === "1";
  } catch {
    return false;
  }
}

export function openGuide() {
  if (!modal || !modal.hidden) return;
  lastFocus = document.activeElement;
  modal.hidden = false;
  document.documentElement.dataset.guide = "open";
  markSeen();

  // Reading a tutorial while the script is scrolling is confusing. The
  // player listens for this event and pauses; it does not auto-resume.
  document.dispatchEvent(new CustomEvent("teleprompter:guide-open"));
  closeBtn?.focus();
}

export function closeGuide() {
  if (!modal || modal.hidden) return;
  modal.hidden = true;
  delete document.documentElement.dataset.guide;
  if (lastFocus instanceof HTMLElement && lastFocus.isConnected) {
    lastFocus.focus();
  }
  lastFocus = null;
}

export function initGuide() {
  if (!modal) return;

  for (const opener of openers) {
    opener?.addEventListener("click", openGuide);
  }
  closeBtn?.addEventListener("click", closeGuide);
  doneBtn?.addEventListener("click", closeGuide);

  modal.addEventListener("click", (event) => {
    if (event.target === modal) closeGuide();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !modal.hidden) {
      event.preventDefault();
      closeGuide();
    }
  });

  if (hasSeen()) return;
  if (location.hash.startsWith("#/play/")) return;

  window.setTimeout(() => {
    if (modal.hidden && !location.hash.startsWith("#/play/")) {
      openGuide();
    }
  }, 550);
}

import { getScript, logout } from "./api.js";
import { initGuide } from "./guide.js";
import { initLibrary, refreshLibrary } from "./library.js";
import { createPlayer } from "./player.js";
import { applySettings, loadSettings } from "./settings.js";

const libraryView = document.querySelector("#library-view");
const playerView = document.querySelector("#player-view");
const statusEl = document.querySelector("#status");
const logoutBtn = document.querySelector("#logout-btn");

const settings = loadSettings();
applySettings(settings);

let player = null;
let routeToken = 0;

initGuide();
initLibrary();

logoutBtn?.addEventListener("click", async () => {
  logoutBtn.disabled = true;
  try {
    await logout();
  } catch {
    // The cookie may already be expired; either way, go back to the gate.
  }
  location.replace("/login");
});

function parseRoute() {
  const match = location.hash.match(/^#\/play\/(.+)$/);
  if (!match) return { name: "library" };
  try {
    return { name: "play", id: decodeURIComponent(match[1]) };
  } catch {
    return { name: "library" };
  }
}

function destroyPlayer() {
  if (!player) return;
  player.destroy();
  player = null;
}

async function showLibrary() {
  routeToken += 1;
  destroyPlayer();
  playerView.hidden = true;
  libraryView.hidden = false;
  await refreshLibrary();
}

async function showPlayer(id) {
  const token = ++routeToken;
  destroyPlayer();
  libraryView.hidden = true;
  playerView.hidden = false;
  statusEl.hidden = false;
  statusEl.textContent = "加载中…";

  try {
    const script = await getScript(id);
    if (token !== routeToken) return;

    const created = await createPlayer({ script, settings });
    if (token !== routeToken) {
      created.destroy();
      return;
    }
    player = created;
  } catch (error) {
    if (token !== routeToken) return;
    statusEl.textContent = `加载失败：${error.message}`;
    window.setTimeout(() => {
      if (token === routeToken) location.hash = "#/";
    }, 1800);
  }
}

function render() {
  const route = parseRoute();
  if (route.name === "play") showPlayer(route.id);
  else showLibrary();
}

window.addEventListener("hashchange", render);
render();

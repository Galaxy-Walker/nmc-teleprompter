import { saveSettings } from "./settings.js";
import { createWakeLock } from "./wake.js";

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

function isInteractive(target) {
  return (
    target instanceof Element &&
    Boolean(target.closest("button, input, label, .controls, .overlay"))
  );
}

export async function createPlayer({ script, settings }) {
  const byId = (id) => document.getElementById(id);

  const stage = byId("stage");
  const content = byId("content");
  const startOverlay = byId("start");
  const startTitle = byId("start-title");
  const startBtn = byId("start-btn");
  const startSettingsBtn = byId("start-settings");
  const endOverlay = byId("end");
  const replayBtn = byId("replay-btn");
  const endBack = byId("end-back");
  const countdownEl = byId("countdown");
  const controls = byId("controls");
  const controlsClose = byId("controls-close");
  const settingsBtn = byId("settings-btn");
  const hudTitle = byId("hud-title");
  const hudProgress = byId("hud-progress");
  const hudSpeed = byId("hud-speed");
  const wpmInput = byId("wpm");
  const wpmValue = byId("wpm-value");
  const fontInput = byId("font");
  const fontValue = byId("font-value");
  const lineInput = byId("line");
  const lineValue = byId("line-value");
  const progressInput = byId("progress");
  const progressValue = byId("progress-value");
  const flipXBtn = byId("flip-x");
  const flipYBtn = byId("flip-y");
  const fullscreenBtn = byId("fullscreen-btn");
  const restartBtn = byId("restart-btn");
  const backBtn = byId("back-btn");
  const statusEl = byId("status");
  const wakeNote = byId("wake-note");
  const fullscreenHint = byId("fullscreen-hint");
  const themeButtons = Array.from(document.querySelectorAll("[data-theme-value]"));

  const cleanups = [];
  function on(target, type, handler, options) {
    target.addEventListener(type, handler, options);
    cleanups.push(() => target.removeEventListener(type, handler, options));
  }

  const paragraphs = script.paragraphs.map((item) => item.text);
  const units = script.paragraphs.map((item) => item.units);
  const total = units.reduce((sum, value) => sum + value, 0);
  const count = paragraphs.length;

  if (count === 0 || total <= 0) {
    throw new Error("稿件为空");
  }

  const wake = createWakeLock();
  const cum = [0];
  for (const value of units) {
    cum.push(cum[cum.length - 1] + value);
  }

  let tops = [];
  let charsRead = 0;
  let ready = false;
  let playing = false;
  let rafId = 0;
  let lastTs = 0;
  let counting = false;
  let countdownTimer = 0;
  let resizeTimer = 0;
  let remeasureRaf = 0;
  let progressWasPlaying = false;
  let dragging = false;
  let dragStartY = 0;
  let tapStart = null;
  let twoFinger = false;
  let lastTouchAt = 0;

  let wpm = clamp(Number(settings.wpm) || 220, 60, 600);
  let fontSize = clamp(Number(settings.fontSize) || 48, 32, 96);
  let lineHeight = clamp(Number(settings.lineHeight) || 1.6, 1.3, 2.0);
  let theme = ["dark", "light", "amber"].includes(settings.theme)
    ? settings.theme
    : "dark";
  let flipX = Boolean(settings.flipX);
  let flipY = Boolean(settings.flipY);
  let lineBox = fontSize * lineHeight;
  let maxY = 0;

  content.replaceChildren(
    ...paragraphs.map((text) => {
      const paragraph = document.createElement("p");
      paragraph.textContent = text;
      return paragraph;
    })
  );

  hudTitle.textContent = script.title;
  startTitle.textContent = script.title;
  startOverlay.hidden = false;
  endOverlay.hidden = true;
  countdownEl.hidden = true;
  controls.classList.remove("open");
  settingsBtn.hidden = true;
  settingsBtn.setAttribute("aria-expanded", "false");
  wakeNote.hidden = true;

  function updateHudSpeed() {
    hudSpeed.textContent = `速度 ${wpm} 字/分`;
  }

  function applyVisuals() {
    document.documentElement.style.setProperty("--font-size", `${fontSize}px`);
    document.documentElement.style.setProperty("--line-height", String(lineHeight));
    document.documentElement.dataset.theme = theme;

    lineBox = fontSize * lineHeight;
    document.documentElement.style.setProperty(
      "--focus-offset",
      `${lineBox / 2}px`
    );

    stage.classList.toggle("flip-x", flipX);
    stage.classList.toggle("flip-y", flipY);

    wpmInput.value = String(wpm);
    wpmValue.textContent = String(wpm);
    updateHudSpeed();
    fontInput.value = String(fontSize);
    fontValue.textContent = String(fontSize);
    lineInput.value = String(lineHeight);
    lineValue.textContent = lineHeight.toFixed(1);
    flipXBtn.classList.toggle("active", flipX);
    flipYBtn.classList.toggle("active", flipY);

    for (const button of themeButtons) {
      button.classList.toggle("active", button.dataset.themeValue === theme);
    }
  }

  function persist() {
    Object.assign(settings, {
      wpm,
      fontSize,
      lineHeight,
      theme,
      flipX,
      flipY,
    });
    saveSettings(settings);
  }

  function measure() {
    const items = Array.from(content.children);
    tops = new Array(count + 1);

    for (let i = 0; i < count; i += 1) {
      tops[i] = items[i].offsetTop;
    }

    const last = items[count - 1];
    tops[count] = last.offsetTop + last.offsetHeight;

    for (let i = 1; i < tops.length; i += 1) {
      if (tops[i] < tops[i - 1]) tops[i] = tops[i - 1];
    }

    maxY = Math.max(0, tops[count] - lineBox);
  }

  function mapCharsToY(chars) {
    if (chars <= 0) return tops[0];
    if (chars >= total) return maxY;

    let low = 0;
    let high = count - 1;
    while (low < high) {
      const mid = (low + high + 1) >> 1;
      if (cum[mid] <= chars) low = mid;
      else high = mid - 1;
    }

    const end = low === count - 1 ? Math.max(tops[low], maxY) : tops[low + 1];
    const span = cum[low + 1] - cum[low];
    const ratio = span > 0 ? (chars - cum[low]) / span : 0;
    return tops[low] + (end - tops[low]) * clamp(ratio, 0, 1);
  }

  function mapYToChars(y) {
    if (y <= tops[0]) return 0;
    if (y >= maxY) return total;

    let low = 0;
    let high = count - 1;
    while (low < high) {
      const mid = (low + high + 1) >> 1;
      if (tops[mid] <= y) low = mid;
      else high = mid - 1;
    }

    const end = low === count - 1 ? Math.max(tops[low], maxY) : tops[low + 1];
    const span = end - tops[low];
    const ratio = span > 0 ? (y - tops[low]) / span : 0;
    return cum[low] + (cum[low + 1] - cum[low]) * clamp(ratio, 0, 1);
  }

  function applyY() {
    const y = mapCharsToY(charsRead);
    content.style.transform = `translate3d(0, ${-y}px, 0)`;
  }

  function updateProgress() {
    const ratio = total > 0 ? charsRead / total : 0;
    const percent = Math.round(ratio * 100);
    hudProgress.textContent = `${percent}%`;
    progressInput.value = String(Math.round(ratio * 1000));
    progressValue.textContent = `${percent}% · ${Math.round(charsRead)}/${total}`;
  }

  function syncSettingsButton() {
    const visible = startOverlay.hidden && endOverlay.hidden && !counting;
    settingsBtn.hidden = !visible;
  }

  function setChars(chars) {
    charsRead = clamp(chars, 0, total);
    applyY();
    updateProgress();

    if (charsRead >= total) {
      if (playing) pause();
      endOverlay.hidden = false;
    } else if (!endOverlay.hidden) {
      endOverlay.hidden = true;
    }
    syncSettingsButton();
  }

  function tick(now) {
    if (!playing) return;

    const dt = Math.min((now - lastTs) / 1000, 0.1);
    lastTs = now;
    charsRead = Math.min(total, charsRead + (wpm / 60) * dt);
    applyY();
    updateProgress();

    if (charsRead >= total) {
      playing = false;
      rafId = 0;
      endOverlay.hidden = false;
      syncSettingsButton();
      return;
    }

    rafId = requestAnimationFrame(tick);
  }

  function startWake() {
    wake.start().then((ok) => {
      wakeNote.hidden = ok;
    });
  }

  function play() {
    if (!ready || playing || counting) return;
    startWake();
    if (charsRead >= total) setChars(0);
    endOverlay.hidden = true;
    syncSettingsButton();
    playing = true;
    lastTs = performance.now();
    cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(tick);
  }

  function pause() {
    if (!playing) return;
    playing = false;
    cancelAnimationFrame(rafId);
    rafId = 0;
  }

  function toggle() {
    if (counting) return;
    if (playing) pause();
    else play();
  }

  function begin() {
    if (!ready || counting) return;
    startWake();
    closeControls();
    if (charsRead >= total) setChars(0);
    endOverlay.hidden = true;
    startOverlay.hidden = true;
    counting = true;
    syncSettingsButton();

    let number = 3;
    countdownEl.textContent = String(number);
    countdownEl.hidden = false;
    clearInterval(countdownTimer);
    countdownTimer = window.setInterval(() => {
      number -= 1;
      if (number > 0) {
        countdownEl.textContent = String(number);
        return;
      }
      clearInterval(countdownTimer);
      countdownTimer = 0;
      countdownEl.hidden = true;
      counting = false;
      play();
    }, 1000);
  }

  function cancelCountdown() {
    if (!counting) return;
    clearInterval(countdownTimer);
    countdownTimer = 0;
    countdownEl.hidden = true;
    counting = false;
    startOverlay.hidden = false;
    syncSettingsButton();
  }

  function changeWpm(delta) {
    wpm = clamp(wpm + delta, 60, 600);
    wpmInput.value = String(wpm);
    wpmValue.textContent = String(wpm);
    updateHudSpeed();
    persist();
  }

  function openControls() {
    controls.classList.add("open");
    settingsBtn.classList.add("active");
    settingsBtn.setAttribute("aria-expanded", "true");
  }

  function closeControls() {
    controls.classList.remove("open");
    settingsBtn.classList.remove("active");
    settingsBtn.setAttribute("aria-expanded", "false");
  }

  function toggleControls() {
    if (controls.classList.contains("open")) closeControls();
    else openControls();
  }

  function remeasureSoon() {
    cancelAnimationFrame(remeasureRaf);
    remeasureRaf = requestAnimationFrame(() => {
      measure();
      applyY();
    });
  }

  function logicalPoint(touch) {
    const rect = stage.getBoundingClientRect();
    let x = touch.clientX - rect.left;
    let y = touch.clientY - rect.top;
    if (flipX) x = rect.width - x;
    if (flipY) y = rect.height - y;
    return { x, y, width: rect.width, height: rect.height };
  }

  function onTouchStart(event) {
    lastTouchAt = performance.now();

    if (isInteractive(event.target)) return;
    if (!ready || counting || !startOverlay.hidden || !endOverlay.hidden) return;
    if (controls.classList.contains("open")) {
      closeControls();
      return;
    }

    if (event.touches.length === 2) {
      event.preventDefault();
      twoFinger = true;
      toggleControls();
      return;
    }
    if (event.touches.length !== 1) return;

    event.preventDefault();
    const point = logicalPoint(event.touches[0]);
    tapStart = { x: point.x, y: point.y, at: performance.now() };
    dragging = false;
    if (!playing) {
      dragStartY = mapCharsToY(charsRead);
    }
  }

  function onTouchMove(event) {
    if (!tapStart || event.touches.length !== 1 || isInteractive(event.target)) {
      return;
    }

    const point = logicalPoint(event.touches[0]);
    const dx = point.x - tapStart.x;
    const dy = point.y - tapStart.y;

    if (!dragging && !playing && Math.hypot(dx, dy) > 10) {
      dragging = true;
    }
    if (!dragging) return;

    event.preventDefault();
    const nextY = clamp(dragStartY - dy, mapCharsToY(0), mapCharsToY(total));
    setChars(mapYToChars(nextY));
  }

  function onTouchEnd(event) {
    if (twoFinger) {
      twoFinger = false;
      tapStart = null;
      dragging = false;
      return;
    }

    if (isInteractive(event.target) || !tapStart) {
      tapStart = null;
      dragging = false;
      return;
    }
    if (!event.changedTouches.length) {
      tapStart = null;
      dragging = false;
      return;
    }

    const point = logicalPoint(event.changedTouches[0]);
    const dx = point.x - tapStart.x;
    const dy = point.y - tapStart.y;
    const moved = Math.hypot(dx, dy) > 10;
    const elapsed = performance.now() - tapStart.at;
    const wasTap = !dragging && !moved && elapsed < 500;

    tapStart = null;
    dragging = false;
    if (!wasTap) return;

    event.preventDefault();

    if (point.y < point.height * 0.05) {
      toggleControls();
      return;
    }
    if (point.x < point.width * 0.25) {
      changeWpm(-20);
    } else if (point.x > point.width * 0.75) {
      changeWpm(20);
    } else {
      toggle();
    }
  }

  function onStageClick(event) {
    if (performance.now() - lastTouchAt < 700) return;
    if (isInteractive(event.target)) return;
    if (!ready || counting || !startOverlay.hidden || !endOverlay.hidden) return;
    if (controls.classList.contains("open")) {
      closeControls();
      return;
    }

    const point = logicalPoint(event);
    if (point.y < point.height * 0.05) {
      toggleControls();
      return;
    }
    if (point.x < point.width * 0.25) {
      changeWpm(-20);
    } else if (point.x > point.width * 0.75) {
      changeWpm(20);
    } else {
      toggle();
    }
  }

  on(startBtn, "click", begin);
  on(startSettingsBtn, "click", openControls);
  on(settingsBtn, "click", (event) => {
    event.stopPropagation();
    toggleControls();
  });
  on(replayBtn, "click", () => {
    endOverlay.hidden = true;
    setChars(0);
    begin();
  });

  on(wpmInput, "input", () => {
    wpm = clamp(Number(wpmInput.value) || 220, 60, 600);
    wpmValue.textContent = String(wpm);
    updateHudSpeed();
    persist();
  });

  on(fontInput, "input", () => {
    fontSize = clamp(Number(fontInput.value) || 48, 32, 96);
    applyVisuals();
    persist();
    remeasureSoon();
  });

  on(lineInput, "input", () => {
    lineHeight = clamp(Number(lineInput.value) || 1.6, 1.3, 2.0);
    applyVisuals();
    persist();
    remeasureSoon();
  });

  for (const button of themeButtons) {
    on(button, "click", () => {
      theme = button.dataset.themeValue || "dark";
      document.documentElement.dataset.theme = theme;
      applyVisuals();
      persist();
    });
  }

  on(flipXBtn, "click", () => {
    flipX = !flipX;
    stage.classList.toggle("flip-x", flipX);
    flipXBtn.classList.toggle("active", flipX);
    persist();
  });

  on(flipYBtn, "click", () => {
    flipY = !flipY;
    stage.classList.toggle("flip-y", flipY);
    flipYBtn.classList.toggle("active", flipY);
    persist();
  });

  on(progressInput, "input", () => {
    if (playing) {
      progressWasPlaying = true;
      pause();
    }
    setChars((Number(progressInput.value) / 1000) * total);
  });

  on(progressInput, "change", () => {
    if (!progressWasPlaying) return;
    progressWasPlaying = false;
    if (charsRead < total) play();
  });

  on(restartBtn, "click", () => {
    setChars(0);
    if (playing) {
      lastTs = performance.now();
    } else {
      play();
    }
    closeControls();
  });

  const canFullscreen =
    Boolean(document.documentElement.requestFullscreen) &&
    !/iPad|iPhone|iPod/.test(navigator.userAgent);
  if (!canFullscreen) {
    fullscreenBtn.hidden = true;
    fullscreenHint.hidden = false;
  }

  on(fullscreenBtn, "click", async () => {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await document.documentElement.requestFullscreen();
      }
    } catch {
      // Browser refused the request; leave the layout as it is.
    }
  });

  function goLibrary() {
    location.hash = "#/";
  }

  on(controlsClose, "click", closeControls);
  on(backBtn, "click", goLibrary);
  on(endBack, "click", goLibrary);

  on(document, "teleprompter:guide-open", () => {
    pause();
    cancelCountdown();
  });

  on(stage, "touchstart", onTouchStart, { passive: false });
  on(stage, "touchmove", onTouchMove, { passive: false });
  on(stage, "touchend", onTouchEnd, { passive: false });
  on(stage, "touchcancel", () => {
    tapStart = null;
    dragging = false;
    twoFinger = false;
  });
  on(stage, "click", onStageClick);

  on(window, "keydown", (event) => {
    if (event.defaultPrevented) return;
    if (document.documentElement.dataset.guide === "open") return;
    if (!ready) return;

    if (event.code === "Escape" && controls.classList.contains("open")) {
      event.preventDefault();
      closeControls();
      return;
    }

    if (
      event.target instanceof Element &&
      event.target.closest("input, .controls")
    ) {
      return;
    }

    if (!startOverlay.hidden) {
      if (event.code === "Space") {
        event.preventDefault();
        begin();
      }
      return;
    }

    if (!endOverlay.hidden) {
      if (event.code === "Space") {
        event.preventDefault();
        replayBtn.click();
      }
      return;
    }

    if (counting) return;

    switch (event.code) {
      case "Space":
        event.preventDefault();
        toggle();
        break;
      case "ArrowUp":
        event.preventDefault();
        changeWpm(10);
        break;
      case "ArrowDown":
        event.preventDefault();
        changeWpm(-10);
        break;
      case "ArrowLeft":
        event.preventDefault();
        setChars(charsRead - (wpm / 60) * 5);
        break;
      case "ArrowRight":
        event.preventDefault();
        setChars(charsRead + (wpm / 60) * 5);
        break;
      case "KeyF":
        fullscreenBtn.click();
        break;
      case "KeyM":
        flipXBtn.click();
        break;
      default:
        break;
    }
  });

  on(window, "resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(remeasureSoon, 180);
  });

  on(document, "fullscreenchange", remeasureSoon);

  on(document, "visibilitychange", () => {
    if (document.hidden) {
      pause();
      cancelCountdown();
      wake.stop();
    }
  });

  function destroy() {
    for (const cleanup of cleanups) cleanup();
    cleanups.length = 0;
    pause();
    clearInterval(countdownTimer);
    clearTimeout(resizeTimer);
    cancelAnimationFrame(rafId);
    cancelAnimationFrame(remeasureRaf);
    wake.destroy();
    wakeNote.hidden = true;
    content.replaceChildren();
  }

  applyVisuals();
  if (document.fonts?.ready) {
    await document.fonts.ready;
  }
  await new Promise((resolve) => requestAnimationFrame(resolve));
  measure();
  setChars(0);
  ready = true;
  statusEl.hidden = true;

  return { destroy };
}

import {
  createScript,
  deleteScript,
  listScripts,
  updateScript,
} from "./api.js";

const MAX_UPLOAD = 10 * 1024 * 1024;
const ALLOWED = /\.(md|markdown|txt|docx)$/i;

const listEl = document.querySelector("#script-list");
const emptyEl = document.querySelector("#lib-empty");
const statusEl = document.querySelector("#lib-status");
const toastEl = document.querySelector("#toast");
const dropZone = document.querySelector("#drop-zone");
const uploadBtn = document.querySelector("#upload-btn");
const pasteBtn = document.querySelector("#paste-btn");
const fileInput = document.querySelector("#file-input");

const pasteModal = document.querySelector("#paste-modal");
const pasteTitle = document.querySelector("#paste-title");
const pasteText = document.querySelector("#paste-text");
const pasteError = document.querySelector("#paste-error");
const pasteSave = document.querySelector("#paste-save");
const pasteCancel = document.querySelector("#paste-cancel");

const renameModal = document.querySelector("#rename-modal");
const renameInput = document.querySelector("#rename-input");
const renameError = document.querySelector("#rename-error");
const renameSave = document.querySelector("#rename-save");
const renameCancel = document.querySelector("#rename-cancel");

let toastTimer = 0;
let busy = false;
let renamingId = null;

function setStatus(message) {
  statusEl.textContent = message;
}

function showToast(message, kind = "ok") {
  toastEl.textContent = message;
  toastEl.className = kind === "error" ? "toast error" : "toast";
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    toastEl.hidden = true;
  }, 3200);
}

function setBusy(value) {
  busy = value;
  uploadBtn.disabled = value;
  pasteBtn.disabled = value;
  pasteSave.disabled = value;
  renameSave.disabled = value;
}

function formatChars(value) {
  return new Intl.NumberFormat("zh-CN").format(Number(value) || 0);
}

function formatDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function openScript(id) {
  location.hash = "#/play/" + encodeURIComponent(id);
}

function createRow(row) {
  const item = document.createElement("li");
  item.className = "script-row";
  item.tabIndex = 0;
  item.setAttribute("role", "button");
  item.setAttribute("aria-label", `打开 ${row.title}`);

  const main = document.createElement("div");
  main.className = "script-main";
  const title = document.createElement("h2");
  title.textContent = row.title;
  const meta = document.createElement("p");
  meta.className = "script-meta";
  meta.textContent = `${formatChars(row.chars)} 字 · ${formatDate(row.updated_at)}`;
  main.append(title, meta);

  const actions = document.createElement("div");
  actions.className = "script-actions";

  const rename = document.createElement("button");
  rename.type = "button";
  rename.className = "ghost";
  rename.textContent = "重命名";
  rename.addEventListener("click", (event) => {
    event.stopPropagation();
    openRename(row);
  });

  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "ghost";
  remove.textContent = "删除";
  remove.addEventListener("click", (event) => {
    event.stopPropagation();
    removeScript(row);
  });

  actions.append(rename, remove);
  item.append(main, actions);

  item.addEventListener("click", () => openScript(row.id));
  item.addEventListener("keydown", (event) => {
    if (event.target !== item) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openScript(row.id);
    }
  });

  return item;
}

function renderRows(rows) {
  listEl.replaceChildren(...rows.map(createRow));
  listEl.hidden = rows.length === 0;
  emptyEl.hidden = rows.length > 0;
}

export async function refreshLibrary() {
  setStatus("加载中…");
  try {
    const rows = await listScripts();
    renderRows(rows);
    setStatus("");
  } catch (error) {
    setStatus(`加载失败：${error.message}`);
    showToast(`加载失败：${error.message}`, "error");
  }
}

async function uploadFile(file) {
  if (!file || busy) return;

  const name = file.name || "";
  if (/\.doc$/i.test(name)) {
    showToast("旧版 .doc 不支持，请另存为 .docx", "error");
    return;
  }
  if (!ALLOWED.test(name)) {
    showToast("只支持 .md / .txt / .docx", "error");
    return;
  }
  if (file.size > MAX_UPLOAD) {
    showToast("文件超过 10MB", "error");
    return;
  }

  setBusy(true);
  setStatus(`上传中：${name}`);
  try {
    await createScript({ file });
    await refreshLibrary();
    showToast("已上传");
  } catch (error) {
    setStatus("");
    showToast(`上传失败：${error.message}`, "error");
  } finally {
    setBusy(false);
    fileInput.value = "";
  }
}

function openPaste() {
  if (busy) return;
  pasteTitle.value = "";
  pasteText.value = "";
  pasteError.hidden = true;
  pasteModal.hidden = false;
  pasteTitle.focus();
}

function closePaste() {
  pasteModal.hidden = true;
}

async function savePaste() {
  if (busy) return;
  const text = pasteText.value;
  if (!text.trim()) {
    pasteError.textContent = "正文不能为空";
    pasteError.hidden = false;
    return;
  }

  pasteError.hidden = true;
  setBusy(true);
  try {
    const created = await createScript({
      text,
      title: pasteTitle.value.trim() || undefined,
    });
    closePaste();
    showToast("已保存");
    openScript(created.id);
  } catch (error) {
    pasteError.textContent = error.message;
    pasteError.hidden = false;
  } finally {
    setBusy(false);
  }
}

function openRename(row) {
  if (busy) return;
  renamingId = row.id;
  renameInput.value = row.title;
  renameError.hidden = true;
  renameModal.hidden = false;
  renameInput.focus();
  renameInput.select();
}

function closeRename() {
  renameModal.hidden = true;
  renamingId = null;
}

async function saveRename() {
  if (!renamingId) return;
  const title = renameInput.value.trim();
  if (!title) {
    renameError.textContent = "标题不能为空";
    renameError.hidden = false;
    return;
  }

  renameError.hidden = true;
  setBusy(true);
  try {
    await updateScript(renamingId, { title });
    closeRename();
    await refreshLibrary();
    showToast("已重命名");
  } catch (error) {
    renameError.textContent = error.message;
    renameError.hidden = false;
  } finally {
    setBusy(false);
  }
}

async function removeScript(row) {
  if (busy) return;
  if (!window.confirm(`删除「${row.title}」？此操作不可撤销。`)) return;

  setBusy(true);
  try {
    await deleteScript(row.id);
    await refreshLibrary();
    showToast("已删除");
  } catch (error) {
    showToast(`删除失败：${error.message}`, "error");
  } finally {
    setBusy(false);
  }
}

export function initLibrary() {
  uploadBtn.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", () => {
    uploadFile(fileInput.files && fileInput.files[0]);
  });
  pasteBtn.addEventListener("click", openPaste);
  pasteCancel.addEventListener("click", closePaste);
  pasteSave.addEventListener("click", savePaste);
  renameCancel.addEventListener("click", closeRename);
  renameSave.addEventListener("click", saveRename);

  pasteModal.addEventListener("click", (event) => {
    if (event.target === pasteModal) closePaste();
  });
  renameModal.addEventListener("click", (event) => {
    if (event.target === renameModal) closeRename();
  });

  dropZone.addEventListener("dragover", (event) => {
    event.preventDefault();
    dropZone.classList.add("dragover");
  });
  dropZone.addEventListener("dragleave", () => {
    dropZone.classList.remove("dragover");
  });
  dropZone.addEventListener("drop", (event) => {
    event.preventDefault();
    dropZone.classList.remove("dragover");
    const file = event.dataTransfer?.files?.[0];
    if (file) uploadFile(file);
  });

  document.addEventListener("dragover", (event) => event.preventDefault());
  document.addEventListener("drop", (event) => event.preventDefault());
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (!pasteModal.hidden) closePaste();
    if (!renameModal.hidden) closeRename();
  });
}

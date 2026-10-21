function goToLogin() {
  const next = encodeURIComponent(
    location.pathname + location.search + location.hash
  );
  location.replace(`/login?next=${next}`);
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, { cache: "no-store", ...options });
  if (response.status === 401) {
    goToLogin();
    throw new Error("登录已过期，请重新输入密码");
  }
  if (!response.ok) {
    let detail = "";
    try {
      detail = (await response.json()).detail;
    } catch {
      // Not every error is JSON; fall back to the status code.
    }
    throw new Error(detail || `HTTP ${response.status}`);
  }
  if (response.status === 204) return null;
  return response.json();
}

export function listScripts() {
  return requestJson("/api/scripts");
}

export function getScript(id) {
  return requestJson(`/api/scripts/${encodeURIComponent(id)}`);
}

export function createScript({ file, text, title } = {}) {
  const form = new FormData();
  if (file) form.append("file", file);
  if (text != null) form.append("text", text);
  if (title) form.append("title", title);
  return requestJson("/api/scripts", { method: "POST", body: form });
}

export function updateScript(id, patch) {
  return requestJson(`/api/scripts/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
}

export function deleteScript(id) {
  return requestJson(`/api/scripts/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

export function logout() {
  return requestJson("/api/logout", { method: "POST" });
}

"use strict";

const BUTTON_ID = "forkclone-button";
const CONFIRM_ID = "forkclone-confirm";
const STYLE_ID = "forkclone-style";

const RESERVED_FIRST_SEGMENTS = new Set([
  "settings", "notifications", "explore", "topics", "trending", "marketplace",
  "pulls", "issues", "codespaces", "sponsors", "orgs", "apps", "login", "join",
  "features", "about", "pricing", "new", "search", "collections", "events"
]);

const POSITIONS = {
  "bottom-right": { bottom: "20px", right: "20px" },
  "bottom-left":  { bottom: "20px", left: "20px" },
  "top-right":    { top: "72px", right: "20px" },
  "top-left":     { top: "72px", left: "20px" }
};

let state = "idle"; // idle | confirm | running | done | error | setup
let revertTimer = null;
let cachedUsername = null;
let cachedPosition = "bottom-right";
let lastPathname = location.pathname;

function parseRepoFromPath() {
  const parts = location.pathname.split("/").filter(Boolean);
  if (parts.length < 2) return null;
  if (RESERVED_FIRST_SEGMENTS.has(parts[0].toLowerCase())) return null;
  return { owner: parts[0], repo: parts[1] };
}

function isDarkTheme() {
  const mode = document.documentElement.getAttribute("data-color-mode");
  if (mode === "dark") return true;
  if (mode === "auto") return window.matchMedia("(prefers-color-scheme: dark)").matches;
  return false;
}

function ensureStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = [
    "#" + BUTTON_ID + " { transition: transform .15s ease, box-shadow .15s ease, background .2s ease; }",
    "#" + BUTTON_ID + ":hover:not(:disabled) { transform: translateY(-2px); box-shadow: 0 8px 20px rgba(0,0,0,.45); }",
    "#" + BUTTON_ID + ":active:not(:disabled) { transform: translateY(0); }",
    "@keyframes forkclone-pulse { 50% { opacity: .55; } }",
    "#" + BUTTON_ID + ".running { animation: forkclone-pulse 1.2s ease-in-out infinite; cursor: progress; }",
    "#" + CONFIRM_ID + " { position: fixed; z-index: 9999; display: flex; align-items: center; gap: 10px;" +
      " padding: 10px 14px; border-radius: 14px; box-shadow: 0 8px 24px rgba(0,0,0,.4);" +
      " font: 500 13px -apple-system, 'Segoe UI', system-ui, sans-serif; max-width: 420px; }",
    "#" + CONFIRM_ID + " button { padding: 6px 14px; border-radius: 999px; cursor: pointer;" +
      " font: 600 12px -apple-system, 'Segoe UI', system-ui, sans-serif; transition: filter .15s ease; }",
    "#" + CONFIRM_ID + " button:hover { filter: brightness(1.15); }"
  ].join("\n");
  document.head.appendChild(style);
}

function applyPosition(btn) {
  btn.style.top = "";
  btn.style.right = "";
  btn.style.bottom = "";
  btn.style.left = "";
  const pos = POSITIONS[cachedPosition] || POSITIONS["bottom-right"];
  for (const side in pos) btn.style[side] = pos[side];
}

function baseStyle(btn) {
  const dark = isDarkTheme();
  btn.style.cssText = [
    "position: fixed", "z-index: 9999",
    "padding: 9px 18px", "border-radius: 999px",
    "font: 600 13px -apple-system, 'Segoe UI', system-ui, sans-serif",
    "cursor: pointer", "max-width: 380px", "overflow: hidden",
    "text-overflow: ellipsis", "white-space: nowrap",
    "box-shadow: 0 4px 12px rgba(0,0,0,0.35)",
    dark ? "background: #21262d" : "background: #f6f8fa",
    dark ? "color: #e6edf3" : "color: #24292f",
    dark ? "border: 1px solid #30363d" : "border: 1px solid #d0d7de"
  ].join(";");
  applyPosition(btn);
}

function setVisual(btn, kind) {
  baseStyle(btn);
  if (kind === "success") {
    btn.style.background = "#238636";
    btn.style.borderColor = "#2ea043";
    btn.style.color = "#ffffff";
  } else if (kind === "failure") {
    btn.style.background = "#da3633";
    btn.style.borderColor = "#f85149";
    btn.style.color = "#ffffff";
  }
}

function idleLabel() {
  const info = parseRepoFromPath();
  const isOwn = info && cachedUsername && info.owner.toLowerCase() === cachedUsername.toLowerCase();
  return isOwn ? "⚡ Clone" : "⚡ Fork & Clone";
}

function setIdle(btn) {
  state = "idle";
  btn.disabled = false;
  btn.classList.remove("running");
  btn.title = "";
  btn.textContent = idleLabel();
  setVisual(btn, "neutral");
}

function scheduleRevert(btn, ms) {
  clearTimeout(revertTimer);
  revertTimer = setTimeout(() => {
    const current = document.getElementById(BUTTON_ID);
    if (current) setIdle(current);
  }, ms);
}

function showError(btn, code, message) {
  btn.classList.remove("running");
  if (code === "NO_SETTINGS") {
    state = "setup";
    btn.disabled = false;
    btn.textContent = "⚙ Setup needed — click";
    btn.title = message || "Open the extension options to set your token and folder.";
    setVisual(btn, "neutral");
    return;
  }
  state = "error";
  btn.disabled = false;
  btn.textContent = "✗ " + String(message || code || "Failed").slice(0, 60);
  btn.title = message || code;
  setVisual(btn, "failure");
  scheduleRevert(btn, 12000);
}

function showDone(btn, path) {
  state = "done";
  btn.disabled = false;
  btn.classList.remove("running");
  btn.textContent = "✓ Cloned to " + path;
  btn.title = path;
  setVisual(btn, "success");
  scheduleRevert(btn, 8000);
}

function startFlow(btn) {
  const info = parseRepoFromPath();
  if (!info) return;
  state = "running";
  btn.disabled = true;
  btn.classList.add("running");
  btn.title = "";
  setVisual(btn, "neutral");
  btn.textContent = "Starting…";

  const port = chrome.runtime.connect({ name: "forkclone" });
  port.onMessage.addListener((msg) => {
    const current = document.getElementById(BUTTON_ID) || btn;
    if (msg.status === "progress") {
      current.textContent = msg.text;
    } else if (msg.status === "done") {
      showDone(current, msg.path);
      port.disconnect();
    } else if (msg.status === "error") {
      showError(current, msg.code, msg.message);
      port.disconnect();
    }
  });
  port.onDisconnect.addListener(() => {
    if (state === "running") {
      const current = document.getElementById(BUTTON_ID);
      if (current) showError(current, "DISCONNECTED", "Extension was reloaded mid-operation — try again.");
    }
  });
  port.postMessage({ owner: info.owner, repo: info.repo });
}

function removeConfirm() {
  const panel = document.getElementById(CONFIRM_ID);
  if (panel) panel.remove();
  const btn = document.getElementById(BUTTON_ID);
  if (btn) btn.style.display = "";
  if (state === "confirm") state = "idle";
}

function showConfirm(btn) {
  const info = parseRepoFromPath();
  if (!info) return;
  state = "confirm";
  btn.style.display = "none";

  const dark = isDarkTheme();
  const isOwn = cachedUsername && info.owner.toLowerCase() === cachedUsername.toLowerCase();
  const panel = document.createElement("div");
  panel.id = CONFIRM_ID;
  panel.style.background = dark ? "#21262d" : "#ffffff";
  panel.style.color = dark ? "#e6edf3" : "#24292f";
  panel.style.border = "1px solid " + (dark ? "#30363d" : "#d0d7de");

  const label = document.createElement("span");
  label.textContent = (isOwn ? "Clone " : "Fork & clone ") + info.owner + "/" + info.repo + "?";
  label.style.cssText = "overflow: hidden; text-overflow: ellipsis; white-space: nowrap;";

  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.textContent = "Cancel";
  cancel.style.background = "transparent";
  cancel.style.color = dark ? "#e6edf3" : "#24292f";
  cancel.style.border = "1px solid " + (dark ? "#30363d" : "#d0d7de");

  const confirm = document.createElement("button");
  confirm.type = "button";
  confirm.textContent = isOwn ? "⚡ Clone" : "⚡ Fork & Clone";
  confirm.style.background = "#238636";
  confirm.style.color = "#ffffff";
  confirm.style.border = "1px solid #2ea043";

  cancel.addEventListener("click", () => {
    clearTimeout(revertTimer);
    removeConfirm();
    setIdle(btn);
  });
  confirm.addEventListener("click", () => {
    clearTimeout(revertTimer);
    removeConfirm();
    startFlow(btn);
  });

  panel.appendChild(label);
  panel.appendChild(cancel);
  panel.appendChild(confirm);
  document.body.appendChild(panel);
  applyPosition(panel);

  clearTimeout(revertTimer);
  revertTimer = setTimeout(() => {
    removeConfirm();
    const current = document.getElementById(BUTTON_ID);
    if (current) setIdle(current);
  }, 12000);
}

function onButtonClick(event) {
  const btn = event.currentTarget;
  if (state === "running") return; // ignore rapid double-clicks
  if (state === "setup") {
    chrome.runtime.sendMessage({ type: "openOptions" });
    return;
  }
  clearTimeout(revertTimer);
  showConfirm(btn);
}

function injectOrRemoveButton() {
  const info = parseRepoFromPath();
  const existing = document.getElementById(BUTTON_ID);
  if (!info) {
    if (existing) existing.remove();
    return;
  }
  if (existing) {
    if (state === "idle") existing.textContent = idleLabel();
    return;
  }
  ensureStyles();
  const btn = document.createElement("button");
  btn.id = BUTTON_ID;
  btn.type = "button";
  btn.addEventListener("click", onButtonClick);
  document.body.appendChild(btn);
  setIdle(btn);
}

function onSoftNavigation() {
  if (location.pathname === lastPathname) {
    injectOrRemoveButton();
    return;
  }
  lastPathname = location.pathname;
  removeConfirm();
  if (state !== "running") state = "idle";
  clearTimeout(revertTimer);
  injectOrRemoveButton();
}

chrome.storage.local.get(["username", "buttonPosition"]).then((items) => {
  cachedUsername = items.username || null;
  if (items.buttonPosition) cachedPosition = items.buttonPosition;
  injectOrRemoveButton();
  const btn = document.getElementById(BUTTON_ID);
  if (btn) applyPosition(btn);
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  const btn = document.getElementById(BUTTON_ID);
  if (changes.username) {
    cachedUsername = changes.username.newValue || null;
    if (btn && state === "idle") btn.textContent = idleLabel();
  }
  if (changes.buttonPosition) {
    cachedPosition = changes.buttonPosition.newValue || "bottom-right";
    if (btn) applyPosition(btn);
  }
});

// GitHub soft-navigates (Turbo). Listen to its events, plus a 1-second
// polling fallback because Turbo event names have changed across deploys.
document.addEventListener("turbo:load", onSoftNavigation);
window.addEventListener("popstate", onSoftNavigation);
setInterval(onSoftNavigation, 1000);

injectOrRemoveButton();

"use strict";

const BUTTON_ID = "forkclone-button";
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

let state = "idle"; // idle | running | done | error | setup
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
    "#" + BUTTON_ID + ".running { animation: forkclone-pulse 1.2s ease-in-out infinite; cursor: progress; }"
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

function onButtonClick(event) {
  const btn = event.currentTarget;
  if (state === "running") return; // ignore rapid double-clicks
  if (state === "setup") {
    chrome.runtime.sendMessage({ type: "openOptions" });
    return;
  }
  clearTimeout(revertTimer);
  startFlow(btn);
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

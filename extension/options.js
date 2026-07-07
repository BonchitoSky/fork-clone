"use strict";

const tokenInput = document.getElementById("token");
const folderInput = document.getElementById("targetFolder");
const button = document.getElementById("testSave");
const results = document.getElementById("results");
const posGrid = document.getElementById("posGrid");

const WINDOWS_ABS_PATH = /^[A-Za-z]:\\/;
let selectedPosition = "bottom-right";

chrome.storage.local.get(["token", "targetFolder", "buttonPosition"]).then((items) => {
  if (items.token) tokenInput.value = items.token;
  if (items.targetFolder) folderInput.value = items.targetFolder;
  if (items.buttonPosition) selectPosition(items.buttonPosition);
});

function selectPosition(pos) {
  selectedPosition = pos;
  for (const opt of posGrid.querySelectorAll(".pos-opt")) {
    opt.classList.toggle("selected", opt.dataset.pos === pos);
  }
}

posGrid.addEventListener("click", (e) => {
  const opt = e.target.closest(".pos-opt");
  if (!opt) return;
  selectPosition(opt.dataset.pos);
  // Save immediately so an open GitHub tab moves the button live.
  chrome.storage.local.set({ buttonPosition: selectedPosition });
});

function row(ok, text) {
  const div = document.createElement("div");
  div.className = "row " + (ok ? "ok" : "bad");
  const mark = document.createElement("span");
  mark.className = "mark";
  mark.textContent = ok ? "✓" : "✗";
  const body = document.createElement("span");
  body.textContent = text;
  div.append(mark, body);
  return div;
}

async function checkToken(token) {
  if (!token) return { ok: false, text: "Token: none entered" };
  try {
    const res = await fetch("https://api.github.com/user", {
      headers: {
        "Authorization": "Bearer " + token,
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28"
      }
    });
    if (!res.ok) return { ok: false, text: "Token: GitHub answered " + res.status + " — check the token and its 'repo' scope" };
    const body = await res.json();
    return { ok: true, text: "Token: valid — signed in as " + body.login, username: body.login };
  } catch (e) {
    return { ok: false, text: "Token: network error — " + e.message };
  }
}

function checkCompanion() {
  return new Promise((resolve) => {
    chrome.runtime.sendNativeMessage("com.forkclone.host", { ping: true }, (reply) => {
      if (chrome.runtime.lastError) {
        resolve({ ok: false, text: "Companion: not responding — " + chrome.runtime.lastError.message + " (run companion\\install.bat, then restart Chrome)" });
      } else if (reply && reply.pong) {
        const git = reply.git ? reply.git : "git NOT found — install from git-scm.com/download/win";
        resolve({ ok: !!reply.git, text: "Companion: responding — " + git });
      } else {
        resolve({ ok: false, text: "Companion: unexpected reply" });
      }
    });
  });
}

function checkFolder(folder) {
  if (WINDOWS_ABS_PATH.test(folder)) return { ok: true, text: "Folder path: looks valid (" + folder + ")" };
  return { ok: false, text: "Folder path: must be an absolute Windows path like C:\\Users\\you\\Code" };
}

async function testAndSave() {
  button.disabled = true;
  results.className = "visible";
  results.textContent = "Testing…";
  const token = tokenInput.value.trim();
  const folder = folderInput.value.trim();

  const folderCheck = checkFolder(folder);
  const [tokenCheck, companionCheck] = await Promise.all([checkToken(token), checkCompanion()]);

  const toSave = { token, targetFolder: folder, buttonPosition: selectedPosition };
  if (tokenCheck.username) toSave.username = tokenCheck.username;
  await chrome.storage.local.set(toSave);

  const allOk = tokenCheck.ok && companionCheck.ok && folderCheck.ok;
  const summary = document.createElement("p");
  summary.className = "summary " + (allOk ? "ok" : "bad");
  summary.textContent = allOk
    ? "Saved. You're ready — open any GitHub repo and click the button."
    : "Saved, but fix the ✗ items above before using the button.";
  results.replaceChildren(
    row(tokenCheck.ok, tokenCheck.text),
    row(companionCheck.ok, companionCheck.text),
    row(folderCheck.ok, folderCheck.text),
    summary
  );
  button.disabled = false;
}

button.addEventListener("click", () => {
  testAndSave().catch((e) => {
    results.className = "visible";
    results.replaceChildren(row(false, "Unexpected error: " + e.message));
    button.disabled = false;
  });
});

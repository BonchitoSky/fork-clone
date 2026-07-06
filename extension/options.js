"use strict";

const tokenInput = document.getElementById("token");
const folderInput = document.getElementById("targetFolder");
const button = document.getElementById("testSave");
const results = document.getElementById("results");

const WINDOWS_ABS_PATH = /^[A-Za-z]:\\/;

chrome.storage.local.get(["token", "targetFolder"]).then((items) => {
  if (items.token) tokenInput.value = items.token;
  if (items.targetFolder) folderInput.value = items.targetFolder;
});

function line(ok, text) {
  const cls = ok ? "ok" : "bad";
  const mark = ok ? "✓" : "✗";
  return '<span class="' + cls + '">' + mark + " " + text + "</span><br>";
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
  results.innerHTML = "Testing…";
  const token = tokenInput.value.trim();
  const folder = folderInput.value.trim();

  const folderCheck = checkFolder(folder);
  const [tokenCheck, companionCheck] = await Promise.all([checkToken(token), checkCompanion()]);

  const toSave = { token, targetFolder: folder };
  if (tokenCheck.username) toSave.username = tokenCheck.username;
  await chrome.storage.local.set(toSave);

  results.innerHTML =
    line(tokenCheck.ok, tokenCheck.text) +
    line(companionCheck.ok, companionCheck.text) +
    line(folderCheck.ok, folderCheck.text) +
    (tokenCheck.ok && companionCheck.ok && folderCheck.ok
      ? '<br><span class="ok">Saved. You\'re ready — open any GitHub repo and click the button.</span>'
      : '<br><span class="bad">Saved, but fix the ✗ items above before using the button.</span>');
  button.disabled = false;
}

button.addEventListener("click", () => {
  testAndSave().catch((e) => {
    results.innerHTML = line(false, "Unexpected error: " + e.message);
    button.disabled = false;
  });
});

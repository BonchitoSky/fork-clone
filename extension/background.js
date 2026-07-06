"use strict";

const GITHUB_API = "https://api.github.com";
const NATIVE_HOST = "com.forkclone.host";

chrome.runtime.onMessage.addListener((msg) => {
  if (msg && msg.type === "openOptions") chrome.runtime.openOptionsPage();
});

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "forkclone") return;
  port.onMessage.addListener((msg) => {
    if (msg && msg.owner && msg.repo) runForkClone(port, msg.owner, msg.repo);
  });
});

function post(port, msg) {
  try {
    port.postMessage(msg);
  } catch (e) {
    // Content script navigated away; the operation itself continues.
  }
}

function ghHeaders(token) {
  return {
    "Authorization": "Bearer " + token,
    "Accept": "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28"
  };
}

async function ghFetch(token, path, options) {
  const res = await fetch(GITHUB_API + path, Object.assign({}, options, { headers: ghHeaders(token) }));
  let body = null;
  try { body = await res.json(); } catch (e) { body = null; }
  return { res, body };
}

function apiError(res, body) {
  const detail = body && body.message ? body.message : JSON.stringify(body || "").slice(0, 200);
  return "GitHub API " + res.status + ": " + detail;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sendNative(payload) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendNativeMessage(NATIVE_HOST, payload, (reply) => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve(reply);
    });
  });
}

async function resolveUsername(token) {
  const stored = await chrome.storage.local.get("username");
  if (stored.username) return stored.username;
  const { res, body } = await ghFetch(token, "/user");
  if (res.status === 401) throw { code: "BAD_TOKEN", message: "Token rejected (401) — create a new one in options." };
  if (!res.ok) throw { code: "BAD_TOKEN", message: apiError(res, body) };
  await chrome.storage.local.set({ username: body.login });
  return body.login;
}

async function forkRepo(token, owner, repo, username) {
  const { res, body } = await ghFetch(token, "/repos/" + owner + "/" + repo + "/forks", {
    method: "POST",
    body: "{}"
  });
  if (res.ok || res.status === 202) {
    return (body && body.full_name) ? body.full_name : username + "/" + repo;
  }
  const msg = (body && body.message) ? body.message : "";
  if (/already exists/i.test(msg)) return username + "/" + repo; // pre-existing fork is success
  throw { code: "FORK_FAILED", message: apiError(res, body) };
}

// Forking is asynchronous on GitHub's side: the fork API returns before the
// git data exists. Poll the fork repo until it answers 200 with a default
// branch; even then huge repos can lag, which the companion's clone retries
// absorb.
async function waitForForkReady(token, forkFullName, port) {
  for (let attempt = 1; attempt <= 20; attempt++) {
    const { res, body } = await ghFetch(token, "/repos/" + forkFullName);
    if (res.ok && body && body.default_branch && body.size >= 0) return body;
    post(port, { status: "progress", text: "Waiting for fork… (" + attempt + "/20)" });
    await sleep(1500);
  }
  throw { code: "FORK_TIMEOUT", message: "GitHub is still creating the fork — click again in a minute." };
}

async function getRepoInfo(token, fullName) {
  const { res, body } = await ghFetch(token, "/repos/" + fullName);
  if (!res.ok) throw { code: "CLONE_FAILED", message: apiError(res, body) };
  return body;
}

async function runForkClone(port, owner, repo) {
  // Defensive keepalive: extension API activity resets the MV3 service
  // worker's idle timer while a long native-host clone is pending.
  const keepAlive = setInterval(() => chrome.runtime.getPlatformInfo(() => {}), 20000);
  try {
    const settings = await chrome.storage.local.get(["token", "targetFolder"]);
    if (!settings.token || !settings.targetFolder) {
      post(port, { status: "error", code: "NO_SETTINGS", message: "Set your GitHub token and target folder in the extension options." });
      return;
    }
    const username = await resolveUsername(settings.token);

    let forkInfo;
    if (owner.toLowerCase() === username.toLowerCase()) {
      post(port, { status: "progress", text: "Preparing clone…" });
      forkInfo = await getRepoInfo(settings.token, owner + "/" + repo);
    } else {
      post(port, { status: "progress", text: "Forking…" });
      const forkFullName = await forkRepo(settings.token, owner, repo, username);
      post(port, { status: "progress", text: "Waiting for fork…" });
      forkInfo = await waitForForkReady(settings.token, forkFullName, port);
    }

    post(port, { status: "progress", text: "Cloning…" });
    let reply;
    try {
      reply = await sendNative({
        url: "https://github.com/" + forkInfo.full_name + ".git",
        folder: settings.targetFolder,
        repo: forkInfo.name
      });
    } catch (e) {
      const missing = /native messaging host not found/i.test(e.message || "");
      post(port, {
        status: "error",
        code: missing ? "NO_COMPANION" : "CLONE_FAILED",
        message: missing ? "Companion app not installed — run install.bat, see README." : ("Companion error: " + e.message)
      });
      return;
    }

    if (reply && reply.ok) {
      post(port, { status: "done", path: reply.path });
    } else {
      const detail = reply && reply.error ? reply.error : "Companion gave no response.";
      post(port, { status: "error", code: "CLONE_FAILED", message: detail });
    }
  } catch (err) {
    console.error("forkclone failed:", err);
    const code = err && err.code ? err.code : "CLONE_FAILED";
    const message = err && (err.message || err.code) ? (err.message || err.code) : String(err);
    post(port, { status: "error", code, message });
  } finally {
    clearInterval(keepAlive);
  }
}

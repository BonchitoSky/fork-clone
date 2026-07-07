# ⚡ Fork & Clone

One click on any GitHub repository page → the repo is **forked to your GitHub
account** and **cloned as a real git repository** into a folder on your PC.
No ZIP files, no copying URLs, no terminal.

It has two parts that you install once:

| Part | What it is | Why it's needed |
|---|---|---|
| **Chrome extension** | Adds the ⚡ button to GitHub and talks to the GitHub API | Chrome extensions can't run programs on your PC… |
| **Windows companion** | A tiny local helper that runs `git clone` for the extension | …so this helper does the actual cloning, via Chrome's official "native messaging" channel |

Everything runs on your computer. The only server contacted is
`api.github.com`, using your own token. Nothing is sent anywhere else.

## Why I built this

Contributing to open source has a small but persistent friction: fork the
repository in the browser, copy the clone URL, open a terminal, run
`git clone`, and navigate to the folder — a five-step ritual repeated dozens
of times a month. Fork & Clone collapses it into a single click.

Beyond solving the annoyance, this project was a deliberate exercise in
crossing the browser/OS boundary safely. Chrome extensions are intentionally
sandboxed away from the filesystem, so doing this *properly* — a real
`git clone` with full history and a push-ready remote, not a ZIP download —
meant building a native-messaging bridge and designing the trust model
around it (see the security section below).

## Engineering challenges

**The native messaging protocol is unforgiving.** Each message is a 4-byte
little-endian length prefix followed by UTF-8 JSON over raw stdio — and a
single stray byte on stdout corrupts the channel permanently. Three separate
incidents drove this home during development: a UTF-8 byte-order mark
silently prepended by a .NET stream writer shifted the length prefix and
made the host appear dead; PowerShell 5.1 converts git's ordinary stderr
progress output into terminating errors the moment it is redirected, killing
clones that were actually succeeding; and PowerShell's default file encoding
writes a BOM that makes Chrome reject the host manifest outright.

**Native messaging failures are nearly unobservable.** When the channel
fails, Chrome reports only "Specified native messaging host not found" —
with no indication whether the registry key, the manifest file, its
encoding, or the origin allowlist is at fault. Debugging required control
probes: querying other hosts known to be registered on the machine to
isolate which layer was actually broken, turning an opaque failure into a
binary search.

**GitHub forks are created asynchronously.** The fork API returns before the
repository's git data exists, so an immediate clone can fail against a fork
that is still materializing. The race is absorbed at two independent layers:
the extension polls the fork until GitHub reports it ready, and the
companion retries the clone with backoff.

---

## Setup (about 5 minutes, done once)

### Step 0 — Make sure Git for Windows is installed

Open the Start menu, type `cmd`, press Enter, type `git --version`, press
Enter. If you see a version number, you're fine. If not, install it from
<https://git-scm.com/download/win> (keep all default options — the defaults
include the *Git Credential Manager*, which you'll want later for pushing).

### Step 1 — Load the extension in Chrome

1. Open Chrome and go to `chrome://extensions` (type it in the address bar).
2. Turn **on** the **Developer mode** switch in the top-right corner.
3. Click the **Load unpacked** button (top-left).
4. Pick the `fork-clone\extension` folder and click **Select Folder**.
5. A card named **Fork & Clone** appears. Under its name there is a long
   line of 32 letters labelled **ID** — that's the *extension ID*.
   Select it and copy it (Ctrl+C). You need it in the next step.

### Step 2 — Install the Windows companion

1. Open the `fork-clone\companion` folder in File Explorer.
2. Double-click **`install.bat`**.
3. A black window opens and asks for the extension ID — paste it
   (right-click → Paste, or Ctrl+V) and press Enter.
4. It prints "Installed — restart Chrome…". Close the window.
5. **Fully close and reopen Chrome** (Chrome only reads the companion
   registration on startup).

> No admin prompt appears — the companion registers only for your own
> Windows user account (HKCU registry), which is all Chrome needs.

### Step 3 — Create a GitHub token

The extension needs permission to fork repos on your behalf and to see your
private repos. GitHub grants that through a *Personal Access Token* — think
of it as a password that only works for specific things.

1. Open this link (it pre-fills everything):
   <https://github.com/settings/tokens/new?scopes=repo&description=Fork%20and%20Clone>
2. Scroll down, pick an expiration (or "No expiration"), click
   **Generate token**.
3. Copy the token that starts with `ghp_` — **you can only see it once**.

### Step 4 — Configure the extension

1. Go to `chrome://extensions`, find **Fork & Clone**, click **Details**,
   then **Extension options**. (Or right-click the extension's icon →
   Options.)
2. Paste the token into the first field.
3. Type the folder where you want repos to land, e.g. `C:\Users\LENOVO\Code`
   (it will be created automatically if it doesn't exist).
4. Optionally pick which corner of GitHub pages the ⚡ button should float
   in (bottom-right by default) — the change applies instantly.
5. Click **Test & Save**. You should see three green checkmarks:
   - ✓ Token: valid — signed in as *yourname*
   - ✓ Companion: responding — git version …
   - ✓ Folder path: looks valid

If anything shows ✗, the message next to it says what to fix (see the
troubleshooting table below).

---

## Using it

1. Visit any repository on GitHub, e.g. `https://github.com/octocat/Hello-World`.
2. A pill-shaped **⚡ Fork & Clone** button floats at the bottom-right.
   (On your *own* repos it says **⚡ Clone**, because there's nothing to fork.)
3. Click it. The button narrates progress:
   `Forking…` → `Waiting for fork…` → `Cloning…`
4. A few seconds later it turns green:
   **✓ Cloned to C:\Users\LENOVO\Code\Hello-World**
   That folder is now a full git repository — complete history, with
   `origin` pointing at **your fork**.

Notes:

- Click the button again on the same repo and you get a second copy in
  `Hello-World-2` — it never overwrites or deletes anything.
- If a fork already exists in your account, that's fine — it clones the
  existing fork.
- Big repositories can take minutes to clone; the button stays on
  `Cloning…` until git finishes. Just leave it alone.

## Pushing your changes back (first time only)

The clone uses a normal HTTPS remote, so the first time you run `git push`,
a **GitHub sign-in window** pops up — that's the *Git Credential Manager*
that came with Git for Windows. Sign in with your browser once; it caches
the credentials and every later push is silent. (Your extension token is
**not** embedded in the repository — that's deliberate, it keeps the token
out of `git remote -v` and out of any files on disk.)

---

## 🔒 Is my token safe with this extension?

**Why it's safe to paste your token here:**

- The token is stored in `chrome.storage.local` — it stays on **your computer
  only** and is never synced to other devices or uploaded to any server.
- It is sent to exactly one place: `api.github.com`, always over HTTPS.
  No other website or server ever sees it.
- It is never embedded in cloned repos or git remotes — pushing uses the
  Git Credential Manager's own sign-in instead, so the token never touches
  your disk outside Chrome's storage.
- This project is open source — you can read every line that handles the
  token ([options.js](extension/options.js), [background.js](extension/background.js))
  and verify the claims above yourself.

**Never do this with a token ❌**

- Send it in a chat, email, Discord message, or screenshot.
- Commit it to a repository — even a private one. (GitHub automatically
  revokes classic tokens it detects in public pushes.)
- Enter it on any website that isn't `github.com`.

**Precautions**

- Set an expiration of **30–90 days** instead of "No expiration" — a leaked
  token then dies on its own. Renewing takes 20 seconds: generate a new one,
  paste it in options, Test & Save.
- If you ever suspect a leak, revoke the token immediately at
  <https://github.com/settings/tokens> — cloning and the extension stop
  working until you paste a fresh one, and nothing else breaks.

## 🛡 Security model (for the technically curious)

The risky component in any design like this is the native companion: a
channel where browser messages become program execution. Here is how each
link in that chain is locked down:

- **Only this extension can talk to the companion.** Chrome routes native
  messaging exclusively to the extension ID pinned in the host manifest's
  `allowed_origins`. Websites cannot use the API at all, and other
  extensions don't match the pin.
- **The companion validates everything it receives**
  ([host.ps1](companion/host.ps1)): clone URLs must match
  `https://github.com/owner/repo(.git)` exactly — no other domains, no SSH,
  no redirects; repo names must match `^[\w.-]+$` with `.` and `..`
  rejected (blocks path traversal); the target folder must be an absolute
  path. Oversized (>1 MB) or malformed messages are dropped.
- **No shell interpolation.** Arguments are passed to git as an argument
  array with an explicit `--` end-of-options separator — there is no string
  a message could contain that becomes a flag or a second command.
- **Minimal permissions.** The extension asks only for `storage`,
  `nativeMessaging`, `api.github.com`, and a content script on
  `github.com`. Nothing else.
- **No dependencies, no build step, no remote code.** Every line that runs
  is in this repo, and Manifest V3's CSP forbids loading remote scripts.
- **Verify it yourself:** `chrome://extensions` → Fork & Clone → *Inspect
  views: service worker* → Network tab → do a fork. The only requests you
  will see go to `api.github.com`.

Two honest limitations: malware already running as your Windows user could
read the stored token or alter these files (the same trust level as your
browser's saved passwords — mitigate with short token expirations), and
while *cloning* a repository never executes its code, whatever you do with
the code afterwards is up to you.

---

## Troubleshooting

| Button shows | Meaning | Fix |
|---|---|---|
| `⚙ Setup needed — click` (`NO_SETTINGS`) | Token or target folder not saved yet | Click the button — it opens the options page. Fill both fields, press **Test & Save** |
| `✗ Token rejected…` (`BAD_TOKEN`) | GitHub refused your token (expired, revoked, or wrong scope) | Create a fresh token via the link in options (make sure the `repo` scope is checked) and Test & Save again |
| `✗ Companion app not installed…` (`NO_COMPANION`) | Chrome can't find the local helper | Run `companion\install.bat` again (paste the correct extension ID), then **restart Chrome completely** |
| `✗ GitHub is still creating the fork…` (`FORK_TIMEOUT`) | Very large repo — GitHub needs more time to build your fork | Wait a minute, click the button again — it will find the now-ready fork and clone it |
| `✗ …` other messages (`CLONE_FAILED`) | git itself failed; the tooltip (hover the button) shows git's exact words | Common causes: no internet, disk full, or an org repo that requires SSO — for SSO, open the token page on GitHub and press **Authorize** next to the organization |

Other oddities:

- **Three checkmarks were green yesterday, companion ✗ today** — did Chrome
  update or did you move the `fork-clone` folder? Moving the folder breaks
  the registered path; run `install.bat` again from the new location.
- **Button doesn't appear on a repo page** — refresh the page once; if it
  still doesn't appear, check the extension is enabled at `chrome://extensions`.

## Uninstalling

1. In the `companion` folder: right-click **`uninstall.ps1`** → **Run with
   PowerShell**. This removes the registry entry and the generated
   `com.forkclone.host.json`. It does **not** touch any repos you cloned.
2. Go to `chrome://extensions` and click **Remove** on the Fork & Clone card.
3. Optionally, delete the token at <https://github.com/settings/tokens>.

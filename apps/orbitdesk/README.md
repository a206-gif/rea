# OrbitDesk AI Studio 0.3.1

OrbitDesk is a **clean-room**, Windows-first Electron desktop application for managing isolated browser instances and authorized AI-generation workflows on the official Doubao and Dola websites. It does not reuse proprietary source code, assets, extension packages, protocol handlers, branding, or private service behavior from the analyzed application.

## Capabilities

### Instances and sessions

- Ordered, grouped browser-instance catalog with independently persistent Electron `persist:` partitions.
- Real `https://www.doubao.com/` and `https://www.dola.com/chat/` navigation in sandboxed `WebContentsView` surfaces.
- Manual login on the official site; OrbitDesk does not collect passwords.
- Per-instance start URL and Windows-system/VPN, direct, HTTP(S), SOCKS4, or SOCKS5 proxy rules. System/VPN routing is the safe default.
- Built-in network diagnostics show Chromium's resolved route (`DIRECT`, `PROXY`, or `SOCKS`) without contacting an additional IP lookup service.
- Dola region-restriction pages are detected and surfaced as an actionable instance warning instead of a false “ready” state.
- Explicit JSON Cookie import/export for account owners migrating their own session. Cookie domains are restricted to the selected adapter's official allowlist.
- Back, forward, reload, home, popup restriction, navigation allowlists, isolated cache, and persistent cookies.

### Visible-page automation

- Per-instance serial task queues with bounded cross-instance concurrency, ordering, pause/resume, retry, and cancellation.
- Dola video flow selects the **genuinely visible** video mode, model **2.5**, and the webpage's native **30-second** option.
- The video mode, model, duration, and optional aspect ratio are checked again immediately before clicking the visible submit button.
- Fail-closed behavior: if visible state cannot be located or verified, submission stops instead of drawing a fake option, changing a payload, or silently using another duration.
- Visible-page adapter diagnostics report prompt, video, 2.5, 30s, and blocked-page state.
- Result polling only observes visible media elements on the authorized page. CAPTCHA, verification, quota, membership, and rate-limit text moves a task to human attention.

### Workbench and files

- Persistent storyboard workbench with one prompt per shot, target instance, aspect ratio, ordered dispatch, and task/shot association.
- Local asset library for imported images/videos and automatically downloaded results.
- Electron download ownership, Windows-safe filenames, progress records, result-to-task association, and reveal-in-folder.
- Four-pane studio window: tool rail, grouped instance catalog, real browser plus automation dock, and detected-result pane.
- Desktop completion notifications and atomic local JSON persistence.

### Authenticated local automation API

The optional API is disabled by default. When enabled it:

- binds only to `127.0.0.1`;
- validates the loopback `Host` header;
- requires a random Bearer token on **every** route;
- accepts at most 1 MB JSON request bodies;
- omits tokens, cookies, file paths, page-script execution, and arbitrary navigation from its state API;
- exposes only health, redacted state, validated task creation/cancellation, and opening a known instance.

Example:

```powershell
$token = "TOKEN_SHOWN_IN_ORBITDESK_SETTINGS"
Invoke-RestMethod `
  -Uri http://127.0.0.1:17824/v1/health `
  -Headers @{ Authorization = "Bearer $token" }
```

Task creation uses the same validation as desktop IPC:

```json
{
  "workspaceId": "workspace_...",
  "prompt": "A cinematic tracking shot through a rainy neon street",
  "kind": "video",
  "durationSeconds": 30,
  "quantity": 1,
  "autoDownload": true,
  "aspectRatio": "16:9"
}
```

## Security and clean-room boundaries

OrbitDesk intentionally does **not** implement:

- capability/action-bar response mutation;
- forced entitlement, model, or duration payload changes;
- private or hidden generation APIs;
- membership, quota, CAPTCHA, payment, or rate-limit bypass;
- fingerprint spoofing or stealth automation;
- watermark/token decoding or removal;
- bundled proprietary skills, extensions, source, assets, or update endpoints.

Remote content runs with Node integration disabled, context isolation and sandboxing enabled, insecure mixed content disabled, and navigation restricted to safe HTTPS/about schemes so official OAuth flows can work. Automation execution remains strictly constrained to adapter domains. Renderer/main IPC accepts narrow validated schemas. The dashboard never receives cookies except through an explicit user-selected export file.

Cookie exports are sensitive authentication material. Store them securely, import only trusted files, and delete them when no longer needed.

## Architecture

```text
React renderer (dashboard / storyboards / library / studio chrome)
    │ frozen contextBridge API with validated IPC
sandboxed preload
    │
Electron main process
    ├── StateStore             atomic 0600 JSON, migrations, ordering, storyboards
    ├── WorkspaceManager       BrowserWindow + WebContentsView + unique partition
    ├── AutomationEngine       bounded queue, visible controls, result polling
    ├── DownloadManager        will-download ownership and result cataloging
    ├── LibraryManager         user-selected local media import and reveal
    ├── AutomationApiServer    authenticated loopback-only, least-privilege API
    └── site adapters          official hosts, visible selectors and labels
```

## VPN and performance notes

- Version 0.3.1 migrates the old implicit `direct` setting to **跟随 Windows 系统/VPN**. An explicitly selected direct mode in the new schema remains direct.
- If diagnostics report `DIRECT` while a proxy-style VPN is enabled, turn on the VPN client's Windows system-proxy option or enter its local HTTP/SOCKS5 listening address as a fixed instance proxy.
- If diagnostics show a proxy route but Dola still returns a region-restriction page, Dola is rejecting the VPN exit region or account context. OrbitDesk reports that state but does not bypass the site's regional policy.
- QUIC is disabled so Chromium traffic does not sidestep or conflict with common local proxy clients; HTTPS continues over TCP.
- High-frequency download/progress updates are coalesced: renderer broadcasts are limited to roughly 10 per second and disk persistence to roughly 2 writes per second, with a synchronous flush on shutdown.

## Development

Requirements:

- Node.js 22.12 or newer
- Windows 10/11 for real Electron and installer validation

```bash
cd apps/orbitdesk
npm ci
npm run dev
```

Web-only UI preview:

```bash
npm run dev:web
```

The web preview does not simulate remote pages, tasks, cookies, or downloads. Its instance cards open the real official URLs in a normal browser tab. Real embedded browsing and automation require the Electron desktop shell.

Validation:

```bash
npm run typecheck
npm test
npm run build
```

Windows installer:

```bash
npm run package:win
```

The repository workflow builds the unsigned NSIS installer on `windows-latest`. Production distribution must add Authenticode signing. The workflow also emits SHA-256 checksums so a release can be independently verified. OrbitDesk does not silently self-update from an unsigned or unpinned feed; a production updater should only be enabled after the publisher provisions code signing and a signed update manifest.

## Adapter calibration checklist

1. Open one instance and manually sign in to its official site.
2. For Dola, remain on `https://www.dola.com/chat/` and expose its visible video-generation composer.
3. Run **诊断页面** and confirm that the prompt control, model `2.5`, and native `30s` choice are visible.
4. Use **模型 2.5 · 30s** once and confirm Dola's displayed model and duration both change.
5. Submit one low-cost test with the page visible.
6. Confirm the final pre-submit checks and result detection.
7. If page structure changed, update only public visible-control rules in `src/adapters/site-adapters.ts` and `src/main/page-scripts.ts`; do not add private endpoint calls.
8. Re-run typecheck, tests, build, and an authorized Windows smoke test.

## Upgrade note from 0.2

Version 0.3 uses a unique browser partition for every instance, even when instances share the same profile label. This fixes unintended Cookie sharing. Existing users may need to sign in once in each upgraded instance. Deleting an instance removes its OrbitDesk records but does not silently erase Chromium profile directories; sensitive profile cleanup remains an explicit maintenance operation.

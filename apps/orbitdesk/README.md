# OrbitDesk AI Studio

OrbitDesk is a **clean-room**, Windows-first Electron desktop application for managing many isolated browser workspaces and authorized AI-generation tasks. It does not reuse code, assets, protocol observations, or branding from the analyzed Dola binary.

## MVP scope

- Unlimited workspace records and independently opened Electron windows.
- Persistent login profiles backed by Electron `persist:` session partitions.
- Built-in adapters for `https://www.doubao.com/` and `https://www.dola.com/`.
- Sequential task queues per workspace with bounded cross-workspace concurrency.
- Strict 30-second video option selection: if a visible 30-second control is not found, submission stops.
- Image/video completion detection from the currently visible authorized page.
- Electron download integration, Windows-safe filenames, progress records, and reveal-in-folder.
- Automatic pause on CAPTCHA, human-verification, rate-limit, membership, or quota text.
- Local JSON state stored under Electron `userData`; downloads default to `Downloads/OrbitDesk`.
- A local automation sandbox (`demo-generator.html`) for selector and result-flow validation.

## Explicit non-goals

OrbitDesk does not bypass CAPTCHA, payment, membership, account limits, rate limits, or platform access controls. It does not call private APIs, extract passwords, or inject credentials. Login happens manually in the official web page. Automations run only when the active page is back on the configured site domain.

The Doubao and Dola adapters are intentionally heuristic because third-party HTML changes without notice. They must be calibrated against the user's current, authorized account UI before unattended use. The first task should stay visible. Failure to find an exact 30-second control is a hard stop, never a fallback to another duration.

## Architecture

```text
renderer (React dashboard / workspace chrome)
    │ contextBridge typed IPC
preload
    │ validated commands only
main process
    ├── StateStore              atomic local JSON persistence
    ├── WorkspaceManager        BrowserWindow + WebContentsView + profile partition
    ├── AutomationEngine        bounded queue / visible-UI actions / polling
    ├── site adapters           selectors, labels, allowed automation hosts
    └── DownloadManager         Electron will-download ownership and progress
```

Remote site content runs in a sandboxed `WebContentsView` with Node integration disabled. The dashboard never receives cookies or passwords. Popup URLs and navigation are restricted to safe web schemes; automation itself additionally requires the configured site domain.

## Development

Requirements:

- Node.js 22.12 or newer
- Windows 10/11 for real Electron and installer validation

```bash
cd apps/orbitdesk
npm install
npm run dev
```

Web-only UI preview:

```bash
npm run dev:web
```

The web preview does not simulate remote pages, task execution, or downloads. Its Doubao and Dola cards open the real official URLs in a new browser tab because third-party authenticated pages cannot be embedded safely in the Arena preview. Real in-app browsing requires the Electron desktop shell.

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

The NSIS installer is built on a Windows GitHub Actions runner. Before wider release, the packaged application still requires an interactive Windows smoke test covering login, navigation, site permissions, and the current Doubao/Dola page structure. Version 0.1.1 uses a CommonJS sandbox preload and refuses to silently fall back to preview data if the desktop bridge fails.

## Adapter calibration checklist

1. Open one workspace and manually sign in to the official site.
2. Navigate to the actual image/video generation page.
3. Confirm that the prompt input, video mode, exact `30 秒` control, and generate button are visible.
4. Submit one low-cost test while keeping the page visible.
5. Verify that the result card exposes a real `video`, `img`, or download link URL.
6. If selectors fail, update only `src/adapters/site-adapters.ts`; do not add private endpoint calls.
7. Re-run the local test suite and one manual authorized task.

## Privacy and operations

- Account credentials stay in the site's own login form and Chromium session storage.
- Profile partitions share cookies only when the same profile is deliberately selected.
- Download records contain local paths and source URLs; protect the Electron user-data directory accordingly.
- Deleting a workspace does not silently delete browser profile data in this MVP.
- A task timeout stops local observation only; it does not cancel a generation already submitted on the site.

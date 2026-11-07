# The installable app (T15)

Township can be installed to a phone's home screen and opens without the browser's bars. It is not an offline app: the money and the complaints always come from the server.

## The manifest

`src/app/manifest.ts`, served at `/manifest.webmanifest` without a login: name and short name "Township", start URL and scope `/`, `display: standalone`, `orientation: portrait`, language `en`, theme and background colour both the paper token (`#fbf8f1`, kept equal to `--color-paper` by a test), and three icons: 192, 512 and a maskable 512. A light status bar with dark icons, ink on paper is 16.37:1. The `<head>` has the `theme-color` meta, the Apple touch icon (180) and the standalone Apple web app tags.

The icon is an original mark: the Passbook double rule above and below one square (a flat), ink on paper, no text. `public/icons/mark.svg` is the source; `npm run icons` renders the PNGs with the Chromium of Playwright. Everything sits inside the central 60% so one image serves as the plain and the maskable icon.

## The service worker (`public/sw.js`)

It exists for one reason: with no network, show "You're offline." and "You can't pay right now." instead of the browser's error page.

| It does | It never does |
| --- | --- |
| At install, store `/offline.html` and the four icons, fetched without credentials | Store or answer a page after login, an `/api` response, a Server Action, a POST, or anything that carried a cookie |
| For a navigation: network first; only when it fails, answer with the offline page | Store a page that loaded; there is no `cache.put` in the file |
| Answer the five listed files from its cache | Touch a request to another origin |
| At activate, delete every cache whose name is not the current version's | |

Why: a cache outlives a logout and a shared phone. A resident's dues or a staff member's reconciliation must exist only on the server and in a page the person is looking at.

`tests/lib/service-worker.test.ts` runs `sw.js` in a sandbox with a recording cache and asserts the table: the file has no `.put(` or `.add(` and no `/api`; the list is exactly the five files and they exist; install stores only them, without credentials; `/api/...`, `/`, a POST, a Server Action style POST and another origin are left to the browser and write nothing; a navigation goes to the network and falls back to the offline page; activate deletes the old versions. Bump `VERSION` when the file or the list changes.

It is registered by `ServiceWorkerRegistration` only in a production build and only over HTTPS or on localhost. In `next dev` there is no worker.

## The offline page and the Home

`public/offline.html` (also at `/offline`, a rewrite) is one self-contained file with inline CSS in the design's tokens and a system font: the worker keeps only this file, so it cannot depend on the app's stylesheet or fonts. Its Try again is a plain link to `/`, which works without scripts.

While the browser is offline the Home shows the design's state O banner above the dues ("You're offline. You can't pay right now.") and Pay is the dashed, disabled control, with the same label. The page starts as online on the server and on the first client render, so it never flashes "offline" falsely.

## Proof

`tests/e2e/installable.spec.ts` on the built app: Chrome's `Page.getInstallabilityErrors` is empty; the manifest and its icons are served; the worker takes control; with the network off a page load shows the offline page; an open Home shows the banner and the dashed Pay at 360 px. `tests/ui/manifest.test.ts` checks the fields, that each icon file exists at its declared size, that a maskable icon is listed and that the colours are tokens.

## Install on a phone

Open the deployed site over HTTPS in Chrome on Android, then the menu, "Install app" (or "Add to Home screen"); on iPhone, Safari, Share, "Add to Home Screen". Over plain HTTP on a LAN address Chrome will not install it (not a secure context); `localhost` does.

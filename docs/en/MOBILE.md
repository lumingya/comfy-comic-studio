# Mobile access and touch controls

[Handbook](GUIDE.md) · [简体中文](../guide/MOBILE.md) · [Security](../../SECURITY.md)

Open the running Mio server in your phone browser. No mobile app is required: the computer still owns storage and executes accepted image jobs.

## Mobile layout

- Labeled bottom navigation replaces the space-consuming sidebar, with system safe-area spacing.
- Creation headings, album selectors and buttons wrap into usable rows. Forms become single-column, with larger input text and approximately 44px primary touch targets.
- Search directly in the model ID field. Tap a suggestion once to replace and save its full ID. Scrolling suggestions does not select a model.
- Use queue up/down buttons instead of drag gestures. Started work remains protected.
- Use an album's **More** button for management, export and previous/next ordering. Use checkboxes for batch selection, not a keyboard modifier.
- Reading preserves complete images. The **Layout** panel provides scrollable template selection and HTML export. Your browser manages downloaded files.
- On touch devices, Enter inserts a newline in the assistant; use **Send** to submit. Viewport and rotation adjustments do not rebuild editors or clear drafts.

Dialogs, suggestions and the assistant adapt to the visual viewport. Actual software keyboards and browser toolbar behavior vary by device.

## Connect over trusted Wi-Fi

Mio defaults to loopback-only listening. `127.0.0.1` on your phone means the phone, not your computer. Do not expose the private workspace directly to the Internet. A public API token does **not** protect the entire site/private APIs.

For a trusted personal LAN only, find the computer's LAN address (example `192.168.1.23`), stop Mio, then start it from the project directory:

Windows **Command Prompt / cmd**:

```bat
set MIO_HOST=0.0.0.0
set MIO_PORT=8777
set MIO_ORIGINS=http://192.168.1.23:8777
start.bat
```

macOS / Linux:

```sh
MIO_HOST=0.0.0.0 MIO_PORT=8777 MIO_ORIGINS=http://192.168.1.23:8777 python3 server.py
```

Replace the example IP with your actual address. Allow the port through the computer firewall only for the trusted private network, if needed. Do not add router Internet port forwarding. Open `http://192.168.1.23:8777/` on the phone.

The allowed origin must exactly match the scheme, IP and port, without a path or trailing slash. If the IP changes, update it and restart. Missing origin configuration can allow the page to load while saves/uploads return 403. Guest Wi-Fi client isolation can also block access.

Normally leave the Mio/Python backend base URL blank under **Services and storage** to use the current page origin. An explicitly saved loopback URL may need correction. This differs from provider configuration: a server-side image job reaches localhost on the Python computer, while any legacy browser-side connection checks reach localhost on the phone.

Network access was not automatically enabled by this update. Start with default settings in a new terminal to restore loopback-only listening. For remote use, protect the entire application with authenticated HTTPS or a controlled secure tunnel.

## Files and shared work

PNG, JPEG and WebP image variables are stored on the computer. Convert unsupported HEIC files first. Mobile photo permissions and file pickers are controlled by the OS. Normal image upload and JSON/ZIP/HTML downloads do not require the desktop browser directory API.

Phone and desktop share the workspace: avoid simultaneous edits, and preserve unsaved changes before reloading a stale revision. Accepted/started durable image jobs continue after closing the phone tab only while the computer and Python service remain running. Unsubmitted drafts and browser conversations are not background jobs.

Before updating, stop the server and back up/preserve `data/`. Replace program files and reload the phone page; do not delete workspace data just to refresh the interface.

## Verification boundaries

Chromium and WebKit touch/mobile emulation cover 320, 390 and 430px portrait, 844×390 landscape and shortened viewports. Checks include navigation, single-tap model selection, draft retention, uploads, queue controls, album management, complete-image reading, HTML download and assistant input.

This is **not physical iOS/Android device validation**. Real keyboards, photo permissions, display cutouts and vendor-browser differences are not reproduced. No paid cloud generation was performed for these UI checks. See the [test report](../TEST_RESULTS.txt).

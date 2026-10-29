# Developer guide

## Contents

- [Plugins](#plugins)
  - [Where plugins live](#where-plugins-live)
  - [Manifest (`plugin.json`)](#manifest-pluginjson)
  - [Backend part (`index.js`)](#backend-part-indexjs)
  - [UI part (`ui.js`)](#ui-part-uijs)
  - [What the host does for you](#what-the-host-does-for-you)
  - [HTTP API (used by the UI)](#http-api-used-by-the-ui)
  - [Frontend (core)](#frontend-core)
  - [Writing a new plugin: checklist](#writing-a-new-plugin-checklist)
  - [The `tmdb-poster` plugin](#the-tmdb-poster-plugin)
- [JDownloader settings](#jdownloader-settings)
  - [What to do when JDownloader brings something new](#what-to-do-when-jdownloader-brings-something-new)
- [MCP server](#mcp-server)
- [Talking to the MyJDownloader API](#talking-to-the-myjdownloader-api)
- [Distributing the extension and the app](#distributing-the-extension-and-the-app)
- [Android app](#android-app)
- [Development](#development)

## Plugins

Plugins extend the web UI. The core knows nothing about what a plugin shows: it only defines **blocks** in its
templates and lets plugins fill them. A plugin has a backend part (looks things up, keeps API keys) and a UI part
(a Vue component that renders the result). The poster on the package card comes entirely from the `tmdb-poster`
plugin; nothing about posters is in the core.

Plugins are **trusted code**: they run inside the server process with the same rights as the server (including
access to the MyJDownloader credentials in its environment). There is no sandbox. Only install plugins you trust.

### Where plugins live

All plugins are in one folder, `plugins/` in the repository (`/app/plugins` in the container; override with
`PLUGINS_DIR`). The folder is mounted into the container by `compose.yaml` and also copied into the image by the
`Dockerfile`. Each plugin is a sub-folder:

```
plugins/
  package.json          # { "type": "module" } so index.js is loaded as an ES module
  tmdb-poster/
    plugin.json         # manifest
    index.js            # backend part (runs on the server), default export
    ui.js               # UI part (runs in the browser), optional
```

Plugins are discovered at server start. After adding or changing one, restart the app.
The folder name must match `id` in the manifest and may only contain `a-z`, `0-9` and `-`.

### Manifest (`plugin.json`)

```json
{
  "id": "tmdb-poster",
  "name": "Movie & TV posters (TMDB)",
  "description": "Shown on the settings page.",
  "version": "1.0.0",
  "ui": "ui.js",
  "settings": [
    { "key": "apiKey", "label": "TMDB API key", "type": "password", "required": true, "description": "Help text" },
    { "key": "language", "label": "Language", "type": "text", "default": "en-US" }
  ]
}
```

`ui` (optional) names the file with the UI part. `settings` describe what the user can configure; the page
Settings → Plugins is generated from them, so a plugin does not need any settings UI of its own.

| `type`     | Value     | Notes                                                                     |
| ---------- | --------- | ------------------------------------------------------------------------- |
| `text`     | string    |                                                                           |
| `password` | string    | Secret. Never sent back to the browser, the UI only learns "set / not set". |
| `select`   | string    | Needs `options: [{ "value": "…", "label": "…" }]`.                        |
| `boolean`  | boolean   | Checkbox.                                                                 |

Optional per setting: `description`, `default`, `required`. A plugin with an unset required setting counts as
"not configured" and is not called, even if switched on. Boolean settings are never "missing".

### Backend part (`index.js`)

The default export is an object with the hooks the plugin implements:

```js
export default {
  // Called for a package name. Return any JSON object, or null/{} for "nothing".
  async packageData({ name, urls, settings, signal, image }) {
    return {
      poster: await image('https://…/poster.jpg'), // see below
      title: 'Some Movie'
    }
  }
}
```

- `name`: the package name as JDownloader has it.
- `urls()`: async, returns the source URLs of the package's links (one device call, made only if you call it, then remembered). Prefer this to guessing from the name when the source matters.
- `settings`: the current values by key (defaults applied, secrets included).
- `signal`: an `AbortSignal` that fires after 10 seconds. Pass it to `fetch`.
- `image(url)`: has the server fetch an https image and returns a URL of this server for it
  (`/api/plugins/<id>/image/<token>`). The browser never contacts the image host.
- Throw an `Error` for real failures (bad API key, service down). The message is shown on the settings page.
  Return `null` when the plugin simply has nothing for this package.
- Use the global `fetch`; there is no plugin SDK and no extra dependencies are installed for plugins.

The returned JSON is passed on untouched; only the plugin's own UI part interprets it.

### UI part (`ui.js`)

An ES module that the browser loads from `/api/plugins/<id>/ui.js` while the plugin is enabled and set up. It
runs in the page with the full rights of the web UI (trusted code, like the backend part). There is no build step:
write plain JavaScript and use render functions, with `Vue` handed to you (no `import 'vue'`).

```js
export default function register({ Vue, block, pluginId }) {
  const { defineComponent, h } = Vue
  block('package-aside', defineComponent({
    props: { pkg: Object, device: String, data: Object },
    setup: (props) => () => (props.data?.poster ? h('img', { src: props.data.poster }) : null)
  }), 'append')
}
```

`block(name, component, mode = 'append')` puts a component into a block of a core template. Components get the
props `pkg` (the package), `area` (`downloads` or `linkgrabber`: the list it is in), `device` and `data` (what `packageData()` returned for it, `undefined` while loading).
Render `null` to show nothing.

Modes work like template inheritance:

| mode      | effect                                                                                     |
| --------- | ------------------------------------------------------------------------------------------ |
| `prepend` | your component is shown before the block's default content                                 |
| `append`  | your component is shown after the default content                                          |
| `replace` | the default content is replaced; it is passed to you as the default slot, so `slots.default?.()` renders the original again (like `super()`) |

If several plugins replace the same block, the last one wins.

Blocks of the package card (`frontend/src/PackageCard.vue`, rendered by `PackageSlot.vue`). `package-aside` also exists on the packages of the linkgrabber (`LinkgrabberView.vue`); `package-meta` only on the download list:

| block           | where                                                                                         |
| --------------- | --------------------------------------------------------------------------------------------- |
| `package-aside` | a column at the right edge of the card, empty by default; the card only makes room for it while a plugin renders something |
| `package-meta`  | the row below the progress bar (size, speed, links, hosts)                                    |

More blocks are added by wrapping the default content of a template in `<PackageSlot name="…" :pkg="pkg">…</PackageSlot>`.

### What the host does for you

(`backend/src/plugins.ts`)

- **Settings storage**: `data/settings.json` (`DATA_DIR`, default `./data`), written with mode `0600` because it
  holds API keys. Layout: `{ "plugins": { "<id>": { "enabled": true, "values": { … } } } }`.
- **Result caching** per plugin and package (device, uuid and name), in memory: a result for 24 h, "nothing" for 1 h, a failure
  for 1 min. Changing a plugin's settings clears its cache.
- **Image proxy** (`image(url)`): the URL must be `https`; the server fetches it on demand (jpeg/png/webp, max 5 MB) and serves it as `/api/plugins/<id>/image/<token>`, where the token is
  a hash of the URL. Images are cached on disk per plugin in `data/plugin-images/<id>/`, so plugins never share
  files or routes.
- **Cleanup**: `data/plugin-images/index.json` records which package names use which image. Once a minute, if
  every device is online and has fresh data, images whose packages no longer exist are deleted (an image used by
  several packages stays until the last one is gone). Nothing is deleted while a device is offline or its list is
  stale, so a missing device cannot make its packages look deleted.

### HTTP API (used by the UI)

| Route                                  | Purpose                                                              |
| -------------------------------------- | -------------------------------------------------------------------- |
| `GET /api/plugins`                     | Installed plugins with their settings (secrets reduced to `set`)     |
| `PUT /api/plugins/:id`                 | `{ enabled?, values? }`; only changed settings are sent, `null`/`""` removes a value |
| `GET /api/plugins/:id/package?name=…&uuid=…` | What the plugin's `packageData()` returns for a package of the download list or the linkgrabber (`{}` if off) |
| `GET /api/plugins/:id/ui.js`           | The plugin's UI module                                               |
| `GET /api/plugins/:id/image/:token`    | A cached image of that plugin                                        |

All routes sit behind `UI_PASSWORD` like the rest of the API.

### Frontend (core)

- `frontend/src/plugins.ts`: plugin state, loading of the UI modules, the block registry, `fetchPackageData`.
- `frontend/src/PackageSlot.vue`: a block; renders default content plus what plugins added or replaced.
- `frontend/src/SettingsView.vue`: the Settings tab, a page with a sidebar. New settings add an entry to `SECTIONS` in
  `frontend/src/settings.ts` and a component; the anchor is `#settings/<section>`.
- `frontend/src/PluginSettings.vue`: Settings → Plugins, generated from the manifests.

### Writing a new plugin: checklist

1. Create `plugins/<id>/plugin.json` and `index.js`.
2. Restart the app, open Settings → Plugins, switch the plugin on and fill in its settings.
3. Check the server log: load problems are logged as `Plugin "<id>" could not be loaded`, runtime failures as
   `Plugin "<id>" failed for "<package>"` and shown on the settings page.

### The `tmdb-poster` plugin

Looks up `tmdbid=<id>` (also `tmdbid-<id>` or `tmdbid_<id>`) from the package name, e.g.
`Backrooms in Jarvis (2021) [tmdbid=12345]`. A bare id does not say whether it is a movie or a series, so both are
asked and the better match wins: title equal to the name in the package (+3, contained +1), year equal (+2), and a
series hint such as `S01E02`, "Season" or "Staffel" (+2 for series). On a tie the movie wins. Title and year are
read from the part of the name before the first `(`, `[`, `{`, year, `SxxExx` or resolution. The API key can be
the v3 key or the long v4 read access token. Posters are the 185 px size. `ui.js` renders the poster in the `package-aside` block (a 68×100 px link to the TMDB page).

## JDownloader settings

The page Settings > JDownloader is generated from what the device reports, not from a hand-written list of
settings. That way most settings need no code, and a newer JDownloader can add some without breaking anything.

- **Source:** `/config/list` of the device (`backend/src/jdconfig.ts`). Per entry: interface, storage, key, type
  (`abstractType`), value, default, `docs` (a short English hint, not always there) and, for enums, the options.
  No localized labels exist in the API; the label is derived from the key (`MaxSimultaneDownloadsPerHost` ->
  "Max simultane downloads per host").
- **Written** with `/config/set` (`interfaceName`, `storage`, `key`, value) and `/config/reset` (back to the default).
  Every change goes straight to the device and is logged like any other write request.
- **Sorting:** `CATEGORIES` in `jdconfig.ts` maps interfaces to the sidebar sections (the ids match `SECTIONS` in
  `frontend/src/settings.ts`). `GROUP_LABELS` gives interfaces a readable name, otherwise it is derived from the
  class name.
- **Left out on purpose:** the plugin configs (hosters, media libraries; some 1500 entries) and the settings that
  only steer the desktop GUI (`EXCLUDED`).
- **Secrets** (keys like password, token, apikey) never reach the browser: the page only gets `set: true/false`.
- **Rendering** by type in `frontend/src/JdSettings.vue`: BOOLEAN checkbox, ENUM select, INT/LONG/DOUBLE and STRING
  text, `*_LIST` one entry per line, everything else (OBJECT, OBJECT_LIST, ENUM_LIST) as JSON.

### What to do when JDownloader brings something new

The backend logs each of these once per process (`JD config: ...` in the container log), so look there after a
JDownloader update:

| Log line | Meaning | What to do |
|---|---|---|
| `unknown interface X, not shown` | A config interface matches neither `CATEGORIES` nor `EXCLUDED`. | Add it to a category (or to `EXCLUDED` if it is GUI-only or a plugin) and, if the name is not telling, to `GROUP_LABELS`. |
| `unknown value type T ... shown as JSON` | A new `abstractType`. | It already works as raw JSON. For a proper widget, add the type to `KNOWN_TYPES` and `SIMPLE`, then render and parse it in `JdSettings.vue`. |

New entries in an interface we already show need nothing: they appear on their own. To see what the device
reports, run `/config/list` with the pattern `.*` (all) or an interface name, with `returnDescription`,
`returnValues`, `returnDefaultValues` and `returnEnumInfo` set to true. It is a read-only call.

## MCP server

`backend/src/mcp.ts` serves MCP (Streamable HTTP, stateless) on `/mcp`, behind the same Basic auth as the UI (any username, `UI_PASSWORD` as password). Point a client at `http://<host>:<APP_PORT>/mcp`, e.g. `claude mcp add --transport http jd http://<host>:3000/mcp --header "Authorization: Basic <base64 of x:password>"`.

- Read tools: `list_devices`, `search_settings` (the JD settings are searched, not listed), `list_settings_group`, `list_plugins`, `plugin_settings`, `list_downloads`, `package_links`, `list_linkgrabber`, `list_accounts`, `list_captchas`. Every tool takes an optional `device` (name or id).
- Write tools (`set_setting`, `reset_setting`, `add_links`) only exist when writing is switched on (on the settings page; `MCP_WRITE=true` is the default until it was chosen there). Values are checked against the setting's type and options; secrets and the groups this app manages itself are refused.
- There is deliberately no tool to stop, pause or delete downloads.

## Talking to the MyJDownloader API

The MyJDownloader API is not ours. Everything goes through `MyJdClient` (`backend/src/myjd/client.ts`), and the rules in there are what
keep a backend with any number of clients cheap for it. Read this before you add a call, a timer or a poll.

- **Never call `fetch` for the API yourself.** `callDevice(deviceId, action, params)` is the way. It applies the limits (at most 8 calls at a
  time, 30 ms between starts, a pause after a 429, a 20 s timeout) and one shared login when the session expires.
- **A new read:** add its action to `READ_TTL_MS` (action -> how long its answer may be kept, in ms). Concurrent callers then share one
  call. Pure reads that must not be kept (a counter, a single item) go into the `NEUTRAL` pattern.
- **A new change** (anything that could alter what a read returns): nothing to do. Every action that is neither in `READ_TTL_MS` nor `NEUTRAL`
  counts as a change; it drops the kept answers of that device (`epoch`). If you are unsure, leave it out of both lists: stale data is worse
  than one extra call.
- **No timers that call the API.** Nothing in the backend asks MyJDownloader unless a client wants it. Use one of these patterns instead:
  subscribe (`DownloadsPoller` and `LiveHub`, see below: they poll while at least one SSE listener exists), lease (`activity.view()`: the speed is measured for 15 s after the
  graph was asked for), or look up on request with an age (`BandwidthHistory.probe(maxAgeMs)`, `DeviceRegistry.freshen(maxAgeMs)`).
- **Direct connection.** `callDevice` sends the data calls straight to the device in the LAN when the API gave an address that can be reached
  (`MYJD_DIRECT=off` switches this off). Same protocol and session, 2-4 ms instead of 35; only the address lookup touches the API. Such calls are
  counted in `directCalls`, not in `myjdCalls`. An address that fails is avoided for a minute and the call takes the relay. On a direct route
  reads are kept only 300 ms and the pollers ask every second (`isDirect`, `DIRECT_POLL_MS`). The app container must be able to reach the
  device's network: with Docker that means joining the JDownloader's networks, e.g. in a `compose.override.yaml` (gitignored).
- **`Shared`** (`backend/src/shared.ts`) is the small helper behind it: `get(key, ttlMs, load)` returns a kept answer or calls `load` once
  for everybody who asks at the same time. Failures are not kept.
- **See what it costs:** `GET /api/health` (it does not count as a client) shows `myjdCalls` and who asked last (`clients`). Read it twice
  a minute apart to measure a change. Without any client the counter must not move.
- **One stream for the web UI:** `GET /api/live` (SSE; `frontend/src/live.ts` is the client). `LiveHub` (`backend/src/live.ts`) runs one loop per source
  (captchas, dialogs, device list, and per device the linkgrabber) while a browser is connected and sends an event only when the answer changed
  (`fingerprint` leaves out values that merely count down). `?device=<id>|all` adds the downloads and the linkgrabber of those devices,
  `?grabber=slow` looks at the linkgrabber only now and then. New live data is a new source there, not a timer in the page.
- Client side: a hidden tab does not poll, and the Android service rests while the app is in front. Keep new polls consistent with that.

## Distributing the extension and the app

The backend ships both clients, so the web UI (Settings > Browser extension / App) can offer them and they can update themselves.

**Browser extension** (`backend/src/extension.ts`). The image contains `extension/` (`Dockerfile`). `ExtensionBundle.loadAll` reads it once at start,
one package per browser kind in `EXTENSION_TARGETS` (`chromium`, `firefox`): same files, own manifest. A new browser is a new entry there plus a card
(`guides`) in `BrowserExtensionSettings.vue`.

| Route | Purpose |
| --- | --- |
| `GET /api/extension` | Targets (`id`, `label`, `ext`, `state`) and the version |
| `GET /api/extension/:target` | Version and file list (path, size, sha256) for the update check |
| `GET /api/extension/:target/file?path=…` | One file, for the self-update |
| `GET /api/extension/:target/extension.zip` | ZIP for the first installation (not Firefox) |
| `GET /api/extension/firefox/extension.xpi`, `…/updates.json` | The package signed by Mozilla, and what Firefox asks for updates |

- **Raise `version` in `extension/manifest.json` with every change.** The self-update compares it, and AMO signs a version only once. Rebuild the app
  container afterwards (the extension is part of the image).
- Self-update (`extension/update.js`): the options page writes the changed files into the folder the extension is loaded from (File System Access API,
  folder picked once, kept in IndexedDB) and reloads it. Chromium only.
- Firefox (`backend/src/firefox.ts`) needs `PUBLIC_URL` (https) and `AMO_JWT_ISSUER` / `AMO_JWT_SECRET` (see `.env.example`); without them no Firefox package
  is offered. The backend uploads the package as unlisted, waits for the signature and keeps the signed file in the data folder. The add-on id
  belongs to one AMO account, so each installation has its own (`EXTENSION_FIREFOX_ID`, else made once in the data folder). Not yet verified on a real Firefox.
- The routes under `/api/extension` and `/api/app` are not counted as a client (`activity.ts`).

**Android app.** `/api/app` returns `{ available, size, built, versionCode, versionName, sha256 }` (the last three from the JSON `build.sh` writes next to the APK),
`/api/app/my-own-jdownloader.apk` the file. The APK folder is `/app/apk` in the container (`compose.yaml`: `./android/dist`).

## Android app

`android/` is a small Kotlin app (no libraries, minSdk 30) around the web UI. A phone browser has no extensions, so the app solves token
captchas, notifies, answers Click'n'Load, takes shared links and can lock itself. Nothing is installed on the host: it is built in a container.

```sh
android/build.sh
# -> android/dist/my-own-jdownloader.apk (+ .json with version code and SHA-256)
```

`build.sh` runs the build container and passes `-PversionCode` (minutes since 1970, so each build is newer than the one before). The backend
offers `android/dist/` (mounted into the app container, no rebuild needed for a new APK) and the app updates itself from it, see "Distributing the
extension and the app". Without the script the build is `docker run … gradle --no-daemon -q assembleDebug` in the image of `android/Dockerfile`.

The volume `myjd-android-home` holds the Gradle cache **and the debug signing key**: without it every build is signed with a new key and
cannot update the installed app (the data would be lost with an uninstall). `ANDROID_USER_HOME` in the `Dockerfile` points there. `adb` is
in the same image (`/opt/android-sdk/platform-tools`): wireless debugging needs `adb pair` once, then `adb connect <ip>:<port>` (the port changes
whenever wireless debugging restarts); `adb install -r` still works for a phone that cannot reach the backend. Changes to the web UI also need `docker compose up -d --build app`:
the app only shows what the backend serves.

| File (`android/app/src/main/java/app/myownjd/`) | Job |
| --- | --- |
| `Config.kt`, `Api.kt` | Settings kept on the phone (address, password, switches); blocking calls to the backend with Basic auth |
| `Ui.kt`, `Ambient.kt` | View helpers (screens are built in code): `configureForApp` (WebViews), `addBrand`, `ambientScreen`; the drifting background |
| `SetupActivity.kt` | First start |
| `MainActivity.kt` | WebView of the UI, file picker, error page, the bridge object `Android` (`UiBridge`) |
| `SolverActivity.kt` | Token captchas: answers the hoster page's request itself with a page that renders the widget; continues with the next captcha |
| `BackgroundService.kt`, `Notifier.kt` | The one foreground service (captchas, finished downloads, Click'n'Load) and the notifications |
| `CnlServer.kt`, `ChooseDeviceActivity.kt`, `ShareActivity.kt` | Click'n'Load on `127.0.0.1:9666`, the "share" target, the device choice for both |
| `Lock.kt` | App lock (`GuardedActivity` is the base class of every screen, `LockActivity`) |
| `BootReceiver.kt` | Starts the service after a restart |
| `Updater.kt` | Self-update: asks `/api/app`, downloads the APK, checks the SHA-256, hands it to Android's installer (`UpdateReceiver` gets the result); state is announced as `android-state` |

**The bridge.** The page gets `window.Android`; its typed shape is `frontend/src/appBridge.ts`, the implementation `UiBridge` in `MainActivity.kt`.
Every method first checks that the page comes from the backend's own address (`trusted()`); other sites never load in this WebView (they open
in the browser). The solver WebView loads hoster pages and gets only its own `Solver` object. State that changes on the phone (permission,
switches, lock) is announced with the window event `android-state`; the page reads it again, it keeps no copy. The settings group "App"
(`frontend/src/settings.ts`, scope `app`) only exists inside the app and is stored on the phone through the bridge, never in the backend.

Things to know:
- The solver trick needs the page to keep the hoster's origin: tokens are bound to the origin of the hoster page, so the solver loads that page itself and only adds the widget.
- Click'n'Load answers like a local JDownloader (`/jdcheck.js`, `/flash`, `/flash/add`, `/flash/addcrypted2`, CORS and
  `Access-Control-Allow-Private-Network`) and forwards the payload the extension sends.
- The lock is privacy only: the service reads the backend password without the user, so it cannot be encrypted behind the lock.
- A system dialog of the lock shows black in screenshots; `FLAG_SECURE` does too.
- The manifest allows clear-text http: the backend usually has no certificate.
- Settings pages for the phone: list and page per section (`SettingsView.vue`, the anchor is `#settings` and `#settings/<section>`), the shared
  styles of the app pages are in `appSettings.css`, the switch is `input.switch` / `label.check` in `global.css`.

## Development

Node and npm only run in containers: `docker compose run --rm dev npm install`, then for example
`docker compose run --rm dev npm run build`. See `compose.yaml` for the `dev` service.

# Developer guide

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

`backend/src/mcp.ts` serves MCP (Streamable HTTP, stateless) on `/mcp`, behind the same Basic auth as the UI (any username, `UI_PASSWORD` as password). Point a client at `http://<host>:<APP_PORT>/mcp`, e.g. `claude mcp add --transport http jd http://<host>:20031/mcp --header "Authorization: Basic <base64 of x:password>"`.

- Read tools: `list_devices`, `search_settings` (the JD settings are searched, not listed), `list_settings_group`, `list_plugins`, `plugin_settings`, `list_downloads`, `package_links`, `list_linkgrabber`, `list_accounts`, `list_captchas`. Every tool takes an optional `device` (name or id).
- Write tools (`set_setting`, `reset_setting`, `add_links`) only exist with `MCP_WRITE=true`. Values are checked against the setting's type and options; secrets and the groups this app manages itself are refused.
- There is deliberately no tool to stop, pause or delete downloads.

## Development

Node and npm only run in containers: `docker compose run --rm dev npm install`, then for example
`docker compose run --rm dev npm run build`. See `compose.yaml` for the `dev` service.

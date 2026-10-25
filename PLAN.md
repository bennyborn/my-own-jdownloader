# my-own-jdownloader – Projektplan

Ziel: Moderner, stabiler Ersatz für die Weboberfläche von https://my.jdownloader.org.
Der bestehende JDownloader auf dem Server bleibt unverändert und verbindet sich weiter mit
dem MyJDownloader-Dienst. Unser Projekt spricht dessen öffentliche API an.

## Entscheidungen

- **Weg A:** neues UI auf der bestehenden MyJDownloader-API (api.jdownloader.org).
  Keine Änderung am JDownloader nötig (außer den Einstellungen für den Captcha-Solver, siehe unten).
- **Stack:** TypeScript, Node-Backend (Fastify), Frontend in **Vue.js** (Vue 3, Vite), Docker.
- **Mehrere Geräte:** Das Backend hält pro JDownloader-Gerät einen eigenen Kontext (`devices.ts`: Poller, Linkgrabber,
  Captchas, Verlauf, Konten, Config, eigener Anti-Captcha-`ApiKey`). Anfragen wählen das Gerät mit `?device=<id>`
  (oder `device` im Body), sonst gilt das Standardgerät. `MYJD_DEVICES` schränkt die Geräte ein, `MYJD_DEVICE` setzt das Standardgerät.
- **Backend nötig**, weil: Requests sind AES-128-CBC-verschlüsselt und HMAC-SHA256-signiert,
  Sessions laufen ab (Reconnect), CORS blockiert vermutlich den direkten Browser-Zugriff,
  die API hat kein Push (das Backend pollt und reicht per SSE weiter).
- **Browser-Extension** (`extension/`, Manifest V3, derzeit nur Chrome) für alles, was im Browser des Nutzers
  passieren muss: Captchas auf der Hoster-Seite lösen, Click'n'Load, Benachrichtigungen, Überblick im Popup.
- Später optional: Weg B (Direktverbindung zum JDownloader, Port 3129, gleiches Protokoll)
  und Weg C (eigener MyJD-Server; nur sinnvoll, wenn die Server-Adresse im JDownloader umstellbar ist).

## Architektur

```
Browser (UI) <--REST/SSE--> Backend (Node/TS) <--verschlüsselt--> api.jdownloader.org <--> JDownloader
Browser-Extension <--REST--> Backend            (JDownloader --Anti-Captcha-Protokoll--> Backend)
```

- Backend kapselt Login, Verschlüsselung, Reconnect, Geräteliste, Polling.
- Zugangsdaten nur per Umgebungsvariablen / `.env` (nie committen, nie loggen).
- Das UI bekommt eine einfache REST/SSE-Schnittstelle, kennt die MyJD-Details nicht.
- **Login-Schutz:** HTTP Basic mit `UI_PASSWORD` für UI und API. Ausgenommen sind nur das Logo, das Web-App-Manifest
  und die Icons (Browser holen sie ohne Zugangsdaten) sowie die Anti-Captcha-Aufrufe von JD, die sich über ihren
  `clientKey` ausweisen. Mit gesetztem Passwort noch nicht ausprobiert.
- **Schutz des JDownloaders:** Der API-Client sperrt nichts mehr (1:1-Kompatibilität mit MyJDownloader,
  auch `/config/set`, `/system` und `/update` gehen durch).
  Die früheren Sperren für laufende Downloads (Umbenennen, Entfernen, Merge … nur ohne laufenden Download) sind bewusst
  entfernt: Die Aktionen gehen jetzt immer durch.

## Phasen

| # | Phase | Inhalt | Stand |
|---|-------|--------|-------|
| 1 | Protokoll-Client | Login, Verschlüsselung, Reconnect, Geräteliste, erste Calls gegen die echte Instanz | fertig |
| 2 | Backend-Schicht | REST, SSE, Polling der Downloadliste, Fehlerbehandlung | fertig |
| 3 | Basis-UI (MVP) | Downloadliste mit Paketen, Geschwindigkeit, Fortschritt, Umsortieren | fertig |
| 4 | Linkgrabber | Links einfügen, Pakete prüfen, in Downloads verschieben | fertig |
| 5 | Extras | Einstellungen, mehrere Geräte, Mobilansicht | Einstellungen, Konten und mehrere Geräte fertig; Mobilansicht und Regel-Editoren offen |
| 6 | Docker/Deployment | Container, Login-Schutz, Doku | Container, Login-Schutz und Entwickler-Doku (`DEVELOPER.md`) fertig, Nutzer-Doku offen |
| – | Plugins, MCP | siehe unten | umgesetzt |
| – | Captcha | siehe unten | umgesetzt |
| – | Click'n'Load, Extension | siehe unten | umgesetzt (Chrome) |

## Referenz für das Protokoll

- Offizielle Extension (Firefox, MV2, v3.3.20, enthält den offiziellen JS-Client):
  https://extensions.jdownloader.org/firefox.xpi
  (ZIP-Archiv; in einen eigenen leeren Ordner entpacken und nur lesen.)
- Relevant darin: `vendor/js/jdapi.js` (MyJD-API-Client, Krypto via `crypto-js`),
  `scripts/services/MyjdService.js`, `scripts/services/MyjdDeviceService.js`, `scripts/services/Rc2Service.js`
  (Captcha), `scripts/services/CnlService.js` (Click'n'Load).
- Der Code gehört AppWork und hat keine erkennbare Lizenz: nur als Referenz für Protokoll und
  Verhalten lesen, alles selbst neu schreiben, nichts kopieren.
- Die Chrome-Version ist aus dem Chrome Web Store entfernt (Manifest V3).
- **Die API beschreibt sich selbst:** `POST /<namespace>/help` (z. B. `/captcha/help`) liefert die komplette Doku
  als **unverschlüsseltes HTML** (alle Methoden, Parameter, Enums). So wurden `solve`, `skip` und `addcnl` gefunden.

## Erkenntnisse zur JD-API

- Antworten der `/flash/*`-Schnittstelle (Click'n'Load) und der `help`-Aufrufe sind **nicht** verschlüsselt; der
  Client wertet sie deshalb nicht aus.
- `/config/list` liefert Namen und (mit `returnValues`) Werte aller Einstellungen. Geheimnisse (`ApiKey`,
  Passwörter) nie ausgeben. Das Muster für `pattern` muss den ganzen Namen treffen (`.*Foo.*`).
- Statusmeldungen der Links kommen von JD als Text (`Download`, `Wait 24s`, `Captcha recognition`,
  `Skipped - Captcha is required`, Hoster-Limits wie "You can't download more than one file within a certain time
  period in free mode"). Wartende Links ohne Grund haben keinen Status.
- `MaxSimultaneDownloadsPerHost` (Allgemein) steht auf 1. Für k2s mit (abgelaufenem) Konto laufen trotzdem mehrere
  Downloads, bei Rapidgator und ddownload ohne Konto begrenzen zusätzlich die Hoster selbst.

## Captcha (umgesetzt, Stand: Chrome, getestet mit ddownload und Rapidgator)

Drei Arten, je nach Captcha-Typ:

- **Bild-Captchas (z. B. k2s, `BasicCaptchaChallenge`):** Die Web-UI zeigt einen Dialog (Bild, Eingabe, Aktualisieren,
  Skip-Auswahl, Restzeit). Das Bild kommt über `/captcha/get`, die Antwort geht mit `/captcha/solve(id, text)` zurück,
  Skip/Aktualisieren mit `/captcha/skip(id, type)`. Gegen den echten JD getestet.
- **Token-Captchas, die JD als Job meldet (hCaptcha, reCAPTCHA v2):** JD legt einen Job an (`/captcha/list`). Das Backend
  holt Site-Key und Seiten-URL (`/captcha/get` mit Format `rawtoken`; ohne das Format kommt `null`) und gibt den
  Token mit `/captcha/solve` (id, token, `rawtoken`) zurück. Die Variante `solve(id, result)` kennt nur Bild-Captchas
  und antwortet bei Token-Captchas mit `UNKNOWN_CHALLENGETYPE`.
- **Typen, die JD nicht selbst anzeigen kann (Cloudflare Turnstile):** JD legt keinen Job an, sondern bricht mit
  "Skipped - Captcha is required" ab. Dafür trägt sich das Backend beim Start als Anti-Captcha-Server in der alten
  Solver-Gruppe (`AntiCaptchaComConfigInterface`: `ApiBase`, `ApiKey`, `Enabled`) ein. JD schickt dann
  `createTask` (`TurnstileTaskProxyless`) und fragt `getTaskResult` etwa jede Sekunde ab, das Backend liefert den
  Token, sobald die Extension ihn zurückgegeben hat. Die neue Plugin-Gruppe (`CaptchaSolverPluginConfig…`) hat keine
  einstellbare Adresse und ist nicht umleitbar. Andere Aufgabentypen lehnt der Endpunkt ab.

Ablauf bei Token-Captchas: Popup, Badge und Benachrichtigung zeigen offene Captchas, "Solve" öffnet die echte
Hoster-Seite mit dem Marker `#myjd-captcha=<id>`. Die Seite wird durch eine leere Karte im Stil der UI ersetzt (die
Domain bleibt, der Token ist daran gebunden), darauf rendert das Widget mit dem Site-Key von JD. Direkt in der Web-UI
ist das nicht möglich, weil der Token an die Domain des Hosters gebunden ist.

- **Eintragung in JD:** nur wenn `JD_SOLVER_URL` gesetzt ist (Adresse, unter der JD das Backend erreicht, in der `.env`).
  Pro Gerät liegen die vorherigen Werte in `data/solver-<Geräte-ID>.json` im Volume (das Standardgerät übernimmt eine alte `data/solver.json`), `backend/src/solver-restore.ts [Gerätename ...]` setzt sie zurück. JD setzt sich dabei nicht auf eine fremde Anti-Captcha-Einrichtung (ein eigener aktiver Dienst bleibt unberührt).
- **Grenzen:** Tasks aus dem Anti-Captcha-Endpunkt liegen nur im Speicher (Neustart = weg), JDs Wartezeit auf den Token
  ist unbekannt, reCAPTCHA v3 ist nicht abgedeckt, Firefox braucht ein eigenes Manifest (`background.scripts`).

## Click'n'Load (umgesetzt, Chrome, mit Filecrypt getestet)

Die Browser-Extension übernimmt, was Websites an "einen JDownloader auf diesem Rechner" (127.0.0.1:9666) schicken.

- `jdcheck.js` wird per `declarativeNetRequest` mit `var jdownloader = true;` beantwortet, damit Seiten ihren Button zeigen.
- `fetch`, `XMLHttpRequest` und Formulare an `/flash/add` und `/flash/addcrypted2` werden im Seitenkontext abgefangen
  (`cnl-main.js`, MAIN world), die Seite bekommt `success`. Die Extension schickt Links, `jk`/Schlüssel, Passwörter, Paketname
  und Quelle an `POST /api/linkgrabber/cnl`; das Backend gibt sie an `/flash/addcnl` von JD weiter (JD entschlüsselt selbst).
- Die Links landen nur im Linkgrabber (kein Autostart). Gleiche Links innerhalb von 15 Sekunden werden nur einmal gesendet.
- Das Ergebnis erscheint in unserem Stil: in Hilfsfenstern ersetzt die Karte die ganze Seite, sonst steht sie unten rechts.
  Mit Logo, Paket-/Link-/Größenzähler und "Open linkgrabber". Ein-/ausschaltbar in den Einstellungen der Extension.

## Einstellungen, Konten, Plugins, MCP (umgesetzt)

- **Einstellungen** (`SettingsView.vue`): Seite "JDownloader" wird aus `/config/list` des Geräts erzeugt (`jdconfig.ts`), schreibt
  mit `/config/set` und `/config/reset`, Geheimnisse gehen nie ans UI. Pro Hoster/Plugin eine eigene, durchsuchbare Seite (`HosterSettings.vue`).
  Details in `DEVELOPER.md`.
- **Konten** (`accounts.ts`, `AccountSettings.vue`): Premium-Konten pro Gerät über `/accountsV2` (Liste, hinzufügen, entfernen,
  an/aus, Status, Restlaufzeit und Traffic). Passwörter gehen nur zum Gerät.
- **Plugins** (`plugins.ts`, `plugins/`): vertrauter Code in einem Ordner, Backend-Teil plus Vue-Komponente für feste Blöcke
  im UI. Beispiele: `tmdb-poster` (Poster am Paket), `youtube-thumbnail`. Siehe `DEVELOPER.md`.
- **MCP-Server** (`mcp.ts`, `mcplog.ts`) auf `/mcp`: dieselben Dienste für einen Assistenten, Einstellungen werden gesucht statt gelistet.
  Schreibende Tools nur mit `MCP_WRITE=true` (oder Schalter auf der Einstellungsseite), nichts zum Stoppen/Pausieren/Löschen von Downloads.
  Aufrufe lassen sich auf der Einstellungsseite mitschneiden.
- **Download-Liste:** Entpack-Status pro Paket/Link, Archiv-Einstellungen und "Extract now", "Reset", Varianten-Auswahl im Linkgrabber
  (z. B. YouTube-Qualitäten), Erfolgsmeldung, wenn ein Paket fertig ist.
- **Mehrere Geräte im UI:** Geräteauswahl (`DevicePicker.vue`), Übersicht über alle Geräte, Gerät beim Hinzufügen von Links,
  Captchas aller Geräte; Extension und Click'n'Load wählen das Gerät (Standard, feste Wahl oder "jedes Mal fragen").
  Mit zwei Test-JDownloadern geprüft (`test-devices/run.sh`).
- **Container:** Der Host-Port kommt aus `APP_PORT` (`.env`), im Container läuft die App immer auf 3000. `./plugins` wird eingebunden.

## Status

- **Phasen 1–4 sind umgesetzt.** Dazu:
  - Statusleiste mit Geschwindigkeitsgraph (Verlauf im Backend, geht beim Neustart verloren), Theme, Toasts,
    Benachrichtigungen, Logo/Favicon/Web-App-Manifest.
  - Download-Liste und Linkgrabber: Kontextmenü (Rename/F2, Enable/Disable, Ordner, Links anzeigen, Entfernen mit und
    ohne Dateien, Zusammenführen, Aufteilen nach Hoster, Hoster abwechselnd sortieren, Start download, an den Anfang/ans
    Ende), Mehrfachmarkierung (Pakete Strg+Klick, Links Klick/Strg/Umschalt), Umsortieren per Drag-and-drop,
    Drag-and-drop-Upload von Container-Dateien und Links, Hoster-Icons mit aktiven Hostern, gemerkte aufgeklappte Pakete.
  - Captcha (alle drei Arten), Click'n'Load, Extension mit Popup (Gerätekarte, Graph, Captchas), Benachrichtigungen.
  - Container, UI-Login (`UI_PASSWORD`).
  - Einstellungen, Konten, mehrere Geräte, Plugins, MCP (siehe oben).
- **Offen:** Mobilansicht, die Lücken unter TODO und die Nutzer-Doku (Phase 6).

## TODO

- Gaps against MyJDownloader, derived from the JD settings (the generic Settings > JDownloader page already covers every
  plain value; these need their own UI because the value is a table, a list of rules or an action). Accounts, per-plugin
  settings and multiple devices are done:
  - Rule editors (today only raw JSON): link filter (`LinkFilterSettings.FilterList`), packagizer (`PackagizerSettings.RuleList`),
    hoster rules (`HosterRuleConfig.Rules`; they need the accounts, which exist now), filename / package name replace maps (`FilenameReplaceMap`, `PackagenameReplaceMap`,
    `FilenameTooLongRegexReplaceMap`), domain rules (`DomainRules`), custom proxies (`InternetConnectionSettings.CustomProxyList`).
  - Plugin blacklists (`CrawlerHostPluginBlacklist`, `CrawlerCrawlerPluginBlacklist`) as a picker (the per-plugin settings pages exist).
  - Quick controls in the status bar instead of a trip to the settings: speed limit on/off and value (`DownloadSpeedLimit*`),
    max. simultaneous downloads, pause with its speed (`PauseSpeed`), silent mode (`SilentModeSettings.ManualEnabled`),
    free disk space (`ForcedFreeSpaceOnDisk`, storage infos).
  - Linkgrabber toolbar: toggles for auto confirm / auto start (`LinkgrabberAutoConfirmEnabled`, `LinkgrabberAutoStartEnabled`),
    quick filters by hoster and file type (`LinkFilterSettings.*Quickfilter*`), handling of offline, duplicate and incomplete archive
    links (`DefaultOnAdded*LinksAction`, `Handle*OnConfirmLatestSelection`).
  - Add-links dialog: the options JD's own dialog has (priority, auto extract, archive passwords, packagizer override,
    duplicates, destination and package name history `DownloadDestinationHistory`, `PackageNameHistory`), with the JD defaults.
  - Reconnect: "Reconnect now", the current IP, the active method (`ReconnectConfig.ActivePluginID`) and its settings
    (LiveHeader scripts, UPnP).
  - Extraction: password list editor (`ExtractionConfig.PasswordList`, one per line works today), the blacklist patterns, and
    something for the dialogs JD would show (unknown archive password, file exists); check whether the API can answer JD dialogs.
  - Updates: show whether one is available and run it (`/update/*`), JD version in the settings header.
  - Settings page itself: readable German/English labels and units for the important keys (many values are milliseconds or
    bytes), "restart needed" hints, a filter "only changed", expert settings folded away, export/import of the JD config.
  - Unknown to check against the original: whether MyJDownloader offers anything beyond this (e.g. log upload, scheduler,
    RSS-like link sources); compare with the original's menu once.
- Backend start: if api.jdownloader.org is unreachable the process exits and Docker restarts it in a loop (seen once). Retry with
  a delay instead, ideally with the server already listening and a "MyJDownloader not reachable" page.
- Web UI notifications only work over https or on localhost (not on `http://server:port`); document it, or put the UI behind a
  reverse proxy with a certificate. The extension's notifications work everywhere.
- Browser extension: Firefox manifest (`background.scripts` instead of `service_worker`); revise the design of the captcha page.
- Captcha tasks from the Anti-Captcha endpoint only live in memory; decide whether to keep them across restarts.
- Hoster limits: links that wait because of a hoster limit only show JD's text (tooltip); a short badge ("hoster limit") would help.
- Mobile layout (phase 5) is still open; only a few `@media` rules exist.
- Show "open connections" metric in the status bar (API call still unknown).
- Resolve more plugin-internal URLs (only YouTube has been checked).
- Tested against the real JDownloader (checked = confirmed by the user):
  - [x] Rename package and link
  - [x] Enable/disable (also several marked links)
  - [x] Change download folder
  - [x] Reorder packages and links by drag and drop (downloads and linkgrabber)
  - [x] Move to top / bottom (packages and links, also several marked)
  - [x] Remove, keeping the files; remove, deleting the files; the "delete files" choice is remembered
  - [x] Merge packages (downloads and linkgrabber), split by host
  - [x] Interleave hosters
  - [x] Start download (force start, enabling the item first)
  - [x] Image captcha dialog: solve, skip variants, refresh, the countdown
  - [ ] Web UI notifications over https
  - [ ] Set `UI_PASSWORD` and check logo, manifest, icons and the Anti-Captcha endpoints still work

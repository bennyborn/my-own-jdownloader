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
- **Browser-Extension** (`extension/`, Manifest V3, Chrome und Edge; das Firefox-Paket ist gebaut, aber noch nicht abgenommen) für alles, was im Browser des Nutzers
  passieren muss: Captchas auf der Hoster-Seite lösen, Click'n'Load, Benachrichtigungen, Überblick im Popup.
- **Nächster großer Meilenstein: Weg B, Direktverbindung zum JDownloader** (gleiches Protokoll, die Datenaufrufe gehen im LAN direkt
  zum Gerät; siehe den Abschnitt „Nächster Meilenstein“). Weg C (eigener MyJD-Server) bleibt optional und nur sinnvoll, wenn die
  Server-Adresse im JDownloader umstellbar ist.

## Architektur

```
Browser (UI) <--REST/SSE--> Backend (Node/TS) <--verschlüsselt--> api.jdownloader.org <--> JDownloader
Browser-Extension <--REST--> Backend            (JDownloader --Anti-Captcha-Protokoll--> Backend)
Android-App (WebView der UI + Dienst) <--REST/SSE--> Backend
```

- Backend kapselt Login, Verschlüsselung, Reconnect, Geräteliste, Polling.
- **Das Backend fragt die MyJD-API nur, wenn ein Client etwas will** (Zwischenspeicher, Bremse, keine eigenen Timer; Abschnitt „MyJD-API schonen“).
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
| 5 | Extras | Einstellungen, mehrere Geräte, Mobilansicht | Einstellungen, Konten, mehrere Geräte und Mobilansicht fertig; Regel-Editoren offen |
| 6 | Docker/Deployment | Container, Login-Schutz, Doku | Container, Login-Schutz und Entwickler-Doku (`docs/DEVELOPER.md`) fertig, Nutzer-Doku offen |
| – | Plugins, MCP | siehe unten | umgesetzt |
| – | Captcha | siehe unten | umgesetzt |
| – | Click'n'Load, Extension | siehe unten | umgesetzt (Chrome; Firefox gebaut, ungeprüft) |
| – | Android-App | siehe unten | umgesetzt, Teile noch nicht abgenommen |
| – | Extension und App verteilen | siehe unten | umgesetzt, Firefox ungeprüft |
| – | MyJD-API schonen | siehe unten | umgesetzt |
| 7 | **Direktverbindung** | siehe unten | **nächster Meilenstein** |

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
  ist unbekannt, reCAPTCHA v3 ist nicht abgedeckt. Firefox bekommt sein eigenes Manifest (siehe „Extension und App verteilen“).

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
  Details in `docs/DEVELOPER.md`.
- **Konten** (`accounts.ts`, `AccountSettings.vue`): Premium-Konten pro Gerät über `/accountsV2` (Liste, hinzufügen, entfernen,
  an/aus, Status, Restlaufzeit und Traffic). Passwörter gehen nur zum Gerät.
- **Plugins** (`plugins.ts`, `plugins/`): vertrauter Code in einem Ordner, Backend-Teil plus Vue-Komponente für feste Blöcke
  im UI. Beispiele: `tmdb-poster` (Poster am Paket), `youtube-thumbnail`. Siehe `docs/DEVELOPER.md`.
- **MCP-Server** (`mcp.ts`, `mcplog.ts`) auf `/mcp`: dieselben Dienste für einen Assistenten, Einstellungen werden gesucht statt gelistet.
  Schreibende Tools nur mit `MCP_WRITE=true` (oder Schalter auf der Einstellungsseite), nichts zum Stoppen/Pausieren/Löschen von Downloads.
  Aufrufe lassen sich auf der Einstellungsseite mitschneiden.
- **Download-Liste:** Entpack-Status pro Paket/Link, Archiv-Einstellungen und "Extract now", "Reset", Varianten-Auswahl im Linkgrabber
  (z. B. YouTube-Qualitäten), Erfolgsmeldung, wenn ein Paket fertig ist.
- **Mehrere Geräte im UI:** Geräteauswahl (`DevicePicker.vue`), Übersicht über alle Geräte, Gerät beim Hinzufügen von Links,
  Captchas aller Geräte; Extension und Click'n'Load wählen das Gerät (Standard, feste Wahl oder "jedes Mal fragen").
  Mit zwei Test-JDownloadern geprüft (`test-devices/run.sh`).
- **Weitere Seiten** (Einstellungen): Basic authentication, System info, Extensions, Context menu (im Backend gespeichert), siehe Status.
- **Container:** Der Host-Port kommt aus `APP_PORT` (`.env`), im Container läuft die App immer auf 3000. `./plugins` wird eingebunden.

## Android-App (umgesetzt, `android/`)

Der Handy-Browser hat keine Extensions, deshalb gibt es eine eigene App (Kotlin, ohne Bibliotheken, ab Android 11). Sie ist eine
dünne Hülle um die Web-UI und übernimmt, was nur nativ geht. Entscheidung: kein Tauri/Capacitor; ein Desktop-Pendant wäre
höchstens wieder ein WebView auf dieselbe UI. Der Remote-Browser im Container bleibt als Notlösung (iOS).

- **Hülle:** WebView der Backend-Adresse (Basic-Auth), fremde Links öffnen im Browser, Datei-Auswahl, kein Pinch-Zoom, kein
  Überscroll-Effekt, kein Scrollbalken. Adresse und Passwort liegen nur in den privaten App-Daten (Einrichtungsscreen, danach
  Settings-Gruppe „App“ ganz oben). Bei einem Ladefehler gibt es eine Fehlerseite mit „Try again“ / „Change connection“.
- **Bridge** `window.Android` (Typen in `frontend/src/appBridge.ts`): gilt nur, solange die Seite von der Backend-Adresse kommt.
  Der Solver lädt fremde Seiten und bekommt ein eigenes Objekt, das nur den Token zurückgibt.
- **Solver:** Turnstile, hCaptcha und reCAPTCHA v2 in einem WebView, dessen Hauptanfrage die App selbst beantwortet
  (`shouldInterceptRequest`): leere Seite mit dem Widget unter der Domain des Hosters, wie die Extension. Der Token geht an
  `POST /api/captcha/:id/solve`. Danach weiter mit dem nächsten offenen Captcha, am Ende zurück oder zu den Downloads
  (einstellbar). Getestet mit vikingfile.com (Turnstile): von der Meldung bis zum Download.
- **Ein Vordergrunddienst** (`BackgroundService`) für das, was an ist, mit **einer** Dauermeldung, die sagt, was läuft:
  - die Glocke: neue Captchas (alle 15 s) und fertige Downloads (alle 30 s), nur wenn die App nicht vorne ist,
  - Click'n'Load.
- **Click'n'Load** (`CnlServer`): antwortet lokal auf `127.0.0.1:9666` wie ein JDownloader und gibt die Links an
  `/api/linkgrabber/cnl`. Dazu „Teilen“ aus anderen Apps (`ShareActivity`). Zielgerät: Standard, fest oder jedes Mal fragen.
- **Sperre:** Fingerabdruck/Gesicht/PIN des Handys, nach 0/1/5/15 Minuten im Hintergrund erneut; optional `FLAG_SECURE`. Das ist
  Privatsphäre, keine Sicherheit: Die Dienste brauchen das Backend-Passwort ohne den Nutzer, es liegt unverschlüsselt in den App-Daten.
- Start der Dienste nach dem Booten, adaptives Icon mit Themed-Icon-Ebene, Einrichtungs- und Sperrbildschirm mit ruhig
  treibendem Hintergrund.
- **Web-UI auf dem Handy:** Settings als Liste mit Detailseite (Zurück-Taste und Pfeil führen zur Liste), einklappbare Gruppen mit
  Zählbox, Schalter statt Häkchen, Werte in der Zeile des Namens; Platzhalter `LoadingState`; Dialoge mit Blur, Rauschen gegen
  Banding und Einblend-Effekt; Auswahlfelder mit demselben Chevron wie die grafischen Dropdowns.
- **Update:** die App holt die APK vom Backend (siehe „Extension und App verteilen“).
- **Grenzen:** nur Android, nur per Sideload (der Debug-Schlüssel liegt im Docker-Volume `myjd-android-home`). Noch nicht auf dem Gerät abgenommen: Click'n'Load samt Chromes Abfrage zum lokalen Netzwerk, Teilen, „Ask
  every time“, Start nach dem Booten. Die Akku-Optimierung mancher Hersteller kann den Dienst beenden.

## Extension und App verteilen (umgesetzt)

Das Backend liefert die Browser-Extension und die Android-App selbst aus und hält sie aktuell; Einstellungen > „Browser extension / App“
(`BrowserExtensionSettings.vue`) ist die Anlaufstelle für die Erstinstallation.

- **Extension** (`backend/src/extension.ts`): Das Image enthält den Ordner `extension/`. Pro Browser-Art ein Paket (`EXTENSION_TARGETS`: `chromium`
  und `firefox`), alle aus demselben Ordner, sie unterscheiden sich nur im Manifest. `GET /api/extension` nennt Ziele und Version,
  `/api/extension/:target` die Dateiliste mit Prüfsummen, `/file?path=` einzelne Dateien, `/extension.zip` das ZIP für die Erstinstallation.
  Die Version steht in `extension/manifest.json` und muss mit jeder Änderung steigen (der Vergleich der Extension und AMO hängen daran).
- **Selbst-Update der Extension** (`extension/update.js`, Optionsseite): „Check for updates“ / „Update to x“ schreibt die geänderten Dateien in
  den Ordner, aus dem die Extension geladen ist (File System Access API, der Ordner wird einmal gewählt), und lädt sie neu. Nur Chromium.
- **Firefox** (`backend/src/firefox.ts`): Release-Firefox installiert nur von Mozilla Signiertes. Jede Installation signiert für sich: Mit
  `AMO_JWT_ISSUER` / `AMO_JWT_SECRET` und `PUBLIC_URL` (https, nur darüber aktualisiert Firefox) schickt das Backend sein Paket als *unlisted*
  an addons.mozilla.org und liefert die signierte XPI samt `updates.json` aus. Die Add-on-ID ist pro Installation eigen (einmal erzeugt im
  Datenordner, oder `EXTENSION_FIREFOX_ID`). **Gebaut, aber nie auf einem echten Firefox geprüft.** Ohne `PUBLIC_URL` gibt es kein Firefox-Paket.
- **App** (`/api/app`, `/api/app/my-own-jdownloader.apk`): `android/build.sh` baut die APK in den Ordner `android/dist/` (mit wachsendem `versionCode`,
  Minuten seit 1970) und schreibt Version und SHA-256 daneben. Der Ordner ist in den App-Container eingebunden, ein neuer Build braucht keinen
  neuen Container. Die App (`Updater.kt`) fragt beim Start und per Knopf (Einstellungen > App update), lädt die APK, prüft die Prüfsumme und
  übergibt sie dem Installer von Android, der einmal nachfragt. Keine Timer. Ohne APK im Ordner wird nichts angeboten.
- Die Aufrufe unter `/api/extension` und `/api/app` zählen nicht als Client (siehe `activity.ts`).

## MyJD-API schonen (umgesetzt)

Die MyJD-API gehört nicht uns. Regel: **Das Backend fragt sie nur, wenn ein Client etwas will, und nie öfter als nötig.** Das
gilt unabhängig davon, wie viele Clients fragen. Umgesetzt in `backend/src/myjd/client.ts`, `shared.ts` und `activity.ts`:

- **Lesen aus dem Merker:** Lesende Aktionen werden kurz gemerkt (Download- und Linkgrabber-Listen 1 bis 1,5 s, Captchas 2 s,
  Stop-Marke 3 s, Konten 10 s, Hoster 60 s, Konfiguration und Ordner 30 s). Gleichzeitige Anfragen teilen sich einen Aufruf. Jede
  Aktion, die etwas verändern könnte, verwirft die Merker **dieses Geräts** (ein Zähler pro Gerät; er verhindert auch, dass ein
  Lesevorgang, der während der Änderung lief, für den neuen Stand gemerkt wird). Unbekannte Aktionen gelten als verändernd.
- **Bremse im Client:** höchstens 8 Aufrufe gleichzeitig, 30 ms Abstand, nach einer 429 Pause (2 s, verdoppelt bis 60 s; nur bei
  429, denn ein offenes Gerät darf die anderen nicht bremsen), 20 s Timeout pro Aufruf, ein gemeinsamer Login, wenn die Sitzung abläuft.
- **Keine Timer, die von allein fragen:** Die Geräteliste, der Online-Status und die Solver-Prüfung werden erst auf Anfrage
  aufgefrischt, wenn die letzte Abfrage älter als ein paar Sekunden ist. Die Geschwindigkeit wird nur gemessen, solange jemand
  zuschaut (SSE der Oberfläche, oder das Popup fragt den Graphen, 15 s Lease). Der Graph hat deshalb keine Vorgeschichte vor dem Öffnen.
- **Messbar:** `/api/health` zeigt `myjdCalls` (Aufrufe seit dem Start) und wer zuletzt angefragt hat (`clients`). Gemessen: ohne
  Client 0 Aufrufe in 60 s; eine Hintergrund-Abfrage der Extension kostet 3 Aufrufe (3 Geräte); 40 gleichzeitige Anfragen kosten
  so viel wie eine. Vorher lagen im Leerlauf rund 90 000 Aufrufe am Tag an.
- **Clients:** ein versteckter Tab fragt die Captcha-Liste nicht ab, der Dienst der App ruht, solange die App vorne ist.
- Zu wissen: Änderungen, die nicht über unsere API laufen (zum Beispiel direkt in JD am Desktop), sieht die Oberfläche erst nach der
  Gültigkeit des Merkers.

## Nächster Meilenstein: Direktverbindung zum JDownloader

Ziel: Die **Datenaufrufe** (Downloads, Linkgrabber, Captchas, Geschwindigkeit) gehen im LAN direkt zum JDownloader statt über das
MyJD-Relay. Bei MyJD bleiben Login, Geräteliste und die Frage nach der Direkt-Adresse, das sind ein paar Aufrufe pro Stunde.

**Geprüft** (26.10.2026, lesend, gegen „Jarvis“):
- `MyJDownloaderSettings.DirectConnectMode = LAN`, `ManualLocalPort 3129`, `LastLocalPort 33549`. Die Direktverbindung ist an.
- `/device/getDirectConnectionInfos` liefert `172.31.0.2:33549` und `127.0.0.1:33549` (Modus LAN).
- Ein direkter Aufruf `http://172.31.0.2:33549/t_<sessiontoken>_<deviceid>/downloadcontroller/getSpeedInBps`, verschlüsselt wie bisher mit
  der MyJD-Sitzung, wurde beantwortet (HTTP 200). **Antwortzeit 2 bis 4 ms, über das Relay 33 bis 40 ms.**
- Das Gerät **prüft die Sitzung**: Mit einem erfundenen Token riss die Verbindung ab. Es bleibt authentifiziert, die Nutzdaten sind AES-verschlüsselt.
- **Hürde ist das Netz:** JD läuft im Docker-Netz `jdownloader_default` (172.31.0.0/16), unser Backend in
  `my-own-jdownloader_default`. Aus unserem Container ist 172.31.0.2 nicht erreichbar, vom Host aus schon.

**Plan:**
1. **Netz:** `compose.yaml` bekommt `jdownloader_default` (Jarvis) und `jd-test_default` (Test-Geräte) als externe Netze. Das ändert
   nur unseren Container, nicht JD. (Der andere Weg, JDs Port zu veröffentlichen und `CustomDeviceIPs` zu setzen, ändert das laufende JD.)
2. **Client** (`myjd/client.ts`): pro Gerät automatisch eine Route wählen. `getDirectConnectionInfos` einige Minuten merken, die erreichbare
   Adresse mit kurzem Timeout nehmen, den Aufruf direkt senden; ist sie nicht erreichbar, geht **dieser Aufruf** über das Relay, und die Route wird
   etwa eine Minute gemieden. Verschlüsselung, Pfad und Sitzungsfehler bleiben wie heute.
3. **Notschalter:** `MYJD_DIRECT=off` in der `.env` (Standard: automatisch).
4. Zwischenspeicher und Bremse bleiben: Bei Direktverbindung trifft die Last JD selbst, und das ist ein schwächerer Server als MyJD.
5. **Prüfen:** Latenz, JD-Neustart (der Port wechselt vermutlich, die Adresse wird frisch abgefragt), Gerät offline, Sitzungsablauf;
   `/api/health` zeigt, wie viele Aufrufe direkt und wie viele über das Relay gingen.

**Bewusst nicht:** die alte Remote-API von JD (`RemoteAPIConfig.DeprecatedApi*`, Port 3128). Sie läuft ganz ohne MyJD, ist aber
unauthentifiziert, standardmäßig nur auf localhost und trägt „deprecated“ im Namen. Nur für einen Betrieb ganz ohne MyJD-Konto,
und dann nur in einem abgeschotteten Netz.

## Status

- **Phasen 1–4 sind umgesetzt.** Dazu:
  - Statusleiste mit Geschwindigkeitsgraph (Verlauf im Backend, geht beim Neustart verloren), Theme, Toasts,
    Benachrichtigungen, Logo/Favicon/Web-App-Manifest.
  - Kontextmenü, konfigurierbar (Einstellungen > Context menu, im Backend gespeichert für alle Browser: `ui-settings.json` im Datenordner, `frontend/src/menuConfig.ts`): ergänzt um Online-Status prüfen,
    Downloadpasswort, Priorität (standardmäßig aus), Fortsetzen, Archiv-Passwort hinzufügen, Säubern (fertig / fehlgeschlagen / deaktiviert /
    offline / Duplikate; "unvollständig" und "Archiv prüfen" gibt die JD-API nicht her). Neue JD-Aufrufe immer erst auf den Test-JDs ausprobieren.
  - Download-Liste und Linkgrabber: Kontextmenü (Rename/F2, Enable/Disable, Ordner, Links anzeigen, Entfernen mit und
    ohne Dateien, Zusammenführen, Aufteilen nach Hoster, Hoster abwechselnd sortieren, Start download, an den Anfang/ans
    Ende), Mehrfachmarkierung (Pakete Strg+Klick, Links Klick/Strg/Umschalt), Umsortieren per Drag-and-drop,
    Drag-and-drop-Upload von Container-Dateien und Links, Hoster-Icons mit aktiven Hostern, gemerkte aufgeklappte Pakete.
  - Captcha (alle drei Arten), Click'n'Load, Extension mit Popup (Gerätekarte, Graph, Captchas), Benachrichtigungen.
  - Container, UI-Login (`UI_PASSWORD`).
  - Einstellungen, Konten, mehrere Geräte, Plugins, MCP (siehe oben).
  - Mobilansicht und Android-App (siehe oben), MyJD-API schonen (siehe oben).
  - Header: Start / Pause / Stop für das ganze JD (nur bei einem gewählten Gerät, nicht in "All devices"; Start und Stop mit
    Rückfrage), dazu ein dritter Button bei verfügbarem Update (Rückfrage, startet JD neu). Am Handy ganz links, am Desktop
    in der Mitte. In der Pause: Schnecke hinter der Geschwindigkeit, gestrichelte Limit-Linie im Graphen (Pause-Speed, sonst
    das Speed-Limit, wenn eingeschaltet), das Limit liegt bei halber Höhe. Die Geräteauswahl zeigt, für welches Gerät ein Update bereitliegt.
  - Captcha-Overlay: ohne unsere Browser-Erweiterung (Marker `data-myjd-extension` an `<html>`) kein "Open solver page", dafür ein Hinweis.
  - Standardauthentifizierung (Einstellungen > Basic authentication, `BasicAuthSettings.vue`, `/accountsV2/*BasicAuth`): HTTP- und FTP-Logins
    anlegen, bearbeiten (leeres Passwort lässt es), an/aus, löschen; Passwörter gehen nie zurück ans UI.
  - JD-Dialoge (`dialogs.ts`, `JdDialogs.vue`, `/dialogs/*`): Fragen, die JD am Desktop stellen würde, werden im UI beantwortet (Overlay wie
    beim Captcha, alle 5 s, nur bei sichtbarem Tab, alle Geräte). Typen: Auswahl (auch "Datei existiert", "Links schon in der Downloadliste"), Mehrfachauswahl, Text
    (Archiv-, Container-, Crawler-, Download-Passwort), Login, neues Passwort, Bestätigen, Hinweis; Unbekanntes lässt sich abbrechen. JD nimmt Dialoge nur in
    seiner Reihenfolge an ("Answer Dialog <id> first"): das Backend meldet 409 mit der gewünschten ID, das UI zeigt diesen Dialog zuerst.
  - System info (Einstellungen > System info, `jdsystem.ts`): Version, Laufzeit, System, Java, Speicher, Laufwerke, "Check for updates now", Power-Aktionen
    (JD neu starten / beenden, Computer herunterfahren, Standby, Ruhezustand) jeweils mit Rückfrage. JD in einem Container wird nach Neustart/Beenden/Herunterfahren
    von Docker neu gestartet.
  - Extensions (Einstellungen > Extensions, `extensions.ts`): an/aus, installieren (JD schließt die Installation erst nach einem Neustart ab, das UI bietet ihn an,
    die Erweiterung ist danach aus), die Optionen jeder installierten Erweiterung aufklappbar (`/api/extensions/config`). Die Einstellungen des Archive Extractor
    gibt es nur noch dort; FFmpeg liegt jetzt unter Downloads.
  - Extension und App verteilen (siehe oben): ZIP / XPI zum Herunterladen, Selbst-Update der Extension, Update der Android-App aus dem Backend.
  - Update und Neustart zeigen einen Hinweis mit Spinner bis das Gerät wieder da ist (`updateWatch.ts`; erkennt den Neustart über JDs Laufzeit, weil die Online-Anzeige
    der Geräteliste einen schnellen Neustart verpasst); der gelbe Update-Button ist dabei gesperrt und dreht sich. Hinweise (Toasts) stehen am Handy oben, gleiche Fehler nur einmal.
- **Offen:** der Meilenstein Direktverbindung, die Lücken unter TODO und die Nutzer-Doku (Phase 6).

## TODO

- Gaps against MyJDownloader (compared with screenshots of the original web UI, 2026-10-27): all closed or decided against. Done: accounts, custom
  proxies, per-plugin settings, multiple devices, start / pause / stop, update button, add-links dialog, the context menu, basic
  authentication, JD dialogs, system info with power actions, extension manager. Decided against (user): quick controls in the status
  bar (the status bar has what is needed), a table layout with columns in the linkgrabber, a filter button and count line (the filter and
  the per-package counts exist), toggles for auto confirm / start and the offline / duplicate handling (they are in Settings > Linkgrabber),
  an extraction tasks popup, an own editor for password list and blacklist (text fields, one entry per line, are enough), a
  connection popup. Not possible: "Create log" (no API call), "check archive" and "incomplete" in the context menu.
  What is left of the original: nothing.
- Scheduler: the extension's `EntryList` and Event Scripter's `Scripts` are lists of objects and show as raw JSON. A schedule editor
  (days, time, action such as start downloads / set speed limit) would be the one editor worth building; not decided.
- Beyond the original (nice to have, later, no gap): rule editors instead of raw JSON for link filter
  (`LinkFilterSettings.FilterList`), packagizer (`PackagizerSettings.RuleList`), hoster rules (`HosterRuleConfig.Rules`),
  filename / package name replace maps (`FilenameReplaceMap`, `PackagenameReplaceMap`, `FilenameTooLongRegexReplaceMap`), domain rules
  (`DomainRules`); plugin blacklists (`CrawlerHostPluginBlacklist`, `CrawlerCrawlerPluginBlacklist`) as a picker; "Reconnect now"
  with the current IP and the method settings (the original only has the auto reconnect switch); destination and package
  name history in the add-links dialog (`DownloadDestinationHistory`, `PackageNameHistory`).
- Settings page itself: readable German/English labels and units for the important keys (many values are milliseconds or
  bytes), "restart needed" hints, a filter "only changed", expert settings folded away, export/import of the JD config.
- JD dialogs: "Filename too long" (`IfFilenameTooLongAction`) and the pure GUI dialogs can only be cancelled; a cancelled dialog gets
  JD's default after its timeout. "New password" and "choose several" are handled by the code but cannot be triggered in a stock JD
  (nothing in the jars opens them, only plugins through the old `UserIO`); never seen.
- Backend start: if api.jdownloader.org is unreachable the process exits and Docker restarts it in a loop (seen once). Retry with
  a delay instead, ideally with the server already listening and a "MyJDownloader not reachable" page.
- Web UI over https: notifications work (confirmed behind https), but they only work over https or on localhost, not on `http://server:port`;
  document that in the user docs. The PWA install over https is not tested yet; without https a browser cannot install the UI as an
  app, the Android app replaces that. The extension's and the Android app's notifications work everywhere.
- Android app, to confirm on the phone: share, "ask every time" chooser, app lock, start after boot, file picker, manufacturer
  battery limits. (Click'n'Load works, confirmed.) Ideas: release signing instead of the debug key,
  hCaptcha / reCAPTCHA test (the chain was only tried with Turnstile), the modern back handling instead of `onBackPressed`.
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
  - [x] Start / stop / start again on a test device (the state name `stopped_state` is cut to `stopped`)
  - [x] Pause and resume (the state name for "paused" is assumed to be `pause`), snail and limit line
  - [x] Install an update (on a test instance, 2026-10-27)
  - [x] JD dialogs: file exists, login, archive password, confirm (yes / no), the order of several dialogs (on jd-test-2, answered in the UI)
  - [x] Context menu entries and their settings, priority arrows, basic authentication page, system info and power actions, extensions page
    (switch, install with restart, options), the toasts at the top on a phone, the update notice and spinner button (2026-10-27)
  - [x] "Check online status": in the linkgrabber it answers with the counts (online / offline / unknown); in the downloads list the call
    returns nothing, a gone link shows "File not found" in JD's status anyway
  - [x] Android app update on the phone (check, download, system installer, version after the update)
  - [x] Chromium extension: first installation from the ZIP, self-update into the chosen folder
  - [x] Firefox: signing with AMO keys, installation, update over https
  - [x] Web UI notifications over https
  - [x] New captcha page of the extension (logo, countdown, status, success state)
  - [ ] Set `UI_PASSWORD` and check logo, manifest, icons and the Anti-Captcha endpoints still work

# my-own-jdownloader – Projektplan

Ziel: Moderner, stabiler Ersatz für die Weboberfläche von https://my.jdownloader.org.
Der bestehende JDownloader auf dem Server bleibt unverändert und verbindet sich weiter mit
dem MyJDownloader-Dienst. Unser Projekt spricht dessen öffentliche API an.

## Entscheidungen

- **Weg A:** neues UI auf der bestehenden MyJDownloader-API (api.jdownloader.org).
  Keine Änderung am JDownloader nötig.
- **Stack:** TypeScript, Node-Backend, Frontend in **Vue.js** (festgelegt), Docker.
- **Backend nötig**, weil: Requests sind AES-128-CBC-verschlüsselt und HMAC-SHA256-signiert,
  Sessions laufen ab (Reconnect), CORS blockiert vermutlich den direkten Browser-Zugriff,
  die API hat kein Push (Polling bzw. Event-Long-Polling, Backend reicht per WebSocket/SSE weiter).
- **Captcha-Lösung ist zurückgestellt** (siehe unten).
- Später optional: Weg B (Direktverbindung zum JDownloader, Port 3129, gleiches Protokoll)
  und Weg C (eigener MyJD-Server; nur sinnvoll, wenn die Server-Adresse im JDownloader umstellbar ist).

## Architektur

```
Browser (UI) <--REST/WebSocket--> Backend (Node/TS) <--verschlüsselt--> api.jdownloader.org <--> JDownloader
```

- Backend kapselt Login, Verschlüsselung, Reconnect, Geräteliste, Polling.
- Zugangsdaten nur per Umgebungsvariablen / `.env` (nie committen, nie loggen).
- Das UI bekommt eine einfache REST/WebSocket-Schnittstelle, kennt die MyJD-Details nicht.
- Eigener Login-Schutz für das UI, wenn es erreichbar gemacht wird (Reverse Proxy + Auth).

## Phasen

| # | Phase | Inhalt | Schätzung |
|---|-------|--------|-----------|
| 1 | Protokoll-Client | Login, Verschlüsselung, Reconnect, Geräteliste, erste Calls gegen die echte Instanz | 1 Session |
| 2 | Backend-Schicht | REST, WebSocket/SSE, Polling der Downloadliste, Fehlerbehandlung | 1 Session |
| 3 | Basis-UI (MVP) | Downloadliste mit Paketen, Start/Stop, Geschwindigkeit, Fortschritt | 1–2 Sessions |
| 4 | Linkgrabber | Links einfügen, Pakete prüfen, in Downloads verschieben | 1–2 Sessions |
| 5 | Extras | Einstellungen, mehrere Geräte, Mobilansicht | 1–2 Sessions |
| 6 | Docker/Deployment | Container, Login-Schutz, Doku | 0,5 Session |
| später | Captcha | siehe unten | offen |

MVP = Phasen 1–3, ca. 3–4 Sessions.

## Referenz für das Protokoll

- Offizielle Extension (Firefox, MV2, v3.3.20, enthält den offiziellen JS-Client):
  https://extensions.jdownloader.org/firefox.xpi
  (ZIP-Archiv; in einen eigenen leeren Ordner entpacken und nur lesen.)
- Relevant darin: `vendor/js/jdapi.js` (MyJD-API-Client, Krypto via `crypto-js`),
  `scripts/services/MyjdService.js`, `scripts/services/MyjdDeviceService.js`.
- Der Code gehört AppWork und hat keine erkennbare Lizenz: nur als Referenz für Protokoll und
  Verhalten lesen, alles selbst neu schreiben, nichts kopieren.
- Die Chrome-Version ist aus dem Chrome Web Store entfernt (Manifest V3).

## Captcha (zurückgestellt)

Erkenntnisse aus der Analyse der Extension:

- Ablauf: Tab auf die echte Hoster-URL mit `#rc2jdt&c=<captchaId>` öffnen, Job über die Geräte-API
  holen (`/captcha/getCaptchaJob`, `/captcha/get`), per Content-Script das Widget (reCAPTCHA v2/v3,
  hCaptcha) mit Site-Key auf der echten Domain rendern, Token aus `g-recaptcha-response` bzw.
  `h-captcha-response` lesen und zurück an JDownloader geben.
- Portierung auf Manifest V3 ist machbar (`tabs`, Content-Scripts, `scripting`, Messaging);
  Service-Worker-Zustand dann in `chrome.storage.session`. Eine MV3-Version läuft in Chrome und Firefox.
- Die alte Extension kennt nur reCAPTCHA v2/v3 und hCaptcha, weder Cloudflare noch Turnstile.
- Bildcaptchas gehen einfach über den `captcha`-Namespace der API.
- **Problem:** JDownloader meldet bei manchen Challenges, dass ein externer Captcha-Solver-Dienst
  nötig sei. Was JD nicht als Job über die API meldet, kann keine Extension lösen.
  Für diese Fälle ist der Weg ein in JD eingerichteter Dienst (z. B. 2Captcha, CapSolver).
- Cloudflare-Bot-Challenge: `cf_clearance` ist an IP und User-Agent gebunden, ein Browser-Durchlauf
  auf dem eigenen Rechner hilft dem Server nur bei gleicher IP (VPN/Proxy).

**Offene Fragen dazu:** genauer Wortlaut der JD-Meldung, betroffene Hoster, ob es bei fast allen
oder nur einzelnen auftritt. Danach entscheiden, ob sich die Extension lohnt.

## Nächste Schritte (nach dem Umzug auf den Server)

1. Backend-Details klären (Node-Framework, z. B. Fastify) und Vue-Setup festlegen (Vue 3, Vite, TypeScript).
2. `.env` mit MyJDownloader-Zugangsdaten anlegen (lokal, nicht committen).
3. Projektgerüst und Docker-Setup anlegen.
4. Phase 1: Protokoll-Client, Test gegen die echte Instanz.
5. Git-Repository initialisieren (aktuell kein Repo).

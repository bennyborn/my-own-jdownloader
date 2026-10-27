# Browser extension

Browser extension (Manifest V3, Chrome and Firefox) for my-own-jdownloader. When JDownloader waits for a
captcha, the toolbar icon shows the number of open jobs. "Solve" opens the hoster's real page, where the
extension renders the captcha widget (hCaptcha or reCAPTCHA v2) with the site key from JDownloader.
The token is sent to the backend, which hands it to JDownloader.

Install: Chrome `chrome://extensions` > developer mode > "Load unpacked" > this folder.
Firefox: with `PUBLIC_URL` (https) and the AMO API keys set (see `.env.example`) the backend has the package signed by Mozilla (unlisted) and ships the XPI (`/api/extension/firefox/extension.xpi`); Firefox then updates it by itself from `/api/extension/firefox/updates.json`. Every installation signs with its own keys and add-on id (`EXTENSION_FIREFOX_ID`, else made once). Raise `version` in `manifest.json` with every change: AMO signs a version only once.
Updates: the backend ships the extension (`/api/extension/chromium/extension.zip` for the first installation). In the settings, "Check for updates" /
"Update to x" writes the new files into the folder the extension is loaded from (Chrome only, the folder is asked once) and reloads it.
Raise `version` in `manifest.json` with every change, that is what the check compares.
Then open the extension options and enter the backend URL (and `UI_PASSWORD` if set).

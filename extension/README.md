# Browser extension

Browser extension (Manifest V3, Chrome and Firefox) for my-own-jdownloader. When JDownloader waits for a
captcha, the toolbar icon shows the number of open jobs. "Solve" opens the hoster's real page, where the
extension renders the captcha widget (hCaptcha or reCAPTCHA v2) with the site key from JDownloader.
The token is sent to the backend, which hands it to JDownloader.

Install: Chrome `chrome://extensions` > developer mode > "Load unpacked" > this folder.
Firefox: `about:debugging` > "Load Temporary Add-on" > `manifest.json`.
Then open the extension options and enter the backend URL (and `UI_PASSWORD` if set).

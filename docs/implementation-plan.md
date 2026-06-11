# Delivery Plan - Bluetooth PWA Demo

## 1) Firmware (Arduino ESP32)
- Build BLE peripheral advertising diagnostics service UUID.
- Publish JSON notifications on one telemetry characteristic.
- Send metrics every 1s (voidage, temp), run state every 7s, event text every 10s.
- Keep payload format stable for app parser.

## 2) Web App (PWA)
- Mobile-first compact layout with 2x2 pill grid.
- Connect/disconnect/select BLE devices via Web Bluetooth.
- Show event stream newest-first with HH:MM:SS timestamp.
- Add known device refresh and forget flow.
- Support install + offline via manifest/service worker.
- Add explicit update action that checks service worker update.

## 3) Validation
- Firmware: compile with PlatformIO (`pio run`) for ESP32 board profile.
- Web app: serve locally with php -S or VS Code Go Live and open over HTTP on Win 11.
- PWA: verify offline cache after first load and update button behavior.
- Git: review status and keep repo current.

## 4) Deployment Target
- Publish webapp folder to GitHub Pages.
- Use HTTPS Pages URL in Bluefy to allow BLE permissions.

## 5) Native Wrappers and CI Build
- Use Capacitor native projects at `webapp/ios` and `webapp/android`.
- Rebuild and sync web/native assets with `npm run cap:sync`.
- Open `webapp/ios/App/App.xcodeproj` in Xcode and select the `App` scheme.
- Open `webapp/android` in Android Studio for Android builds.
- Bundle identifier: `ac.clarity.blecommissioning`.
- GitHub Actions runs `npm ci`, syncs the Capacitor iOS project, then builds the committed Xcode project.

## 6) Portable Bluetooth Layer
- The UI talks to `bluetooth-transport.js`, not directly to `navigator.bluetooth`.
- Web/Bluefy uses the Web Bluetooth transport.
- iOS/Android use the native BLE transport exposed by `@capacitor-community/bluetooth-le`.
- The same web bundle is copied into iOS and Android wrappers by Capacitor.

Note: iOS `WKWebView` does not support Web Bluetooth. Native iOS/Android BLE flows go through the Capacitor BLE plugin, while browser/Bluefy flows still use Web Bluetooth.

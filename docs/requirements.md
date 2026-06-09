# ESP32 Diagnostics over BLE

## Architecture
- Arduino ESP32 app generates diagnostic info (20-50 per second)
- Some are short messages e.g. "started PWM", "failed to connect to XYZ Wifi"
- Others are fixed values e.g. "voidage = 10%", "temp = 25", "run state = 7"
- HTML/JS app runs on iPhone in Bluefy
- Bluefy connects to ESP32 over BLE
- Our app can connect to any ESP in range that advertises the correct service IDs

## ESP Code
- Create a demo app that periodically sends:
- Text status updates (once every 10 seconds)
- Sends "random walking" data updates (every second) for voidage, temp.
- Changes run state every 7 seconds.

## HTTPS HTML/JS Web site
- Show a flexible, mobile-friendly (in landscape mode) progressive Web App
- Host on GitHub pages
- Make PWA fully offline-capable via Service Workers
- Allow a "check for updates" pathway for pushing updates - so PWA must be updatable somehow.
- Allows choosing which device to connect to (maybe a dropdown) - must also be able to forget devices
- one line has four pills in a "values" area, two per line. Each pill has a the metric name inside top middle in smaller text, and value below it, in larger text. We only have three typs for now, but make sure the 4 pills flex nicely in a grid.
- below the "values" area, show events as the come in. latest event is at the top, pushing older events down. For this demo, just show the HH:MM:SS the message arrived, and the message
- Keep the interface compact but modern looking. Screen space is limited, so avoid unnecesary section labelling.

## VALIDATION
- Perform compile tests and check that code has no errors
- Use "Go Live" or "php server" to host the web site locally on Win 11 PC before deployment
- Keep a git repo current
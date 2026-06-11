import { createBluetoothTransport } from "./bluetooth-transport.js";

const BLE_SERVICE_UUID = "2d6b5ce7-7f30-4df0-a318-4cc4d7cb2f10";
const TELEMETRY_CHAR_UUID = "df0da48d-e16f-4d08-90ee-1f4a4532f5bb";
const NAME_CACHE_KEY = "bleDeviceNameCache";
const LAST_DEVICE_NAME_KEY = "bleLastDeviceName";
const BLE_DEBUG = true;
const APP_BUILD = "2026-06-09-namefix-v2";

const connectBtn = document.getElementById("connectBtn");
const disconnectBtn = document.getElementById("disconnectBtn");
const refreshDevicesBtn = document.getElementById("refreshDevicesBtn");
const forgetBtn = document.getElementById("forgetBtn");
const checkUpdatesBtn = document.getElementById("checkUpdatesBtn");
const knownDevices = document.getElementById("knownDevices");
const connStatus = document.getElementById("connStatus");

const voidageValue = document.getElementById("voidageValue");
const tempValue = document.getElementById("tempValue");
const runStateValue = document.getElementById("runStateValue");
const packetsValue = document.getElementById("packetsValue");
const eventsBox = document.getElementById("events");

let activeDevice = null;
let packetCount = 0;
const recentPayloadTimestamps = new Map();
const bluetoothTransport = createBluetoothTransport({
  serviceUuid: BLE_SERVICE_UUID,
  characteristicUuid: TELEMETRY_CHAR_UUID
});

function isDuplicatePayload(payloadText) {
  const now = Date.now();

  for (const [key, ts] of recentPayloadTimestamps) {
    if (now - ts > 1500) {
      recentPayloadTimestamps.delete(key);
    }
  }

  const previousTs = recentPayloadTimestamps.get(payloadText);
  recentPayloadTimestamps.set(payloadText, now);
  return previousTs !== undefined && now - previousTs < 1000;
}

function loadNameCache() {
  try {
    const raw = localStorage.getItem(NAME_CACHE_KEY);
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      return {};
    }
    return parsed;
  } catch {
    return {};
  }
}

function saveNameCache(cache) {
  localStorage.setItem(NAME_CACHE_KEY, JSON.stringify(cache));
}

function saveLastDeviceName(name) {
  if (!name || typeof name !== "string") {
    return;
  }
  localStorage.setItem(LAST_DEVICE_NAME_KEY, name);
}

function loadLastDeviceName() {
  const value = localStorage.getItem(LAST_DEVICE_NAME_KEY);
  if (!value || typeof value !== "string") {
    return "";
  }
  return value;
}

function rememberDeviceName(device) {
  if (!device || !device.id || !device.name) {
    if (device && device.id) {
      debugLog(`remember skip id=${device.id.slice(0, 6)} name=${device.name || "(empty)"}`);
    }
    return;
  }

  const cache = loadNameCache();
  cache[device.id] = device.name;
  saveNameCache(cache);
  saveLastDeviceName(device.name);
  debugLog(`remember id=${device.id.slice(0, 6)} name=${device.name}`);
}

function labelForDevice(device) {
  if (!device || !device.id) {
    debugLog("label no-device");
    return "Unnamed";
  }

  if (device.name) {
    debugLog(`label direct id=${device.id.slice(0, 6)} name=${device.name}`);
    return device.name;
  }

  const cache = loadNameCache();
  if (cache[device.id]) {
    debugLog(`label id-cache id=${device.id.slice(0, 6)} name=${cache[device.id]}`);
    return cache[device.id];
  }

  const cachedNames = Object.values(cache).filter((x) => typeof x === "string" && x.length > 0);
  if (cachedNames.length === 1) {
    debugLog(`label single-cache id=${device.id.slice(0, 6)} name=${cachedNames[0]}`);
    return cachedNames[0];
  }

  const lastName = loadLastDeviceName();
  if (lastName) {
    debugLog(`label last-name id=${device.id.slice(0, 6)} name=${lastName}`);
    return lastName;
  }

  debugLog(`label unnamed id=${device.id.slice(0, 6)}`);
  return `Unnamed (${device.id.slice(0, 6)})`;
}

function reconcileUnnamedDevices(devices) {
  if (!Array.isArray(devices) || devices.length !== 1) {
    return;
  }

  const only = devices[0];
  if (!only || !only.id || only.name) {
    return;
  }

  if (!activeDevice || !activeDevice.name) {
    return;
  }

  const cache = loadNameCache();
  cache[only.id] = activeDevice.name;
  saveNameCache(cache);
  saveLastDeviceName(activeDevice.name);
  debugLog(`reconcile id=${only.id.slice(0, 6)} using active=${activeDevice.name}`);
}

function appendOption(value, text) {
  const opt = document.createElement("option");
  opt.value = value;
  opt.textContent = text;
  knownDevices.appendChild(opt);
}

function appendActiveDeviceOption() {
  if (!activeDevice || !activeDevice.id) {
    appendOption("", "No known devices");
    return;
  }

  const label = labelForDevice(activeDevice);
  appendOption(activeDevice.id, label);
}

function setStatus(text, isWarn = false) {
  connStatus.textContent = text;
  connStatus.classList.toggle("warn", isWarn);
}

function appendEvent(message) {
  const row = document.createElement("div");
  row.className = "event-line";
  const time = new Date().toLocaleTimeString("en-GB", { hour12: false });
  row.innerHTML = `<span class="event-time">${time}</span><span>${message}</span>`;
  eventsBox.prepend(row);

  while (eventsBox.childElementCount > 120) {
    eventsBox.lastElementChild.remove();
  }
}

function debugLog(message) {
  if (!BLE_DEBUG) {
    return;
  }
  // appendEvent(`[dbg] ${message}`);
}

function updateMetrics(data) {
  if (typeof data.voidage === "number") {
    voidageValue.textContent = `${data.voidage.toFixed(1)} %`;
  }

  if (typeof data.temp === "number") {
    tempValue.textContent = `${data.temp.toFixed(1)} C`;
  }

  if (typeof data.run_state === "number") {
    runStateValue.textContent = String(data.run_state);
  }
}

function applyResolvedDeviceName(name) {
  if (!name || !activeDevice || !activeDevice.id) {
    return;
  }

  const cache = loadNameCache();
  cache[activeDevice.id] = name;
  saveNameCache(cache);
  saveLastDeviceName(name);

  setStatus(`connected: ${name}`);
  debugLog(`resolved name id=${activeDevice.id.slice(0, 6)} name=${name}`);
}

function tryApplyIdentityPayload(rawText) {
  try {
    const payload = JSON.parse(rawText);
    if (payload.device_name) {
      applyResolvedDeviceName(payload.device_name);
      return payload.type === "boot";
    }
  } catch {
    return false;
  }
  return false;
}

function handleTelemetry(text) {
  if (isDuplicatePayload(text)) {
    debugLog("drop duplicate payload");
    return;
  }

  packetCount += 1;
  packetsValue.textContent = String(packetCount);

  if (tryApplyIdentityPayload(text)) {
    return;
  }

  try {
    const payload = JSON.parse(text);

    if (payload.type === "metrics") {
      updateMetrics(payload);
      return;
    }

    if (payload.type === "state" && typeof payload.run_state === "number") {
      runStateValue.textContent = String(payload.run_state);
      appendEvent(`run state changed to ${payload.run_state}`);
      return;
    }

    if (payload.type === "event" && payload.message) {
      appendEvent(payload.message);
      return;
    }

    appendEvent(text);
  } catch (err) {
    appendEvent(text);
  }
}

function onDisconnected() {
  setStatus("disconnected", true);
  appendEvent("BLE disconnected");
}

async function teardownActiveConnection() {
  await bluetoothTransport.disconnect();
}

async function connect(device) {
  if (!device) {
    throw new Error("No BLE device selected");
  }

  await teardownActiveConnection();

  setStatus("connecting");
  debugLog(`connect start id=${device.id ? device.id.slice(0, 6) : "none"} name=${device.name || "(empty)"}`);

  activeDevice = device;

  await bluetoothTransport.connect(activeDevice, {
    onPayload: handleTelemetry,
    onDisconnected
  });

  const connectedLabel = labelForDevice(activeDevice);
  setStatus(`connected: ${connectedLabel}`);
  appendEvent(`connected to ${connectedLabel}`);
  rememberDeviceName(activeDevice);
}

async function requestAndConnect() {
  if (!bluetoothTransport.isSupported) {
    setStatus("bluetooth unsupported", true);
    appendEvent("bluetooth is not available on this platform");
    return;
  }

  try {
    const device = await bluetoothTransport.requestDevice();
    debugLog(`chooser id=${device.id ? device.id.slice(0, 6) : "none"} name=${device.name || "(empty)"}`);

    await connect(device);
    await refreshKnownDevices();
    knownDevices.value = device.id;
  } catch (err) {
    setStatus("connect failed", true);
    appendEvent(`connect failed: ${err.message}`);
  }
}

async function disconnectActive() {
  if (!activeDevice) {
    setStatus("idle");
    return;
  }

  try {
    await teardownActiveConnection();
    activeDevice = null;
    setStatus("disconnected");
  } catch (err) {
    setStatus("disconnect failed", true);
    appendEvent(`disconnect error: ${err.message}`);
  }
}

async function refreshKnownDevices() {
  knownDevices.innerHTML = "";
  debugLog("refresh start");

  if (!bluetoothTransport.isSupported) {
    appendOption("", "Bluetooth unsupported");
    return;
  }

  if (!bluetoothTransport.supportsKnownDevices) {
    debugLog("refresh fallback: getDevices unsupported");
    appendActiveDeviceOption();
    return;
  }

  let devices = [];
  try {
    devices = await bluetoothTransport.getDevices();
  } catch (err) {
    appendEvent(`known devices unavailable: ${err.message}`);
    debugLog(`getDevices error=${err.message}`);
    appendActiveDeviceOption();
    return;
  }

  debugLog(`getDevices count=${devices.length}`);
  for (const d of devices) {
    debugLog(`getDevices id=${d.id ? d.id.slice(0, 6) : "none"} name=${d.name || "(empty)"}`);
  }

  reconcileUnnamedDevices(devices);

  if (devices.length === 0) {
    appendActiveDeviceOption();
    return;
  }

  appendOption("", "Select device...");
  let hasActive = false;
  for (const d of devices) {
    appendOption(d.id, labelForDevice(d));
    if (activeDevice && d.id === activeDevice.id) {
      hasActive = true;
    }
  }

  if (activeDevice && activeDevice.id && !hasActive) {
    appendOption(activeDevice.id, labelForDevice(activeDevice));
  }
}

async function pickDeviceForDropdown() {
  if (!bluetoothTransport.isSupported) {
    setStatus("bluetooth unsupported", true);
    appendEvent("bluetooth is not available on this platform");
    return;
  }

  try {
    const device = await bluetoothTransport.requestDevice();
    debugLog(`devices click chooser id=${device.id ? device.id.slice(0, 6) : "none"} name=${device.name || "(empty)"}`);

    activeDevice = device;
    rememberDeviceName(device);
    await refreshKnownDevices();
    knownDevices.value = device.id;
    appendEvent(`selected ${device.name || "esp32"}`);
  } catch (err) {
    appendEvent(`device selection cancelled: ${err.message}`);
  }
}

async function handleDevicesClick() {
  if (bluetoothTransport.supportsKnownDevices) {
    await refreshKnownDevices();
    return;
  }

  await pickDeviceForDropdown();
}

async function connectKnownSelection() {
  if (!bluetoothTransport.isSupported || !knownDevices.value) {
    return;
  }

  if (!bluetoothTransport.supportsKnownDevices) {
    appendEvent("known device list unsupported, use Connect");
    return;
  }

  let devices = [];
  try {
    devices = await bluetoothTransport.getDevices();
  } catch (err) {
    appendEvent(`known devices unavailable: ${err.message}`);
    return;
  }

  const selected = devices.find((d) => d.id === knownDevices.value);
  if (!selected) {
    if (activeDevice && activeDevice.id === knownDevices.value) {
      await connect(activeDevice);
    }
    return;
  }

  await connect(selected);
}

async function forgetSelected() {
  if (!bluetoothTransport.isSupported || !knownDevices.value) {
    appendEvent("no device selected to forget");
    return;
  }

  if (!bluetoothTransport.supportsForget || !bluetoothTransport.supportsKnownDevices) {
    setStatus("forget unsupported", true);
    appendEvent("forget not supported on this platform");
    return;
  }

  try {
    const devices = await bluetoothTransport.getDevices();
    const selected = devices.find((d) => d.id === knownDevices.value);

    if (!selected) {
      appendEvent("no device selected to forget");
      return;
    }

    await bluetoothTransport.forget(selected);
    appendEvent(`forgot ${selected.name || selected.id}`);
    await refreshKnownDevices();
  } catch (err) {
    setStatus("forget failed", true);
    appendEvent(`forget failed: ${err.message}`);
  }
}

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) {
    return;
  }

  try {
    const reg = await navigator.serviceWorker.register("./sw.js");

    checkUpdatesBtn.addEventListener("click", async () => {
      await reg.update();
      if (reg.waiting) {
        reg.waiting.postMessage({ type: "SKIP_WAITING" });
      }
      appendEvent("checked for app update");
    });

    navigator.serviceWorker.addEventListener("controllerchange", () => {
      appendEvent("app updated, reloading...");
      window.location.reload();
    });
  } catch (err) {
    appendEvent(`service worker failed: ${err.message}`);
  }
}

connectBtn.addEventListener("click", requestAndConnect);
disconnectBtn.addEventListener("click", disconnectActive);
refreshDevicesBtn.addEventListener("click", handleDevicesClick);
forgetBtn.addEventListener("click", forgetSelected);
knownDevices.addEventListener("change", connectKnownSelection);

refreshKnownDevices();
registerServiceWorker();
appendEvent(`build ${APP_BUILD}`);
appendEvent("ready");

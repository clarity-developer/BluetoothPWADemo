const BLE_SERVICE_UUID = "2d6b5ce7-7f30-4df0-a318-4cc4d7cb2f10";
const TELEMETRY_CHAR_UUID = "df0da48d-e16f-4d08-90ee-1f4a4532f5bb";
const DEVICE_NAME_PREFIX = "Instr-";
const KNOWN_NAME_STORAGE_KEY = "bleKnownDeviceNames";

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
let activeServer = null;
let activeCharacteristic = null;
let packetCount = 0;

function getStoredNames() {
  try {
    const raw = localStorage.getItem(KNOWN_NAME_STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter((x) => typeof x === "string" && x.trim().length > 0);
  } catch {
    return [];
  }
}

function saveStoredNames(names) {
  localStorage.setItem(KNOWN_NAME_STORAGE_KEY, JSON.stringify(names));
}

function rememberDeviceName(name) {
  if (!name || typeof name !== "string") {
    return;
  }

  const names = getStoredNames();
  if (!names.includes(name)) {
    names.push(name);
    saveStoredNames(names);
  }
}

function forgetStoredDeviceName(name) {
  const names = getStoredNames().filter((x) => x !== name);
  saveStoredNames(names);
}

function appendOption(value, text) {
  const opt = document.createElement("option");
  opt.value = value;
  opt.textContent = text;
  knownDevices.appendChild(opt);
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

function handleTelemetry(event) {
  const text = new TextDecoder().decode(event.target.value);
  packetCount += 1;
  packetsValue.textContent = String(packetCount);

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

async function connect(device) {
  if (!device) {
    throw new Error("No BLE device selected");
  }

  setStatus("connecting");

  activeDevice = device;
  activeDevice.removeEventListener("gattserverdisconnected", onDisconnected);
  activeDevice.addEventListener("gattserverdisconnected", onDisconnected);

  activeServer = await activeDevice.gatt.connect();
  const service = await activeServer.getPrimaryService(BLE_SERVICE_UUID);
  activeCharacteristic = await service.getCharacteristic(TELEMETRY_CHAR_UUID);

  await activeCharacteristic.startNotifications();
  activeCharacteristic.removeEventListener("characteristicvaluechanged", handleTelemetry);
  activeCharacteristic.addEventListener("characteristicvaluechanged", handleTelemetry);

  setStatus(`connected: ${activeDevice.name || "esp32"}`);
  appendEvent(`connected to ${activeDevice.name || "esp32"}`);
  rememberDeviceName(activeDevice.name);
}

async function requestAndConnect() {
  if (!navigator.bluetooth) {
    setStatus("web bluetooth unsupported", true);
    appendEvent("browser does not support Web Bluetooth");
    return;
  }

  try {
    const device = await navigator.bluetooth.requestDevice({
      filters: [{ services: [BLE_SERVICE_UUID], namePrefix: DEVICE_NAME_PREFIX }],
      optionalServices: [BLE_SERVICE_UUID]
    });

    await connect(device);
    await refreshKnownDevices();
    knownDevices.value = device.id;
  } catch (err) {
    setStatus("connect failed", true);
    appendEvent(`connect failed: ${err.message}`);
  }
}

async function disconnectActive() {
  if (!activeDevice || !activeDevice.gatt || !activeDevice.gatt.connected) {
    setStatus("idle");
    return;
  }

  try {
    activeDevice.gatt.disconnect();
    setStatus("disconnected");
  } catch (err) {
    setStatus("disconnect failed", true);
    appendEvent(`disconnect error: ${err.message}`);
  }
}

async function refreshKnownDevices() {
  knownDevices.innerHTML = "";

  if (!navigator.bluetooth) {
    appendOption("", "Web Bluetooth unsupported");
    return;
  }

  if (!navigator.bluetooth.getDevices) {
    const names = getStoredNames();
    if (names.length === 0) {
      appendOption("", "No known devices");
      return;
    }

    for (const name of names) {
      appendOption(`name:${name}`, name);
    }
    return;
  }

  const devices = await navigator.bluetooth.getDevices();

  if (devices.length === 0) {
    appendOption("", "No known devices");
    return;
  }

  for (const d of devices) {
    appendOption(d.id, d.name || `Unnamed (${d.id.slice(0, 6)})`);
    rememberDeviceName(d.name);
  }
}

async function connectKnownSelection() {
  if (!navigator.bluetooth || !knownDevices.value) {
    return;
  }

  if (!navigator.bluetooth.getDevices) {
    if (!knownDevices.value.startsWith("name:")) {
      return;
    }

    const selectedName = knownDevices.value.slice(5);
    try {
      const device = await navigator.bluetooth.requestDevice({
        filters: [{ services: [BLE_SERVICE_UUID], name: selectedName }],
        optionalServices: [BLE_SERVICE_UUID]
      });
      await connect(device);
      return;
    } catch (err) {
      appendEvent(`connect failed: ${err.message}`);
      return;
    }
  }

  const devices = await navigator.bluetooth.getDevices();
  const selected = devices.find((d) => d.id === knownDevices.value);
  if (!selected) {
    return;
  }

  await connect(selected);
}

async function forgetSelected() {
  if (!navigator.bluetooth || !knownDevices.value) {
    appendEvent("no device selected to forget");
    return;
  }

  if (!navigator.bluetooth.getDevices) {
    if (!knownDevices.value.startsWith("name:")) {
      appendEvent("no remembered device selected");
      return;
    }
    const selectedName = knownDevices.value.slice(5);
    forgetStoredDeviceName(selectedName);
    appendEvent(`forgot ${selectedName}`);
    await refreshKnownDevices();
    return;
  }

  try {
    const devices = await navigator.bluetooth.getDevices();
    const selected = devices.find((d) => d.id === knownDevices.value);

    if (!selected) {
      appendEvent("no device selected to forget");
      return;
    }

    if (typeof selected.forget !== "function") {
      setStatus("forget unsupported", true);
      appendEvent("device.forget unsupported in this browser");
      return;
    }

    await selected.forget();
    forgetStoredDeviceName(selected.name);
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
refreshDevicesBtn.addEventListener("click", refreshKnownDevices);
forgetBtn.addEventListener("click", forgetSelected);
knownDevices.addEventListener("change", connectKnownSelection);

refreshKnownDevices();
registerServiceWorker();
appendEvent("ready");

const NATIVE_DEVICE_CACHE_KEY = "bleNativeDeviceCache";

function getBluetoothLePlugin() {
  return window.Capacitor?.Plugins?.BluetoothLe || window.BluetoothLe || null;
}

function decodeBase64(value) {
  const binary = atob(value);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function decodeHex(value) {
  const clean = value.replace(/\s/g, "");
  if (!/^[0-9a-f]*$/i.test(clean) || clean.length % 2 !== 0) {
    throw new Error("Value is not hex-encoded");
  }

  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < clean.length; i += 2) {
    bytes[i / 2] = Number.parseInt(clean.slice(i, i + 2), 16);
  }
  return new TextDecoder().decode(bytes);
}

function decodeNativeValue(value) {
  if (typeof value === "string") {
    try {
      return decodeHex(value);
    } catch {
      try {
        return decodeBase64(value);
      } catch {
        return value;
      }
    }
  }

  if (value instanceof DataView) {
    return new TextDecoder().decode(value.buffer);
  }

  if (value instanceof ArrayBuffer) {
    return new TextDecoder().decode(value);
  }

  if (value?.buffer instanceof ArrayBuffer) {
    return new TextDecoder().decode(value.buffer);
  }

  if (Array.isArray(value)) {
    return new TextDecoder().decode(Uint8Array.from(value));
  }

  return String(value ?? "");
}

function readNativeDeviceCache() {
  try {
    return JSON.parse(localStorage.getItem(NATIVE_DEVICE_CACHE_KEY) || "[]");
  } catch {
    return [];
  }
}

function writeNativeDeviceCache(devices) {
  localStorage.setItem(NATIVE_DEVICE_CACHE_KEY, JSON.stringify(devices));
}

function rememberNativeDevice(device) {
  if (!device?.id) {
    return;
  }

  const devices = readNativeDeviceCache().filter((item) => item.id !== device.id);
  devices.unshift({ id: device.id, name: device.name || "" });
  writeNativeDeviceCache(devices.slice(0, 12));
}

export function createBluetoothTransport({ serviceUuid, characteristicUuid }) {
  const nativePlugin = getBluetoothLePlugin();
  if (nativePlugin) {
    return new NativeBleTransport(nativePlugin, serviceUuid, characteristicUuid);
  }

  return new WebBluetoothTransport(serviceUuid, characteristicUuid);
}

class WebBluetoothTransport {
  constructor(serviceUuid, characteristicUuid) {
    this.kind = "web";
    this.serviceUuid = serviceUuid;
    this.characteristicUuid = characteristicUuid;
    this.device = null;
    this.characteristic = null;
    this.onPayload = null;
    this.onDisconnected = null;
    this.boundNotificationHandler = this.handleNotification.bind(this);
    this.boundDisconnectHandler = this.handleDisconnect.bind(this);
  }

  get isSupported() {
    return Boolean(navigator.bluetooth);
  }

  get supportsKnownDevices() {
    return Boolean(navigator.bluetooth?.getDevices);
  }

  get supportsForget() {
    return this.supportsKnownDevices;
  }

  async requestDevice() {
    if (!navigator.bluetooth) {
      throw new Error("Web Bluetooth is unavailable");
    }

    return navigator.bluetooth.requestDevice({
      filters: [{ services: [this.serviceUuid] }],
      optionalServices: [this.serviceUuid]
    });
  }

  async getDevices() {
    if (!navigator.bluetooth?.getDevices) {
      return [];
    }

    return navigator.bluetooth.getDevices();
  }

  async connect(device, { onPayload, onDisconnected }) {
    await this.disconnect();

    this.device = device;
    this.onPayload = onPayload;
    this.onDisconnected = onDisconnected;

    this.device.removeEventListener("gattserverdisconnected", this.boundDisconnectHandler);
    this.device.addEventListener("gattserverdisconnected", this.boundDisconnectHandler);

    const server = await this.device.gatt.connect();
    const service = await server.getPrimaryService(this.serviceUuid);
    this.characteristic = await service.getCharacteristic(this.characteristicUuid);

    await this.characteristic.startNotifications();
    this.characteristic.removeEventListener("characteristicvaluechanged", this.boundNotificationHandler);
    this.characteristic.addEventListener("characteristicvaluechanged", this.boundNotificationHandler);

    try {
      const initialValue = await this.characteristic.readValue();
      this.onPayload(new TextDecoder().decode(initialValue.buffer));
    } catch {
      // Some devices expose notify-only characteristics.
    }
  }

  async disconnect() {
    if (this.characteristic) {
      this.characteristic.removeEventListener("characteristicvaluechanged", this.boundNotificationHandler);
      try {
        await this.characteristic.stopNotifications();
      } catch {
        // Characteristic may already be stopped or disconnected.
      }
    }

    if (this.device) {
      this.device.removeEventListener("gattserverdisconnected", this.boundDisconnectHandler);
      if (this.device.gatt?.connected) {
        this.device.gatt.disconnect();
      }
    }

    this.characteristic = null;
  }

  async forget(device) {
    if (typeof device?.forget === "function") {
      await device.forget();
    }
  }

  handleNotification(event) {
    this.onPayload?.(new TextDecoder().decode(event.target.value));
  }

  handleDisconnect() {
    this.characteristic = null;
    this.onDisconnected?.();
  }
}

class NativeBleTransport {
  constructor(plugin, serviceUuid, characteristicUuid) {
    this.kind = "native";
    this.plugin = plugin;
    this.serviceUuid = serviceUuid;
    this.characteristicUuid = characteristicUuid;
    this.device = null;
    this.onPayload = null;
    this.onDisconnected = null;
    this.initialized = false;
    this.disconnectListener = null;
    this.notificationListener = null;
  }

  get isSupported() {
    return true;
  }

  get supportsKnownDevices() {
    return true;
  }

  get supportsForget() {
    return true;
  }

  async initialize() {
    if (this.initialized) {
      return;
    }

    if (typeof this.plugin.initialize === "function") {
      await this.plugin.initialize({ androidNeverForLocation: true });
    }
    this.initialized = true;
  }

  async requestDevice() {
    await this.initialize();

    const device = await this.plugin.requestDevice({
      services: [this.serviceUuid],
      optionalServices: [this.serviceUuid]
    });

    const normalized = {
      id: device.deviceId || device.id,
      deviceId: device.deviceId || device.id,
      name: device.name || device.localName || ""
    };
    rememberNativeDevice(normalized);
    return normalized;
  }

  async getDevices() {
    return readNativeDeviceCache();
  }

  async connect(device, { onPayload, onDisconnected }) {
    await this.initialize();
    await this.disconnect();

    this.device = device;
    this.onPayload = onPayload;
    this.onDisconnected = onDisconnected;

    const deviceId = device.deviceId || device.id;
    const notificationKey = `notification|${deviceId}|${this.serviceUuid}|${this.characteristicUuid}`;
    const disconnectedKey = `disconnected|${deviceId}`;

    await this.disconnectListener?.remove?.();
    await this.notificationListener?.remove?.();

    if (typeof this.plugin.addListener === "function") {
      this.disconnectListener = await this.plugin.addListener(disconnectedKey, () => {
        this.device = null;
        this.onDisconnected?.();
      });
      this.notificationListener = await this.plugin.addListener(notificationKey, (result) => {
        this.onPayload?.(decodeNativeValue(result?.value ?? result));
      });
    }

    await this.plugin.connect({ deviceId });

    await this.plugin.startNotifications({
      deviceId,
      service: this.serviceUuid,
      characteristic: this.characteristicUuid
    });

    try {
      const initial = await this.plugin.read?.({
        deviceId,
        service: this.serviceUuid,
        characteristic: this.characteristicUuid
      });
      if (initial) {
        this.onPayload?.(decodeNativeValue(initial.value ?? initial));
      }
    } catch {
      // Some devices expose notify-only characteristics.
    }

    rememberNativeDevice(device);
  }

  async disconnect() {
    if (!this.device?.id) {
      return;
    }

    const deviceId = this.device.deviceId || this.device.id;

    try {
      await this.plugin.stopNotifications?.({
        deviceId,
        service: this.serviceUuid,
        characteristic: this.characteristicUuid
      });
    } catch {
      // Notifications may not be active.
    }

    await this.notificationListener?.remove?.();
    await this.disconnectListener?.remove?.();
    this.notificationListener = null;
    this.disconnectListener = null;

    try {
      await this.plugin.disconnect?.({ deviceId });
    } catch {
      // Device may already be disconnected.
    }

    this.device = null;
  }

  async forget(device) {
    const devices = readNativeDeviceCache().filter((item) => item.id !== device?.id);
    writeNativeDeviceCache(devices);
  }
}

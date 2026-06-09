#include <Arduino.h>
#include <NimBLEDevice.h>

#ifndef DIAG_DEVICE_NAME
#define DIAG_DEVICE_NAME "Instr-301"
#endif

// Custom demo UUIDs for diagnostics stream.
static const char *SERVICE_UUID = "2d6b5ce7-7f30-4df0-a318-4cc4d7cb2f10";
static const char *TELEMETRY_CHAR_UUID = "df0da48d-e16f-4d08-90ee-1f4a4532f5bb";
static const char *DEVICE_NAME = DIAG_DEVICE_NAME;

NimBLECharacteristic *telemetryChar = nullptr;
bool centralConnected = false;

float voidage = 10.0f;
float tempC = 25.0f;
int runState = 0;

unsigned long lastMetricsMs = 0;
unsigned long lastEventMs = 0;
unsigned long lastRunStateMs = 0;
unsigned long lastBootMs = 0;

const char *eventPool[] = {
  "started PWM",
  "failed to connect to XYZ Wifi",
  "recovered wifi link",
  "calibration pass",
  "flow controller synced",
  "watchdog heartbeat ok"
};
const size_t eventPoolCount = sizeof(eventPool) / sizeof(eventPool[0]);

class ServerCallbacks : public NimBLEServerCallbacks {
  void onConnect(NimBLEServer *pServer, NimBLEConnInfo &connInfo) override {
    centralConnected = true;
    (void)pServer;
    (void)connInfo;
  }

  void onDisconnect(NimBLEServer *pServer, NimBLEConnInfo &connInfo, int reason) override {
    centralConnected = false;
    (void)pServer;
    (void)connInfo;
    (void)reason;
    NimBLEDevice::startAdvertising();
  }
};

float randomWalk(float current, float minValue, float maxValue, float step) {
  float delta = ((float)random(-1000, 1001) / 1000.0f) * step;
  float next = current + delta;
  if (next < minValue) {
    next = minValue;
  }
  if (next > maxValue) {
    next = maxValue;
  }
  return next;
}

void notifyJson(const String &jsonPayload) {
  if (!centralConnected || telemetryChar == nullptr) {
    return;
  }

  telemetryChar->setValue(jsonPayload.c_str());
  telemetryChar->notify();
}

void updateBootIdentityValue() {
  if (telemetryChar == nullptr) {
    return;
  }

  String bootPayload = "{\"type\":\"boot\",\"ts\":";
  bootPayload += millis();
  bootPayload += ",\"device_name\":\"";
  bootPayload += DEVICE_NAME;
  bootPayload += "\",\"message\":\"esp32 online\"}";
  telemetryChar->setValue(bootPayload.c_str());
}

void sendMetrics() {
  voidage = randomWalk(voidage, 0.0f, 100.0f, 1.8f);
  tempC = randomWalk(tempC, 18.0f, 95.0f, 0.7f);

  String payload = "{\"type\":\"metrics\",\"ts\":";
  payload += millis();
  payload += ",\"voidage\":";
  payload += String(voidage, 1);
  payload += ",\"temp\":";
  payload += String(tempC, 1);
  payload += ",\"run_state\":";
  payload += runState;
  payload += "}";

  notifyJson(payload);
}

void sendEvent() {
  size_t idx = (size_t)random(0, (long)eventPoolCount);
  String payload = "{\"type\":\"event\",\"ts\":";
  payload += millis();
  payload += ",\"message\":\"";
  payload += eventPool[idx];
  payload += "\"}";

  notifyJson(payload);
}

void sendRunStateUpdate() {
  runState = (runState + 1) % 8;

  String payload = "{\"type\":\"state\",\"ts\":";
  payload += millis();
  payload += ",\"run_state\":";
  payload += runState;
  payload += "}";

  notifyJson(payload);
}

void setup() {
  Serial.begin(115200);
  delay(1000);

  randomSeed((uint32_t)esp_random());

  NimBLEDevice::init(DEVICE_NAME);

  NimBLEServer *server = NimBLEDevice::createServer();
  server->setCallbacks(new ServerCallbacks());

  NimBLEService *service = server->createService(SERVICE_UUID);

  telemetryChar = service->createCharacteristic(
    TELEMETRY_CHAR_UUID,
    NIMBLE_PROPERTY::NOTIFY | NIMBLE_PROPERTY::READ
  );
  updateBootIdentityValue();

  NimBLEAdvertising *advertising = NimBLEDevice::getAdvertising();
  advertising->setName(DEVICE_NAME);
  advertising->enableScanResponse(true);
  advertising->addServiceUUID(SERVICE_UUID);
  advertising->setPreferredParams(0x06, 0x12);
  NimBLEDevice::startAdvertising();

  Serial.println("BLE diagnostics demo started");
}

void loop() {
  unsigned long now = millis();

  if (!centralConnected) {
    // Keep characteristic readable with current boot identity while waiting for central.
    if (now - lastBootMs >= 2000) {
      lastBootMs = now;
      updateBootIdentityValue();
    }
    delay(20);
    return;
  }

  if (now - lastMetricsMs >= 1000) {
    lastMetricsMs = now;
    sendMetrics();
  }

  if (now - lastRunStateMs >= 7000) {
    lastRunStateMs = now;
    sendRunStateUpdate();
  }

  if (now - lastEventMs >= 10000) {
    lastEventMs = now;
    sendEvent();
  }

  delay(20);
}

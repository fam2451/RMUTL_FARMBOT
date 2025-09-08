#include <ArduinoJson.h>	`\label{lst:esp-1}`
#include <BH1750FVI.h>
#include <DallasTemperature.h>
#include <DHT.h>
#include <HTTPClient.h>
#include <OneWire.h>
#include <WiFi.h>
#include <Wire.h>
#include <vector>
#include "esp_wpa2.h"

// ===== Pin & Sensor Definitions =====
#define DHTPIN 4		`\label{lst:esp-2}`
#define DHTTYPE DHT22
#define DS18B20_PIN 32
#define PH_PIN 35
#define TDS_PIN 34

// ===== WiFi & API Settings =====
const char* ssid         = "@RMUTL−HiSpeed";	`\label{lst:esp-3}`
const char* identity     = "abcdef_gh65";
const char* username     = "abcdef_gh65";
const char* password     = "abcdefgh123456";
const char* api_url      = "https://your−website.com/api/farmbot_position"; `\label{lst:esp-4}`
const char* pond_api_url = "https://your−website.com/api/pond-positions";
const char* SHEET_BASE_URL =
"https://script.google.com/macros/s/yourtoken/exec";

// ===== Sensor Constants =====
#define VREF 3.3	`\label{lst:esp-5-1}`
#define ADC_RESOLUTION 4095.0
#define SCOUNT 30
#define AVERAGE_COUNT 5

// ===== Sensor & Object Initialization =====
DHT dht(DHTPIN, DHTTYPE);
OneWire oneWire(DS18B20_PIN);
DallasTemperature ds18b20(&oneWire);
BH1750FVI lightSensor(BH1750FVI::k_DevModeContLowRes);

// ===== Pond Struct =====	`\label{lst:esp-5-2}`
struct Pond {
	String name;
	float x;
	float y;
};
std::vector<Pond> ponds; // Using a vector instead of an array

// ===== Global Variables =====
float temp_dht = 0.0, humid = 0.0, temp_ds = 0.0, 
ph = 0.0, tds = 0.0, lux = 0.0;


// ===== WiFi Functions =====
void connectWiFi() {
	WiFi.disconnect(true);
	delay(500);
	WiFi.mode(WIFI_STA);
	esp_wifi_sta_wpa2_ent_enable();
	esp_wifi_sta_wpa2_ent_set_identity((uint8_t*)identity, strlen(identity));
	esp_wifi_sta_wpa2_ent_set_username((uint8_t*)username, strlen(username));
	esp_wifi_sta_wpa2_ent_set_password((uint8_t*)password, strlen(password));
	esp_wifi_sta_wpa2_ent_set_ca_cert(NULL, 0);
	WiFi.begin(ssid); `\label{lst:esp-6}`
	
	Serial.print("Connecting to WiFi");
	for (int i = 0; WiFi.status() != WL_CONNECTED && i < 20; i++) {
		Serial.print(".");
		delay(1000);
	}
	Serial.println(WiFi.status() == WL_CONNECTED ? "\nWiFi Connected!" 
										: "\nWiFi Connection Failed");
}

void checkWiFiReconnect() {
	if (WiFi.status() != WL_CONNECTED) {
		Serial.println("WiFi lost. Attempting to reconnect...");
		connectWiFi();
	}
}

// ===== Helper Functions =====
int readAverageADC(int pin, int times) { `\label{lst:esp-7}`
	long sum = 0;
	for (int i = 0; i < times; i++) {
		sum += analogRead(pin);
		delay(5);
	}
	return sum / times;
}

int getMedianNum(int* arr, int size) {
	for (int i = 0; i < size − 1; i++) {
		for (int j = i + 1; j < size; j++) {
			if (arr[i] > arr[j]) {
				int temp = arr[i];
				arr[i]   = arr[j];
				arr[j]   = temp;
			}
		}
	}
	return arr[size / 2];
}

// ===== Sensor Reading Functions =====
void readTDS() { `\label{lst:esp-8}`
	int buffer[SCOUNT];
	for (int i = 0; i < SCOUNT; i++) {
		buffer[i] = readAverageADC(TDS_PIN, AVERAGE_COUNT);
		delay(10);
	}
	int median    = getMedianNum(buffer, SCOUNT);
	float voltage = (float)median * VREF
	float compensationVoltage = voltage; 
	tds = (133.42 * pow(compensationVoltage, 3) − 255.86 * 
	pow(compensationVoltage, 2) +
	857.39 * compensationVoltage) * 0.5;
}

void readPH() { `\label{lst:esp-9}`
	float sum = 0.0;
	for (int i = 0; i < 100; i++) {
		sum += analogRead(PH_PIN);
		delay(5);
	}
	float avg     = sum / 100;
	float voltage = avg * VREF / ADC_RESOLUTION;
	ph            = −5.30 * voltage + 18.0;
}

void readDHT() { `\label{lst:esp-10}`
	do {
		temp_dht = dht.readTemperature();
		humid    = dht.readHumidity();
		delay(500);
	} while (isnan(temp_dht) || isnan(humid));
}

void readDS18B20() { `\label{lst:esp-11}`
	do {
		ds18b20.requestTemperatures();
		temp_ds = ds18b20.getTempCByIndex(0);
		delay(500);
	} while (temp_ds == −127.0);
}

void readLight() { `\label{lst:esp-12}`
	lux = lightSensor.GetLightIntensity();
}

// ===== Data Sending Functions =====
void sendGreenhouseToSheets() { `\label{lst:esp-13}`
	String urlGH = String(SHEET_BASE_URL);
	urlGH += "?temp_dht=" + String(temp_dht, 1);
	urlGH += "&humidity=" + String(humid, 1);
	urlGH += "&lux=" + String(lux);
	
	HTTPClient http;
	http.begin(urlGH);
	http.setFollowRedirects(HTTPC_STRICT_FOLLOW_REDIRECTS);
	int code = http.GET();
	Serial.printf("Send Greenhouse Sheets: %d\n", code);
	http.end();
}

// ===== Setup =====
void setup() {
	Serial.begin(115200);
	dht.begin();
	ds18b20.begin();
	Wire.begin();
	lightSensor.begin();
	connectWiFi();
}

// ===== Main Loop =====
void loop() {
	checkWiFiReconnect();
	float posX = 0, posY = 0, posZ = 0; `\label{lst:esp-14-1}`	
	// ===== 1. Fetch FarmBot Position (X, Y, Z) =====
	if (WiFi.status() == WL_CONNECTED) {
		HTTPClient http;
		http.begin(api_url);
		int code = http.GET();
		if (code == 200) {
			DynamicJsonDocument doc(512); // FarmBot JSON is small
			DeserializationError error = deserializeJson(doc, http.getString());
			if (!error) {
				posX = doc["x"];
				posY = doc["y"];
				posZ = doc["z"];
				Serial.printf("FarmBot Position: X=%.1f, Y=%.1f, Z=%.1f\n"
				, posX, posY, posZ);
			}
		}
		http.end();
	}
	
	// ===== 2. Fetch All Pond Positions =====
	if (WiFi.status() == WL_CONNECTED) { `\label{lst:esp-14-2}`
		HTTPClient http;
		http.begin(pond_api_url);
		int code = http.GET();
		if (code == 200) {
			DynamicJsonDocument doc(8192);
			DeserializationError error = deserializeJson(doc, http.getString());
			if (!error) {
				ponds.clear(); // Clear old data first
				for (int i = 0; i < doc.size(); i++) {
					Pond newPond;
					newPond.name = doc[i]["name"].as<String>();
					newPond.x    = doc[i]["x"];
					newPond.y    = doc[i]["y"];
					ponds.push_back(newPond);
				}
				Serial.printf("Received data for %d ponds from API\n", ponds.size());
			}
		}
		http.end();
	}
	
	// ===== 3. Read All Sensors =====
	readDHT();
	readDS18B20();
	readPH();
	readTDS();
	readLight();
	
	// ===== 4. Display Sensor Readings on Serial Monitor =====
	Serial.println("\n[GreenHouse]");
	Serial.printf("  Temp_DHT: %.1f C\n", temp_dht);
	Serial.printf("  Humidity: %.1f %%\n", humid);
	Serial.printf("  Lux: %.0f lx\n", lux);
	Serial.println("[Pond Sensor]");
	Serial.printf("  Temp_DS18B20: %.1f C\n", temp_ds);
	Serial.printf("  pH: %.2f\n", ph);
	Serial.printf("  TDS: %.0f ppm\n", tds);
	Serial.println("======================================");
	
	// ===== 5. Check Position and Send Data =====
	Serial.println("Checking Pond Proximity and Z-axis..."); `\label{lst:esp-14-3}`
	bool sent = false;	
	for (const auto& pond : ponds) {
		float dx = abs(posX - pond.x);
		float dy = abs(posY - pond.y);		
		if (dx <= 50 && dy <= 50) {
			Serial.printf("Near pond %s (dx=%.1f, dy=%.1f)\n", 
			pond.name.c_str(), dx, dy);		
			if (abs(posZ - 260) <= 10) {
				if (temp_ds != -127.0 && !isnan(ph) && !isnan(tds)) {
					String name = pond.name;
					name.replace(" ", "%20"); // URL encode spaces					
					String tdsStr = String((int)tds);
					tdsStr.trim();					
					String urlPond = String(SHEET_BASE_URL) + "?pond=" + name +
					"&x=" + String(posX, 1) + "&y=" + String(posY, 1) +
					"&temp=" + String(temp_ds, 1) + "&ph=" + String(ph, 2) +
					"&tds=" + tdsStr;					
					Serial.println("Pond URL: " + urlPond);
					HTTPClient http;
					http.begin(urlPond);
					http.setFollowRedirects(HTTPC_STRICT_FOLLOW_REDIRECTS);
					int code = http.GET();
					Serial.printf("Send Pond Sheets Status: %d\n", code);
					http.end();					
					sendGreenhouseToSheets();
					sent = true;
					break;
				} else {
					Serial.println("Not sending Pond data due to sensor error 
					(DS18B20, pH, or TDS).");
				}
			} else {
				Serial.printf("Z is at %.1f, not at measurement level (260). 
				Waiting...\n", posZ);
			}
		}
	}	
	if (!sent) {
		sendGreenhouseToSheets();
	}
	delay(10000);
}
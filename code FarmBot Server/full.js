import express from "express";
import axios from "axios";
import mqtt from "mqtt";

// กำหนดค่า credential ตรงนี้
const EMAIL = "eelab.rmutl@gmail.com";
const PASSWORD = "Rmutl0001";
const FARM_API_URL = "https://my.farm.bot";

const app = express();
app.use(express.json());

let jwtToken = null;
let mqttClient = null;

// ฟังก์ชันขอ Token จาก FarmBot API
async function getJwtToken() {
  try {
    const res = await axios.post(`${FARM_API_URL}/api/tokens`, {
      user: { email: EMAIL, password: PASSWORD }
    });
    jwtToken = res.data.token.encoded;
    console.log("✅ JWT Token:", jwtToken);
    return res.data.token;
  } catch (error) {
    console.error("❌ JWT Error:", error.message);
    throw error;
  }
}

// ฟังก์ชันเชื่อมต่อ MQTT
async function connectMQTT() {
  const token = await getJwtToken();
  
  const mqttServer = token.unencoded.mqtt;
  const deviceId = token.unencoded.bot;

  mqttClient = mqtt.connect(`mqtt://${mqttServer}`, {
    username: deviceId,
    password: token.encoded,
    port: 1883
  });

  mqttClient.on('connect', () => {
    console.log("✅ MQTT Connected");
    mqttClient.subscribe(`bot/${deviceId}/status`, (err) => {
      if (!err) console.log(`✅ Subscribed to bot/${deviceId}/status`);
      else console.error("❌ MQTT Subscribe Error:", err);
    });
  });

  mqttClient.on('message', (topic, message) => {
    const data = JSON.parse(message.toString());
    console.log(`📥 Received message from ${topic}:`, data);
  });

  mqttClient.on('error', (err) => {
    console.error("❌ MQTT Error:", err.message);
  });
}

// route ง่ายๆสำหรับเช็ค server
app.get("/", (req, res) => {
  res.send("🌐 FarmBot MQTT Server Running");
});

async function main() {
  await connectMQTT();
  app.listen(3000, () => {
    console.log("🌐 Server running at http://localhost:3000");
  });
}

main().catch(console.error);

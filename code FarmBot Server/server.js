const express = require("express");
const axios = require("axios");
const mqtt = require("mqtt");
const path = require("path");
const { v4: uuidv4 } = require("uuid");

const EMAIL = "your.farmbot@gmail.com"; // Your FarmBot Email
const PASSWORD = "abcdefgh1234 "; // Your FarmBot Password
const FARM_API_URL = "https://my.farm.bot";
const googleSheetURL =
"https://script.google.com/macros/xxx/exec"; // Your AppScript URL
const TEMPLATE_POND_NAME = "Pond X";

let jwtToken = null;
let token = null;
let mqttClient = null;
let mqttStatus = null;
let peripheralMap = {};

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));
app.get("/", (req, res) => {
	res.sendFile(path.join(__dirname, "public", "dashboard.html"));
});
let clients = [];
app.get("/api/stream-status", (req, res) => {
	res.setHeader("Content-Type", "text/event-stream");
	res.setHeader("Cache-Control", "no-cache");
	res.setHeader("Connection", "keep-alive");
	res.flushHeaders(); 
	const clientId = Date.now();
	const newClient = { id: clientId, res };
	clients.push(newClient);
	console.log(`New client connected for real-time updates: ${clientId}`);
	req.on("close", () => {
		clients = clients.filter((client) => client.id !== clientId);
		console.log(`Client disconnected: ${clientId}`);
	});
});

function sendStatusToAllClients(data) {
	const sseFormattedData = `data: ${JSON.stringify(data)}\n\n`;
	clients.forEach((client) => client.res.write(sseFormattedData));
}

async function getJwtToken() {
	const res = await axios.post(`${FARM_API_URL}/api/tokens`, {
		user: { email: EMAIL, password: PASSWORD },
	});
	jwtToken = res.data.token.encoded;
	token = res.data.token;
	return res.data.token;
}

async function farmBotApiGet(url, attempt = 0) {
	if (!jwtToken) await getJwtToken();
	try {
		const response = await axios.get(`${FARM_API_URL}${url}`, {
			headers: { Authorization: `Bearer ${jwtToken}` },
		});
		return response.data;
	} catch (err) {
		if (err.response && err.response.status === 401 && attempt < 1) {
			await getJwtToken();
			return farmBotApiGet(url, attempt + 1);
		} else {
			throw err;
		}
	}
}

async function farmBotApiPost(url, body, attempt = 0) {
	if (!jwtToken) await getJwtToken();
	try {
		const response = await axios.post(`${FARM_API_URL}${url}`, body, {
			headers: { Authorization: `Bearer ${jwtToken}` },
		});
		return response.data;
	} catch (err) {
		if (err.response && err.response.status === 401 && attempt < 1) {
			await getJwtToken();
			return farmBotApiPost(url, body, attempt + 1);
		} else {
			throw err;
		}
	}
}

async function farmBotApiPatch(url, body, attempt = 0) {
	if (!jwtToken) await getJwtToken();
	try {
		console.log("DEBUG: farmBotApiPatch Request Details");
		console.log(JSON.stringify({ url: url, body: body }, null, 2));
		const response = await axios.patch(`${FARM_API_URL}${url}`, body, {
			headers: { Authorization: `Bearer ${jwtToken}` },
		});
		return response.data;
	} catch (err) {
		if (err.response && err.response.status === 401 && attempt < 1) {
			await getJwtToken();
			return farmBotApiPatch(url, body, attempt + 1);
		} else {
			throw err;
		}
	}
}

async function farmBotApiDelete(url, attempt = 0) {
	if (!jwtToken) await getJwtToken();
	try {
		await axios.delete(`${FARM_API_URL}${url}`, {
			headers: { Authorization: `Bearer ${jwtToken}` },
		});
	} catch (err) {
		if (err.response && err.response.status === 401 && attempt < 1) {
			await getJwtToken();
			return farmBotApiDelete(url, attempt + 1);
		} else {
			throw err;
		}
	}
}

async function getDataToGoogleSheet() {
	try {
		const data = { key1: "value1", key2: "value2" };
		const response = await axios.get(googleSheetURL, data);
		console.log("Data successfully Get:", response.data);
	} catch (err) {
		console.error("Error posting data to Google Sheets:", err);
	}
}

// === MQTT Connect ===
async function connectMQTT() {
	if (!token) await getJwtToken();
	const mqttUrl = `mqtts://${token.unencoded.mqtt}:8883`;
	const mqttUser = token.unencoded.bot;
	const mqttPass = token.encoded;
	
	console.log("- Token received");
	console.log("- Connecting to MQTT broker:", mqttUrl);
	
	mqttClient = mqtt.connect(mqttUrl, {
		username: mqttUser,
		password: mqttPass,
		clientId: `mqtt_${Math.random().toString(16).slice(3)}`,
		rejectUnauthorized: false,
	});
	
	mqttClient.on("connect", () => {
		console.log("- MQTT Connected");
		const mqttUser = token.unencoded.bot;
		
		const statusTopic = `bot/${mqttUser}/status`;
		mqttClient.subscribe(statusTopic, (err) => {
			if (!err) console.log(`- Subscribed to: ${statusTopic}`);
		});
		
		const commandsTopic = `bot/${mqttUser}/from_clients`;
		mqttClient.subscribe(commandsTopic, (err) => {
			if (!err) console.log(`Subscribed to: ${commandsTopic}`);
		});
	});
	
	mqttClient.on("message", (topic, message) => {
		if (topic.endsWith("/status")) {
			try {
				mqttStatus = JSON.parse(message.toString());
				sendStatusToAllClients(mqttStatus);
			} catch (e) {
				/* ... */
			}
		}
		if (topic.endsWith("/status")) {
			try {
				mqttStatus = JSON.parse(message.toString());
			} catch (e) {
				console.warn("Invalid MQTT message:", e.message);
			}
		}
	});
	
	mqttClient.on("error", (err) => {
		console.error("MQTT Error:", err.message);
	});
}

function sendCeleryScript(body) {
	if (!mqttClient || !token) {
		console.error("MQTT not ready yet");
		return null;
	}
	
	const label = uuidv4();
	
	const payload = JSON.stringify({
		kind: "rpc_request",
		args: { label: label },
		body: [body],
	});
	const topic = `bot/${token.unencoded.bot}/from_clients`;
	
	mqttClient.publish(topic, payload, {}, (err) => {
		if (err) {
			console.error("Failed to publish CeleryScript:", err.message);
		} else {
			console.log(`CeleryScript published with label: ${label}.`);
		}
	});
	return label;
}

// === Fetch peripherals ===
async function fetchPeripherals() {
	try {
		const peripherals = await farmBotApiGet("/api/peripherals");
		peripheralMap = {};
		peripherals.forEach((peri) => {
			peripheralMap[peri.pin] = peri.label;
		});
	} catch (err) {
		console.error("Failed to fetch peripherals:", err.message);
	}
}

app.get("/api/mqtt_status", (req, res) => {
	if (!mqttStatus) return res.status(503).json({ error: "No status yet" });
	res.json(mqttStatus);
});
app.get("/api/farmbot_position", (req, res) => {
	if (
	!mqttStatus ||
	!mqttStatus.location_data ||
	!mqttStatus.location_data.position
	)
	return res.status(503).json({ error: "No FarmBot position data" });
	const pos = mqttStatus.location_data.position;
	res.json({ x: pos.x, y: pos.y, z: pos.z });
});
app.get("/api/sequence/:id", async (req, res) => {
	try {
		const seq = await farmBotApiGet(`/api/sequences/${req.params.id}`);
		res.json(seq);
	} catch (err) {
		res.status(500).json({ error: "Failed to fetch sequence detail" });
	}
});
app.get("/api/peripherals_all", async (req, res) => {
	try {
		const peripherals = await farmBotApiGet("/api/peripherals");
		res.json(peripherals);
	} catch (err) {
		res.status(500).json({ error: "Failed to fetch peripherals" });
	}
});
app.get("/api/sequences_all", async (req, res) => {
	try {
		const sequences = await farmBotApiGet("/api/sequences");
		res.json(sequences);
	} catch (err) {
		res.status(500).json({ error: "Failed to fetch all sequences" });
	}
});
app.get("/api/points_all", async (req, res) => {
	try {
		const points = await farmBotApiGet("/api/points");
		res.json(points);
	} catch (err) {
		res.status(500).json({ error: "Failed to fetch points" });
	}
});
app.get("/api/tools_all", async (req, res) => {
	try {
		const tools = await farmBotApiGet("/api/tools");
		res.json(tools);
	} catch (err) {
		res.status(500).json({ error: "Failed to fetch tools" });
	}
});
app.get("/logs/all", async (req, res) => {
	try {
		const logs = await farmBotApiGet("/api/logs");
		const limitedLogs = logs.slice(0, 300);
		const convertedLogs = limitedLogs.map((log) => ({
			...log,
			created_at_thai: new Date(log.created_at * 1000).toLocaleString("en-GB", 
			{
				timeZone: "Asia/Bangkok",
			}),
		}));
		res.json(convertedLogs);
	} catch (err) {
		res.status(500).json({ error: "Failed to get all logs" });
	}
});

app.get("/api/pond-positions", async (req, res) => {
	try {
		const points = await farmBotApiGet("/api/points");
		const pondNamePattern = /^Pond\s+\d+$/;
		let ponds = points
		.filter((p) => pondNamePattern.test(p.name))
		.map((p) => ({ name: p.name, x: p.x ?? null, y: p.y ?? null }))
		.sort(
		(a, b) =>
		parseInt(a.name.split(" ")[1]) - parseInt(b.name.split(" ")[1])
		);
		res.json(ponds);
	} catch (err) {
		res.status(500).json({ error: "Failed to get pond positions" });
	}
});
app.get("/logs", async (req, res) => {
	try {
		const logs = await farmBotApiGet("/api/logs");
		const convertedLogs = logs.map((log) => ({
			...log,
			created_at_thai: new Date(log.created_at * 1000).toLocaleString("en-GB", 
			{
				timeZone: "Asia/Bangkok",
			}),
		}));
		res.json(convertedLogs);
	} catch (err) {
		res.status(500).json({ error: "Failed to get logs" });
	}
});
app.get("/api/farmbot_data", async (req, res) => {
	try {
		const farmbot = mqttStatus
		? {
			x: mqttStatus.location_data.position.x,
			y: mqttStatus.location_data.position.y,
			z: mqttStatus.location_data.position.z,
		}
		: { x: null, y: null, z: null };
		const points = await farmBotApiGet("/api/points");
		const pondDataFromAppScript = await axios.get(googleSheetURL);
		const sensorData = pondDataFromAppScript.data.pondData;
		const pondNamePattern = /^Pond\s+\d+$/;
		let foundPonds = points
		.filter((p) => pondNamePattern.test(p.name))
		.sort(
		(a, b) =>
		parseInt(a.name.split(" ")[1]) - parseInt(b.name.split(" ")[1])
		);
		const ponds = foundPonds.map((p) => {
			const sensor = sensorData.find((s) => s.pondName === p.name) || {};
			return {
				id: p.id,
				name: p.name,
				x: p.x ?? null,
				y: p.y ?? null,
				z: p.z ?? null,
				temp: sensor.pondTemp ?? null,
				tds: sensor.pondTds ?? null,
				ph: sensor.pondPh ?? null,
				includeInMeasureAll: p.meta.include_in_measure_all === "true",
				lastChecked: sensor.pondTime ?? null,
			};
		});
		res.json({ farmbot, ponds });
	} catch (err) {
		res.status(500).json({ error: "Failed to get farmbot_data" });
	}
});
app.get("/api/greenhouse", async (req, res) => {
	try {
		const response = await axios.get(googleSheetURL);
		if (
		response.data &&
		response.data.greenhouseData &&
		response.data.greenhouseData.length > 0
		) {
			res.json(response.data.greenhouseData[0]);
		} else {
			res.json({ tempDht: null, humidity: null, lux: null });
		}
	} catch (err) {
		res.status(500).json({ error: "Failed to fetch greenhouse data" });
	}
});
app.get("/api/pond_data", async (req, res) => {
	try {
		const response = await axios.get(googleSheetURL);
		res.json(response.data.pondData[0]);
	} catch (err) {
		res.status(500).json({ error: "Failed to fetch pond data" });
	}
});
app.post("/api/peripheral", (req, res) => {
	const { pin, value } = req.body;
	sendCeleryScript({
		kind: "write_pin",
		args: { pin_number: pin, pin_value: value, pin_mode: 0 },
	});
	res.json({ message: `Peripheral pin ${pin} set to ${value}` });
});
app.post("/api/find_home", (req, res) => {
	const { axis, speed } = req.body;
	sendCeleryScript({ kind: "find_home", args: { axis: axis, speed: speed }});
	res.json({ message: `Sent find_home on axis ${axis} at speed ${speed}` });
});

app.post("/api/move_absolute", (req, res) => {
	if (
	!mqttStatus ||
	!mqttStatus.location_data ||
	!mqttStatus.location_data.position
	) {
		return res
		.status(503)
		.json({ error: "ยังไม่มีข้อมูลตำแหน่งปัจจุบันของ FarmBot" });
	}
	const currentPos = mqttStatus.location_data.position;
	const destination = {
		x: req.body.x ?? currentPos.x,
		y: req.body.y ?? currentPos.y,
		z: req.body.z ?? currentPos.z,
	};
	const speed = req.body.speed || 100;
	sendCeleryScript({
		kind: "move_absolute",
		args: {
			location: { kind: "coordinate", args: destination },
			offset: { kind: "coordinate", args: { x: 0, y: 0, z: 0 } },
			speed: speed,
		},
	});
	res.json({
		message: `Moving to 
		 X:${destination.x}
		 Y:${destination.y} 
		 Z:${destination.z} 
		 at speed ${speed}`,
	});
});

app.post("/api/toggle-light", (req, res) => {
	sendCeleryScript({
		kind: "write_pin",
		args: { pin_number: 65, pin_value: req.body.value, pin_mode: 0 },
	});
	res.json({
		 message: `Light set to ${req.body.value === 1 ? "ON" : "OFF"}` 
		 });
});
app.post("/api/toggle-fan", (req, res) => {
	sendCeleryScript({
		kind: "write_pin",
		args: { pin_number: 10, pin_value: req.body.value, pin_mode: 0 },
	});
	res.json({ message: `FAN set to ${req.body.value === 1 ? "ON" : "OFF"}` });
});
app.get("/api/peripheral_state/:pin", (req, res) => {
	const pinNumber = req.params.pin;
	if (!mqttStatus || !mqttStatus.pins)
	return res.status(503).json({ error: "No status data" });
	const pinObj = mqttStatus.pins[pinNumber];
	if (!pinObj) return res.json({ value: null });
	res.json({ value: pinObj.value });
});
app.get("/api/events_full", async (req, res) => {
	try {
		const events = await farmBotApiGet("/api/farm_events");
		res.json(events);
	} catch (err) {
		res.status(500).json({ error: "Failed to get full farm events" });
	}
});
// --- FarmEvents Management ---
app.get("/api/farm_events", async (req, res) => {
	try {
		res.json(await farmBotApiGet("/api/farm_events"));
	} catch (e) {
		res.status(500).json({
			 error: `Failed to get farm_events: ${e.message}` 
			 });
	}
});

app.get("/api/farm_events/:id", async (req, res) => {
	try {
		res.json(await farmBotApiGet(`/api/farm_events/${req.params.id}`));
	} catch (e) {
		res.status(500).json({
			error: `Failed to get farm_event ${req.params.id}: ${e.message}`,
		});
	}
});

app.post("/api/farm_events", async (req, res) => {
	try {
		res.status(201).json(await farmBotApiPost("/api/farm_events", req.body));
	} catch (e) {
		res
		.status(500)
		.json({ error: `Failed to create farm_event: ${e.message}` });
	}
});

app.patch("/api/farm_events/:id", async (req, res) => {
	try {
		res.json(
		await farmBotApiPatch(`/api/farm_events/${req.params.id}`, req.body)
		);
	} catch (e) {
		res.status(500).json({
			error: `Failed to update farm_event ${req.params.id}: ${e.message}`,
		});
	}
});

app.delete("/api/farm_events/:id", async (req, res) => {
	try {
		await farmBotApiDelete(`/api/farm_events/${req.params.id}`);
		res.status(204).send();
	} catch (e) {
		res.status(500).json({
			error: `Failed to delete farm_event ${req.params.id}: ${e.message}`,
		});
	}
});

app.get("/api/points", async (req, res) => {
	try {
		res.json(await farmBotApiGet("/api/points"));
	} catch (e) {
		res.status(500).json({ error: `Failed to get points: ${e.message}` });
	}
});
app.get("/api/points/:id", async (req, res) => {
	try {
		res.json(await farmBotApiGet(`/api/points/${req.params.id}`));
	} catch (e) {
		res
		.status(500)
		.json({ error: `Failed to get point ${req.params.id}: ${e.message}` });
	}
});
app.post("/api/points", async (req, res) => {
	try {
		res.status(201).json(await farmBotApiPost("/api/points", req.body));
	} catch (e) {
		res.status(500).json({ error: `Failed to create point: ${e.message}` });
	}
});
app.patch("/api/points/:id", async (req, res) => {
	try {
		res.json(await farmBotApiPatch(`/api/points/${req.params.id}`, req.body));
	} catch (e) {
		res
		.status(500)
		.json({ error: `Failed to update point ${req.params.id}: ${e.message}` });
	}
});
app.delete("/api/points/:id", async (req, res) => {
	try {
		await farmBotApiDelete(`/api/points/${req.params.id}`);
		res.status(204).send();
	} catch (e) {
		res
		.status(500)
		.json({ error: `Failed to delete point ${req.params.id}: ${e.message}` });
	}
});


app.get("/api/sequences", async (req, res) => {
	try {
		res.json(await farmBotApiGet("/api/sequences"));
	} catch (e) {
		res.status(500).json({ error: `Failed to get sequences: ${e.message}` });
	}
});

app.post("/api/sequences", async (req, res) => {
	try {
		res.status(201).json(await farmBotApiPost("/api/sequences", req.body));
	} catch (e) {
		res.status(500).json({ error: `Failed to create sequence: ${e.message}` });
	}
});

app.patch("/api/sequences/:id", async (req, res) => {
	try {
		res.json(
		await farmBotApiPatch(`/api/sequences/${req.params.id}`, req.body)
		);
	} catch (e) {
		res.status(500).json({
			error: `Failed to update sequence ${req.params.id}: ${e.message}`,
		});
	}
});

app.delete("/api/sequences/:id", async (req, res) => {
	try {
		await farmBotApiDelete(`/api/sequences/${req.params.id}`);
		res.status(204).send();
	} catch (e) {
		res.status(500).json({
			error: `Failed to delete sequence ${req.params.id}: ${e.message}`,
		});
	}
});

app.get("/api/tools", async (req, res) => {
	try {
		res.json(await farmBotApiGet("/api/tools"));
	} catch (e) {
		res.status(500).json({ error: `Failed to get tools: ${e.message}` });
	}
});
app.get("/api/tools/:id", async (req, res) => {
	try {
		res.json(await farmBotApiGet(`/api/tools/${req.params.id}`));
	} catch (e) {
		res
		.status(500)
		.json({ error: `Failed to get tool ${req.params.id}: ${e.message}` });
	}
});
app.post("/api/tools", async (req, res) => {
	try {
		res.status(201).json(await farmBotApiPost("/api/tools", req.body));
	} catch (e) {
		res.status(500).json({ error: `Failed to create tool: ${e.message}` });
	}
});
app.patch("/api/tools/:id", async (req, res) => {
	try {
		res.json(await farmBotApiPatch(`/api/tools/${req.params.id}`, req.body));
	} catch (e) {
		res
		.status(500)
		.json({ error: `Failed to update tool ${req.params.id}: ${e.message}` });
	}
});

app.delete("/api/tools/:id", async (req, res) => {
	try {
		await farmBotApiDelete(`/api/tools/${req.params.id}`);
		res.status(204).send();
	} catch (e) {
		res
		.status(500)
		.json({ error: `Failed to delete tool ${req.params.id}: ${e.message}` });
	}
});

app.post("/api/ponds", async (req, res) => {
	const { name, x, y } = req.body; // name = "Pond 5"
	if (!name || x === undefined || y === undefined) {
		return res.status(400).json({ error: "Name, X, and Y are required." });
	}
	
	try {
		// 1. ดึงข้อมูลทั้งหมด
		console.log("Fetching all existing points and sequences...");
		const allPoints = await farmBotApiGet("/api/points");
		const allSequences = await farmBotApiGet("/api/sequences");
		
		// 2. ตรวจสอบว่ามี Point ของบ่อใหม่ (Pond 5) อยู่แล้วหรือยัง
		if (allPoints.some((p) => p.name === name)) {
			console.error(`Error: Point named '${name}' already exists.`);
			return res
			.status(409)
			.json({ error: `Point named '${name}' already exists.` });
		}
		
		// 3. ค้นหา Point แม่แบบ (Pond X)
		const templatePoint = allPoints.find((p) => p.name === TEMPLATE_POND_NAME);
		if (!templatePoint) {
			console.error(
			`CRITICAL: Template point named '${TEMPLATE_POND_NAME}' not found.`
			);
			return res.status(500).json({
				error: `Template point '${TEMPLATE_POND_NAME}' not found. Please create it first.`,
			});
		}
		const templatePointId = templatePoint.id;
		
		// 4. ค้นหา Sequences แม่แบบทั้งหมด (ที่ลงท้ายด้วย " Pond X")
		const templateSequences = allSequences.filter((s) =>
		s.name.endsWith(` ${TEMPLATE_POND_NAME}`)
		);
		console.log(
		`Found ${templateSequences.length} template sequences based on '${TEMPLATE_POND_NAME}'.`
		);
		
		// 5. สร้าง Point ใหม่สำหรับบ่อนี้ (Pond 5)
		console.log(`Creating new point: '${name}' at (${x}, ${y})`);
		const newPoint = await farmBotApiPost("/api/points", {
			pointer_type: "GenericPointer",
			name: name,
			x: parseFloat(x),
			y: parseFloat(y),
			z: 0,
			radius: 50,
			meta: { color: "green" },
		});
		console.log(`Successfully created '${name}' with ID: ${newPoint.id}`);
		
		// 6. วนลูปสร้างซีเควนซ์ทั้งหมดจากแม่แบบ
		let createdCount = 0;
		for (const templateSeq of templateSequences) {
			// สร้างชื่อใหม่ เช่น "Measure Pond X" -> "Measure Pond 5"
			const actionPrefix = templateSeq.name
			.replace(` ${TEMPLATE_POND_NAME}`, "")
			.trim();
			const newSeqName = `${actionPrefix} ${name}`;
			
			if (allSequences.some((s) => s.name === newSeqName)) {
				console.log(`Skipping: Sequence '${newSeqName}' already exists.`);
				continue;
			}
			
			console.log(`'${templateSeq.name}' to create '${newSeqName}'...`);
			
			const newBody = JSON.parse(JSON.stringify(templateSeq.body));
			
			// ค้นหาและแทนที่ ID ของ Point แม่แบบ (Pond X) ด้วย ID ของ Point ใหม่ (Pond 5)
			newBody.forEach((step) => {
				if (step.body && Array.isArray(step.body)) {
					step.body.forEach((innerStep) => {
						if (
						innerStep.args?.axis_operand?.args?.pointer_id===templatePointId
						) {
							console.log(
							`Replaced pointer ID in step '${innerStep.kind}'`
							);
							innerStep.args.axis_operand.args.pointer_id = newPoint.id;
						}
					});
				}
			});
			
			// สร้างซีเควนซ์ใหม่
			await farmBotApiPost("/api/sequences", {
				name: newSeqName,
				color: templateSeq.color,
				folder_id: templateSeq.folder_id,
				args: templateSeq.args,
				body: newBody,
			});
			createdCount++;
		}
		
		res.status(201).json({
			message: `Successfully created pond '${name}' ${createdCount} .`,
			point: newPoint,
		});
	} catch (error) {
		console.error(
		"Failed to create pond:",
		error.response ? error.response.data : error.message
		);
		res
		.status(500)
		.json({ error: "An unexpected error occurred while creating the pond." });
	}
});

// REPLACE THE app.patch("/api/ponds/:pointId",...) with this FINAL version.
app.patch("/api/ponds/:pointId", async (req, res) => {
	const pointId = parseInt(req.params.pointId, 10);
	const { x, y, includeInMeasureAll } = req.body;
	const MASTER_SEQUENCE_NAME = "Measure All";
	
	try {
		const pointData = await farmBotApiGet(`/api/points/${pointId}`);
		if (!pointData) {
			return res.status(404).json({ error: "Point not found." });
		}
		
		// --- Step 1: Update the Point ---
		// This part is now correct and should be working.
		const newMeta = {
			...pointData.meta,
			include_in_measure_all: String(includeInMeasureAll),
		};
		await farmBotApiPatch(`/api/points/${pointId}`, {
			name: pointData.name,
			x: x,
			y: y,
			meta: newMeta,
		});
		console.log(
		`Point ID ${pointId} ("${pointData.name}") updated successfully.`
		);
		
		// Step 2: Update the "Measure All" Sequence 
		const allSequences = await farmBotApiGet("/api/sequences");
		const measureAllSequence = allSequences.find(
		(s) => s.name === MASTER_SEQUENCE_NAME
		);
		const targetMeasureSequence = allSequences.find(
		(s) => s.name === `Measure ${pointData.name}`
		);
		
		if (!measureAllSequence || !targetMeasureSequence) {
			console.warn(
			`Could not find required sequences for "${MASTER_SEQUENCE_NAME}".`
			);
			return res.json({
				message: "Pond updated, but Measure All sequence was not modified.",
			});
		}
		
		// (Logic for adding/removing/sorting steps remains the same)
		let currentBody = measureAllSequence.body || [];
		let measureSteps = currentBody.filter((step) => step.kind === "execute");
		const stepExists = measureSteps.some(
		(step) => step.args.sequence_id === targetMeasureSequence.id
		);
		
		if (includeInMeasureAll && !stepExists) {
			measureSteps.push({
				kind: "execute",
				args: { sequence_id: targetMeasureSequence.id },
			});
		} else if (!includeInMeasureAll && stepExists) {
			measureSteps = measureSteps.filter(
			(step) => step.args.sequence_id !== targetMeasureSequence.id
			);
		}
		
		const seqIdToNameMap = {};
		allSequences.forEach((s) => {
			seqIdToNameMap[s.id] = s.name;
		});
		measureSteps.sort((a, b) => {
			const nameA = seqIdToNameMap[a.args.sequence_id] || "";
			const nameB = seqIdToNameMap[b.args.sequence_id] || "";
			const numA = parseInt((nameA.match(/\d+$/) || [Infinity])[0], 10);
			const numB = parseInt((nameB.match(/\d+$/) || [Infinity])[0], 10);
			return numA - numB;
		});
		
		const otherSteps = currentBody.filter((step) => step.kind !== "execute");
		const firstExecuteIndex = currentBody.findIndex(
		(step) => step.kind === "execute"
		);
		
		let newBody = [];
		if (firstExecuteIndex === -1) {
			newBody = [...otherSteps, ...measureSteps];
		} else {
			const header = otherSteps.filter(
			(_, index) => index < firstExecuteIndex
			);
			const footer = otherSteps.filter(
			(_, index) => index >= firstExecuteIndex
			);
			newBody = [...header, ...measureSteps, ...footer];
		}
		
		await farmBotApiPatch(`/api/sequences/${measureAllSequence.id}`, {
			name: measureAllSequence.name, // <<< FIX IS HERE
			body: newBody,
		});
		
		console.log(
		`[SUCCESS] Successfully updated and sorted "${MASTER_SEQUENCE_NAME}".`
		);
		res.json({
			message: "Pond and Measure All sequence updated successfully.",
		});
	} catch (error) {
		// A slightly more descriptive error log
		const errorMessage = error.response
		? JSON.stringify(error.response.data)
		: error.message;
		console.error(
		"[ERROR] An error occurred during the pond update process:",
		errorMessage
		);
		res.status(500).json({ error: "Failed to update data. " + errorMessage });
	}
});
// REPLACE THE OLD app.delete("/api/ponds/:pointId",...) with this
app.delete("/api/ponds/:pointId", async (req, res) => {
	const pointId = parseInt(req.params.pointId, 10);
	const MASTER_SEQUENCE_NAME = "Measure All";
	
	try {
		console.log(`--- [START DELETE PROCESS] --- for Point ID: ${pointId}`);
		
		const allPoints = await farmBotApiGet("/api/points");
		const allSequences = await farmBotApiGet("/api/sequences");
		
		const pointToDelete = allPoints.find((p) => p.id === pointId);
		if (!pointToDelete)
		return res.status(404).json({ error: "Point to delete not found." });
		const pondName = pointToDelete.name;
		
		// --- Step 1: Safely remove step from "Measure All" FIRST ---
		const measureAllSequence = allSequences.find(
		(s) => s.name === MASTER_SEQUENCE_NAME
		);
		if (measureAllSequence) {
			const targetMeasureSequence = allSequences.find(
			(s) => s.name === `Measure ${pondName}`
			);
			if (targetMeasureSequence) {
				let measureAllBody = measureAllSequence.body || [];
				const initialLength = measureAllBody.length;
				measureAllBody = measureAllBody.filter(
				(step) =>
				!(
				step.kind === "execute" &&
				step.args.sequence_id === targetMeasureSequence.id
				)
				);
				
				if (measureAllBody.length < initialLength) {
					console.log(
					`Removing "Measure ${pondName}" from 
					"${MASTER_SEQUENCE_NAME}" before deletion.`
					);
					// FIX: Added the 'name' property to the PATCH payload
					await farmBotApiPatch(`/api/sequences/${measureAllSequence.id}`, {
						name: measureAllSequence.name, // <<< THE FIX IS HERE
						body: measureAllBody,
					});
				}
			}
		}
		
		// --- Step 2: Find and delete all directly related sequences ---
		const sequencesToDelete = allSequences.filter((s) =>
		s.name.endsWith(` ${pondName}`)
		);
		for (const seq of sequencesToDelete) {
			console.log(
			`[ACTION] Deleting dependent sequence: '${seq.name}' (ID: ${seq.id})`
			);
			await farmBotApiDelete(`/api/sequences/${seq.id}`);
		}
		
		// --- Step 3: Delete the point itself ---
		console.log(
		`[ACTION] Deleting final point: '${pondName}' (ID: ${pointId})`
		);
		await farmBotApiDelete(`/api/points/${pointId}`);
		
		console.log(
		`--- [SUCCESS] --- Deletion process for Point ID ${pointId} completed.`
		);
		res.status(204).send();
	} catch (error) {
		console.error(
		"--- [!!! DELETE FAILED !!!] ---",
		error.response ? JSON.stringify(error.response.data) : error.message
		);
		res
		.status(500)
		.json({ error: "An error occurred during the deletion process." });
	}
});

app.post("/api/sequences/execute-measure-all", async (req, res) => {
	const { selected_pond_names } = req.body;
	if (!selected_pond_names || selected_pond_names.length === 0) {
		return res.status(400).json({ 
			error: "Please select at least one pond." 
			});
	}
	const MASTER_SEQUENCE_ID = 255256; // << ID ของ "Measure All"
	try {
		const allSequences = await farmBotApiGet("/api/sequences");
		const newSteps = selected_pond_names
		.map((pondName) => {
			const targetSequence = allSequences.find(
			(s) => s.name === `Measure ${pondName}`
			);
			return targetSequence
			? { kind: "execute", args: { sequence_id: targetSequence.id } }
			: null;
		})
		.filter(Boolean);
		
		if (newSteps.length === 0)
		return res
		.status(404)
		.json({ error: "Could not find any matching sequences." });
		
		await farmBotApiPatch(`/api/sequences/${MASTER_SEQUENCE_ID}`, {
			body: [
			{ kind: "find_home", args: { axis: "all", speed: 100 } },
			...newSteps,
			{ kind: "find_home", args: { axis: "all", speed: 100 } },
			],
		});
		
		sendCeleryScript({
			kind: "execute",
			args: { sequence_id: MASTER_SEQUENCE_ID },
		});
		res.json({
			message: 
			`Executing updated "Measure All" sequence for ${newSteps.length} ponds.`,
		});
	} catch (error) {
		console.error("Failed to execute measure-all sequence:", error);
		res.status(500).json({ error: "Failed to execute sequence." });
	}
});
app.post("/api/sequences/weed-pond", async (req, res) => {
	const { pondName, delay } = req.body;
	
	if (!pondName || delay === undefined || delay <= 0) {
		return res
		.status(400)
		.json({ error: "ข้อมูล pondName หรือ delay ไม่ถูกต้อง" });
	}
	
	const sequenceNameToPatch = "DELAY WEED MM"; 
	const sequenceNameToRun = `WEED ${pondName}`; 
	
	try {
		console.log(`[ACTION] เริ่มกระบวนการให้ปุ๋ยสำหรับ '${pondName}'`);
		console.log(
		`[ACTION] กำลังจะแก้ไข '${sequenceNameToPatch}' ให้มี delay = ${delay}ms`
		);
		
		const allSequences = await farmBotApiGet("/api/sequences");
		
		// ค้นหาซีเควนซ์ที่จะ "แก้ไข" (DELAY WEED MM)
		const sequenceToPatch = allSequences.find(
		(s) => s.name === sequenceNameToPatch
		);
		if (!sequenceToPatch) {
			console.error(
			`[ERROR] ไม่พบซีเควนซ์สำหรับแก้ไขชื่อ '${sequenceNameToPatch}'.`
			);
			return res
			.status(404)
			.json({ error: `ไม่พบซีเควนซ์ '${sequenceNameToPatch}'` });
		}
		
		// ค้นหาซีเควนซ์ที่จะ "สั่งรัน" (WEED Pond X)
		const sequenceToRun = allSequences.find(
		(s) => s.name === sequenceNameToRun
		);
		if (!sequenceToRun) {
			console.error(
			`[ERROR] ไม่พบซีเควนซ์สำหรับสั่งรันชื่อ '${sequenceNameToRun}'.`
			);
			return res
			.status(404)
			.json({ error: `ไม่พบซีเควนซ์ '${sequenceNameToRun}'` });
		}
		
		// === จุดแก้ไขที่ 2: แก้ไขเฉพาะซีเควนซ์ DELAY WEED MM ===
		// สร้าง body ใหม่สำหรับซีเควนซ์ DELAY WEED MM ซึ่งมีแค่ step 'wait' อันเดียว
		const newBody = [
		{
			kind: "wait",
			args: {
				milliseconds: parseInt(delay, 10),
			},
		},
		];
		
		// (PATCH) ส่งข้อมูล body ที่แก้ไขแล้วกลับไปอัปเดตที่ FarmBot API
		await farmBotApiPatch(`/api/sequences/${sequenceToPatch.id}`, {
			name: sequenceToPatch.name,
			body: newBody,
		});
		console.log(`[SUCCESS] แก้ไขซีเควนซ์ '${sequenceNameToPatch}' สำเร็จ`);
		
		// (EXECUTE) สั่งรันซีเควนซ์ "WEED Pond X" ซึ่งจะไปเรียกตัวที่แก้ไขแล้วมาทำงานเอง
		sendCeleryScript({
			kind: "execute",
			args: { sequence_id: sequenceToRun.id },
		});
		console.log(`[SUCCESS] ส่งคำสั่งรันซีเควนซ์ '${sequenceNameToRun}' แล้ว`);
		
		res.json({ message: `ส่งคำสั่งให้ปุ๋ยที่ ${pondName} เรียบร้อย` });
	} catch (error) {
		const errorMessage = error.response
		? JSON.stringify(error.response.data)
		: error.message;
		console.error(
		`[ERROR] เกิดข้อผิดพลาดในกระบวนการให้ปุ๋ยสำหรับ ${pondName}:`,
		errorMessage
		);
		res.status(500).json({ error: "เกิดข้อผิดพลาดที่ไม่คาดคิดบนเซิร์ฟเวอร์" });
	}
});
app.post("/api/sequences/execute/:id", (req, res) => {
	const sequenceId = parseInt(req.params.id, 10);
	if (isNaN(sequenceId)) {
		return res.status(400).json({ error: "Invalid sequence ID." });
	}
	
	let label = null; // <-- จุดแก้ไข: ประกาศตัวแปรไว้นอกสุด และใช้ let
	
	try {
		console.log(`[ACTION] Executing sequence with ID: ${sequenceId}`);
		
		label = sendCeleryScript({
			// <-- จุดแก้ไข: กำหนดค่าให้ตัวแปร (ไม่ต้องใช้ const)
			kind: "execute",
			args: { sequence_id: sequenceId },
		});
		
		if (label) {
			res.json({
				message: `Execution command sent for sequence ID ${sequenceId}.`,
				label: label,
			});
		} else {
			throw new Error("MQTT not ready or failed to send command.");
		}
	} catch (error) {
		// ตอนนี้ catch block สามารถมองเห็นตัวแปร label ได้แล้ว
		console.error(
		`Failed to send execution command for 
		sequence ${sequenceId} (Label: ${label}):`,
		error
		);
		res.status(500).json({ error: "Failed to send execution command." });
	}
});
app.get("/api/peripherals", async (req, res) => {
	try {
		const peripherals = await farmBotApiGet("/api/peripherals");
		const pinStates = mqttStatus?.pins || {};
		const combinedPeripherals = peripherals.map((p) => {
			return {
				id: p.id,
				pin: p.pin,
				label: p.label,
				value: pinStates[p.pin]?.value ?? 0,
			};
		});
		
		res.json(combinedPeripherals);
	} catch (err) {
		res.status(500).json({ error: "Failed to fetch combined peripheral"});
	}
});

// Function to automatically sync sequences on startup
async function syncAllPondSequences() {
	console.log("--- [AUTO-SYNC] Checking for missing pond sequences... ---");
	try {
		const allPoints = await farmBotApiGet("/api/points");
		const allSequences = await farmBotApiGet("/api/sequences");
		
		const templatePoint = allPoints.find((p) => 
		p.name === TEMPLATE_POND_NAME);
		if (!templatePoint) {
			console.log("[AUTO-SYNC] Template point not found, skipping sync.");
			return;
		}
		
		const templateSequences = allSequences.filter((s) =>
		s.name.endsWith(` ${TEMPLATE_POND_NAME}`)
		);
		if (templateSequences.length === 0) {
			console.log("[AUTO-SYNC] No template sequences found, skipping sync.");
			return;
		}
		
		const targetPonds = allPoints.filter((p) => /^Pond \d+$/i.test(p.name));
		let createdCount = 0;
		
		for (const pond of targetPonds) {
			for (const templateSeq of templateSequences) {
				const newSeqName = templateSeq.name.replace(
				TEMPLATE_POND_NAME,
				pond.name.trim()
				);
				
				if (allSequences.some((s) => s.name === newSeqName)) {
					continue;
				}
				
				console.log(`[AUTO-SYNC] Creating missing sequence: '${newSeqName}'`);
				
				const newBody = JSON.parse(JSON.stringify(templateSeq.body));
				
				const replacePointerId = (steps, oldId, newId) => {
					if (!steps || !Array.isArray(steps)) return;
					steps.forEach((step) => {
						if (step.args?.axis_operand?.args?.pointer_id === oldId) {
							step.args.axis_operand.args.pointer_id = newId;
						}
						if (step.body) {
							replacePointerId(step.body, oldId, newId);
						}
					});
				};
				
				replacePointerId(newBody, templatePoint.id, pond.id);
				
				await farmBotApiPost("/api/sequences", {
					name: newSeqName,
					color: templateSeq.color,
					folder_id: templateSeq.folder_id,
					args: templateSeq.args,
					body: newBody,
				});
				createdCount++;
			}
		}
		
		if (createdCount > 0) {
			console.log(
			`[AUTO-SYNC] Complete. Created ${createdCount} new sequences.`
			);
		} else {
			console.log("[AUTO-SYNC] All sequences are already up to date.");
		}
	} catch (error) {
		console.error(
		"[AUTO-SYNC ERROR] Failed to sync sequences:",
		error.message
		);
	}
}

async function main() {
	await connectMQTT();
	await syncAllPondSequences();
	const fiveMinutes = 5 * 60 * 1000;
	setInterval(syncAllPondSequences, fiveMinutes);
	console.log("- การเริ่มต้นระบบหลักเสร็จสมบูรณ์");
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () =>
console.log(` Server Starting At http://localhost:${PORT}`)
);

main();

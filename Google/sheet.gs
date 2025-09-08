function sheetToJSON(sheet) {
	if (!sheet) return [];
	var values = sheet.getDataRange().getValues();
	if (values.length <= 1) return [];
	var headers = values[0];
	var data = [];
	for (var i = 1; i < values.length; i++) {
		var rowData = {};
		for (var j = 0; j < headers.length; j++) {
			if (headers[j]) {
				rowData[headers[j]] = values[i][j];
			}
		}
		data.push(rowData);
	}
	return data;
}

function doGet(e) {
	var ss = SpreadsheetApp.getActiveSpreadsheet();
	if (e.parameter.lux || e.parameter.tds) {
		if (e.parameter.tds) {
			ss.getSheetByName("Pond").appendRow([new Date(), Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "HH:mm:ss"), e.parameter.pond, e.parameter.x, e.parameter.y, e.parameter.temp, e.parameter.ph, e.parameter.tds]);
			return ContentService.createTextOutput("Success (Pond)");
		} else {
			ss.getSheetByName("Greenhouse").appendRow([new Date(), Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "HH:mm:ss"), e.parameter.temp_dht, e.parameter.humidity, e.parameter.lux]);
			return ContentService.createTextOutput("Success (Greenhouse)");
		}
	}
	var pondSheet = ss.getSheetByName("Pond");
	var greenhouseSheet = ss.getSheetByName("Greenhouse");
	var greenhouseValues = greenhouseSheet.getDataRange().getValues();
	var greenhouseData = [];
	var latestGreenhouse = greenhouseValues[greenhouseValues.length - 1];
	greenhouseData.push({ time: latestGreenhouse[1], tempDht: latestGreenhouse[2], humidity: latestGreenhouse[3], lux: latestGreenhouse[4] });
	var pondValues = pondSheet.getDataRange().getValues();
	var pondData = [];
	if (pondValues.length > 1) {
		var pondNameColumn = pondSheet.getRange("C2:C" + pondSheet.getLastRow()).getValues();
		var uniquePondNames = [...new Set(pondNameColumn.flat())].filter(name => name); 
		uniquePondNames.forEach(function(name) {
			for (var i = pondValues.length - 1; i >= 1; i--) {
				if (pondValues[i][2] === name) {
					pondData.push({ pondName: name, pondTime: pondValues[i][1], pondTemp: pondValues[i][5], pondPh: pondValues[i][6], pondTds: pondValues[i][7] });
					break;
				}
			}
		});
	}
	var allSheets = ss.getSheets();
	var allSheetsData = {};
	allSheets.forEach(function(sheet) {
		allSheetsData[sheet.getName()] = sheetToJSON(sheet);
	});
	var result = {
		pondData: pondData,            
		greenhouseData: greenhouseData,  
		allSheetsData: allSheetsData     
	};
	
	return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON);
}

function doGet_AllData(e) {
	var ss = SpreadsheetApp.getActiveSpreadsheet();
	var sheets = ss.getSheets();
	var allData = {};
	
	sheets.forEach(function(sheet) {
		var sheetName = sheet.getName();
		var values = sheet.getDataRange().getValues();
		if (values.length <= 1) {
			allData[sheetName] = [];
			return;
		}
		var headers = values[0];
		var data = [];
		for (var i = 1; i < values.length; i++) {
			var rowData = {};
			for (var j = 0; j < headers.length; j++) {
				if (headers[j]) {
					rowData[headers[j]] = values[i][j];
				}
			}
			data.push(rowData);
		}
		allData[sheetName] = data;
	});
	
	return ContentService.createTextOutput(JSON.stringify(allData))
	.setMimeType(ContentService.MimeType.JSON);
}

function fixTimeColumn() {
	const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Pond");
	const timeRange = sheet.getRange("B2:B" + sheet.getLastRow());
	const values = timeRange.getValues();
	const fixed = values.map(([val]) => {
		if (typeof val === "string" && val.includes(":")) {
			return [new Date("2000-01-01T" + val)];
		}
		return [val];
	});
	timeRange.setValues(fixed);
}

function createAllPondSheets() {
	const ss = SpreadsheetApp.getActiveSpreadsheet();
	const archiveSheet = ss.getSheetByName("Pond_Archive");
	
	if (!archiveSheet) {
		Logger.log("???????????? Pond_Archive");
		return;
	}
	const data = archiveSheet.getDataRange().getValues();
	
	if (data.length < 2) {
		Logger.log("Pond_Archive ??????????????");
		return;
	}
	
	const headers = data[0];
	const rows = data.slice(1);
	const pondDataMap = new Map();
	
	rows.forEach(row => {
		const pondName = String(row[2]); 
		if (pondName && pondName !== "undefined" && pondName.trim() !== "") { 
			if (!pondDataMap.has(pondName)) {
				pondDataMap.set(pondName, [headers]);
			}
			pondDataMap.get(pondName).push(row);
		}
	});
	pondDataMap.forEach((pondRows, pondName) => {
		let sheetName = pondName + " Archive";
		let sheet = ss.getSheetByName(sheetName);
		
		if (sheet) {
			sheet.clearContents(); 
		} else {
			sheet = ss.insertSheet(sheetName);
		}
		
		if (pondRows.length > 0) {
			sheet.getRange(1, 1, pondRows.length, pondRows[0].length).setValues(pondRows);
		}
	});
	Logger.log("??????????? Pond ??????????!");
}

function averageHourlyOnly() {
	const ss = SpreadsheetApp.getActiveSpreadsheet();
	const sourceSheet = ss.getSheetByName("Pond");
	const archiveSheet = ss.getSheetByName("Pond_Archive");
	const timezone = ss.getSpreadsheetTimeZone();
	
	const data = sourceSheet.getDataRange().getValues();
	if (data.length <= 1) return;
	const headers = data[0];
	const rows = data.slice(1);
	let summary = {};
	rows.forEach(row => {
		let [date, time, pond, , , temp, ph, tds] = row;
		let dateObj = null;
		if (date && typeof date === "object" && typeof date.getFullYear === "function") {
			dateObj = new Date(date.getTime());
		} else if (typeof date === "string") {
			let m = date.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
			if (m) {
				dateObj = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
			} else if (!isNaN(Date.parse(date))) {
				dateObj = new Date(Date.parse(date));
			}
		}
		if (!dateObj || isNaN(dateObj.getTime())) return;
		
		const dateStr = Utilities.formatDate(dateObj, timezone, "yyyy-MM-dd");
		let hour = 0;
		if (time && typeof time === "object" && typeof time.getHours === "function") {
			hour = time.getHours();
		} else if (typeof time === "string" && time.match(/^\d{1,2}:/)) {
			let h = parseInt(time.split(":")[0]);
			if (!isNaN(h)) hour = h;
		}
		const period = ("0" + hour).slice(-2) + ":00–" + ("0" + hour).slice(-2) + ":59";
		const key = `${pond}|${dateStr}|${period}`;
		
		if (!summary[key]) summary[key] = { pond, dateStr, period, tempSum: 0, phSum: 0, tdsSum: 0, count: 0 };
		summary[key].tempSum += Number(temp);
		summary[key].phSum += Number(ph);
		summary[key].tdsSum += Number(tds);
		summary[key].count++;
	});
	
	const archiveData = archiveSheet.getDataRange().getValues();
	if (archiveData.length < 1) return;
	const archiveHeaders = archiveData[0];
	const archiveRows = archiveData.slice(1);
	
	let archiveMap = {}; 
	archiveRows.forEach((row, idx) => {
		let [archDate, archPeriod, archPond] = row;
		let dateObj = (archDate && typeof archDate === "object" && typeof archDate.getFullYear === "function")
		? archDate
		: new Date(archDate);
		let dateStr = Utilities.formatDate(dateObj, timezone, "yyyy-MM-dd");
		let h = 0;
		if (archPeriod && archPeriod.match(/^\d{1,2}:/)) h = parseInt(archPeriod.split(":")[0]);
		let period = ("0" + h).slice(-2) + ":00–" + ("0" + h).slice(-2) + ":59";
		const key = `${archPond}|${dateStr}|${period}`;
		archiveMap[key] = { index: idx + 2, row }; 
	});
	
	Object.values(summary).forEach(s => {
		const avgTemp = (s.tempSum / s.count).toFixed(2);
		const avgPh = (s.phSum / s.count).toFixed(2);
		const avgTds = Math.round(s.tdsSum / s.count);
		const newRow = [s.dateStr, s.period, s.pond, avgTemp, avgPh, avgTds];
		
		const key = `${s.pond}|${s.dateStr}|${s.period}`;
		if (archiveMap[key]) {
			archiveSheet.getRange(archiveMap[key].index, 1, 1, newRow.length).setValues([newRow]);
		} else {
			archiveSheet.appendRow(newRow);
		}
	});
	Logger.log("? Updated only new/changed rows");
}

function averageHourlyGreenhouse() {
	const ss = SpreadsheetApp.getActiveSpreadsheet();
	const sourceSheet = ss.getSheetByName("Greenhouse");
	const archiveSheetName = "Greenhouse_Archive";
	let archiveSheet = ss.getSheetByName(archiveSheetName);
	
	if (!sourceSheet) {
		SpreadsheetApp.getUi().alert("???????? Greenhouse");
		return;
	}
	if (!archiveSheet) {
		archiveSheet = ss.insertSheet(archiveSheetName);
		archiveSheet.appendRow(["Date", "Period", "Avg Temp_DHT", "Avg Humidity", "Avg Lux"]);
	}
	const timezone = ss.getSpreadsheetTimeZone();
	const data = sourceSheet.getDataRange().getValues();
	if (data.length <= 1) return;
	const headers = data[0];
	const rows = data.slice(1);
	
	let summary = {};
	rows.forEach(row => {
		let [date, time, temp, humidity, lux] = row;
		// Date robust
		let dateObj = null;
		if (date && typeof date === "object" && typeof date.getFullYear === "function") {
			dateObj = new Date(date.getTime());
		} else if (typeof date === "string") {
			if (!isNaN(Date.parse(date))) {
				dateObj = new Date(Date.parse(date));
			}
		}
		if (!dateObj || isNaN(dateObj.getTime())) return;
		const dateStr = Utilities.formatDate(dateObj, timezone, "yyyy-MM-dd");
		
		let hour = 0;
		if (time && typeof time === "object" && typeof time.getHours === "function") {
			hour = time.getHours();
		} else if (typeof time === "string" && time.match(/^\d{1,2}:/)) {
			let h = parseInt(time.split(":")[0]);
			if (!isNaN(h)) hour = h;
		}
		const period = ("0" + hour).slice(-2) + ":00–" + ("0" + hour).slice(-2) + ":59";
		const key = `${dateStr}|${period}`;
		
		if (!summary[key]) summary[key] = { dateStr, period, tempSum: 0, humiditySum: 0, luxSum: 0, count: 0 };
		summary[key].tempSum += Number(temp);
		summary[key].humiditySum += Number(humidity);
		summary[key].luxSum += Number(lux);
		summary[key].count++;
	});
	
	const archiveData = archiveSheet.getDataRange().getValues();
	if (archiveData.length < 1) return;
	const archiveHeaders = archiveData[0];
	const archiveRows = archiveData.slice(1);
	
	let archiveMap = {}; // key -> {index, row}
	archiveRows.forEach((row, idx) => {
		let [archDate, archPeriod] = row;
		let dateObj = (archDate && typeof archDate === "object" && typeof archDate.getFullYear === "function")
		? archDate
		: new Date(archDate);
		let dateStr = Utilities.formatDate(dateObj, timezone, "yyyy-MM-dd");
		let h = 0;
		if (archPeriod && archPeriod.match(/^\d{1,2}:/)) h = parseInt(archPeriod.split(":")[0]);
		let period = ("0" + h).slice(-2) + ":00–" + ("0" + h).slice(-2) + ":59";
		const key = `${dateStr}|${period}`;
		archiveMap[key] = { index: idx + 2, row };
	});
	
	Object.values(summary).forEach(s => {
		const avgTemp = (s.tempSum / s.count).toFixed(2);
		const avgHumidity = (s.humiditySum / s.count).toFixed(2);
		const avgLux = Math.round(s.luxSum / s.count);
		const newRow = [s.dateStr, s.period, avgTemp, avgHumidity, avgLux];
		
		const key = `${s.dateStr}|${s.period}`;
		if (archiveMap[key]) {
			archiveSheet.getRange(archiveMap[key].index, 1, 1, newRow.length).setValues([newRow]);
		} else {
			archiveSheet.appendRow(newRow);
		}
	});
	Logger.log("? Updated only new/changed rows for Greenhouse_Archive.");
}

function sendLineLastHourOnly() {
	const now = new Date();
	const minute = now.getMinutes();
	const hour = now.getHours();
	if (!(hour % 4 === 0 && minute >= 5 && minute <= 8)) {
		Logger.log(`Current time is ${hour}:${minute}. Not within the 5-8 minute window of every 4 hours. Skipping execution.`);
		return;
	}
	
	const ss = SpreadsheetApp.getActiveSpreadsheet();
	const timezone = ss.getSpreadsheetTimeZone();
	const pondArchiveSheet = ss.getSheetByName("Pond_Archive");
	const greenhouseArchiveSheet = ss.getSheetByName("Greenhouse_Archive");
	
	const target = new Date(now.getTime() - 60 * 60000);
	const targetHour = target.getHours();
	const targetDateStr = Utilities.formatDate(target, timezone, "yyyy-MM-dd");
	const targetPeriodStr = `${("0" + targetHour).slice(-2)}:00–${("0" + targetHour).slice(-2)}:59`;
	
	let pond_rows = [];
	if (pondArchiveSheet) {
		const pondData = pondArchiveSheet.getDataRange().getValues().slice(1);
		pond_rows = pondData.filter(row => {
			const rowDate = row[0], rowPeriod = row[1];
			if (!rowDate || !rowPeriod) return false;
			let rowDateStr = (typeof rowDate.getFullYear === 'function') ? Utilities.formatDate(rowDate, timezone, "yyyy-MM-dd") : rowDate.toString();
			return (rowDateStr === targetDateStr && rowPeriod.toString() === targetPeriodStr);
		});
	}
	
	let greenhouse_row = null;
	if (greenhouseArchiveSheet) {
		const greenhouseData = greenhouseArchiveSheet.getDataRange().getValues().slice(1);
		greenhouse_row = greenhouseData.find(row => {
			const rowDate = row[0], rowPeriod = row[1];
			if (!rowDate || !rowPeriod) return false;
			let rowDateStr = (typeof rowDate.getFullYear === 'function') ? Utilities.formatDate(rowDate, timezone, "yyyy-MM-dd") : rowDate.toString();
			return (rowDateStr === targetDateStr && rowPeriod.toString() === targetPeriodStr);
		});
	}
	
	if (pond_rows.length === 0 && !greenhouse_row) {
		return;
	}
	
	const reportDate = Utilities.formatDate(target, timezone, "dd/MM/yyyy");
	const reportTime = `${targetPeriodStr.replace("–", " - ")} ?.`;
	
	let message = `*?? ??????????????????????*\n`;
	message += `*??????:* ${reportDate}\n`;
	message += `*????:* ${reportTime}\n`;
	message += `- - - - - - - - - - - - - -\n\n`;
	
	if (greenhouse_row) {
		const [, , ghTemp, ghHumidity, ghLux] = greenhouse_row;
		message += `*? ?????????????*\n`;
		message += `   ??? ???????? : *${ghTemp} °C*\n`;
		message += `   ?? ????????   : *${ghHumidity} %*\n`;
		message += `   ?? ????????  : *${ghLux} lux*\n\n`;
	}
	
	if (pond_rows.length > 0) {
		message += `*? ??????????????*\n`;
		const labelLength = 11;
		const tempLabel = "??? ????????".padEnd(labelLength, ' ');
		const phLabel   = "?? ??? pH".padEnd(labelLength, ' ');
		const tdsLabel  = "?? ??? TDS".padEnd(labelLength, ' ');
		pond_rows.forEach((row) => {
			const [, , pond, temp, ph, tds] = row;
			message += `   \n   *› ${pond}*\n`;
			message += `       ${tempLabel}: ${temp} °C\n`;
			message += `       ${phLabel}: ${ph}\n`;
			message += `       ${tdsLabel}: ${tds} ppm\n`;
		});
	}
	sendLine(message.trim());
	Logger.log("Final-Final briefing-style message sent successfully for period " + targetPeriodStr);
}

function testSendLineFunction() {
	const testMessage = "Hello from Google Apps Script! (???????????????)";
	sendLine(testMessage);
	Logger.log("Test message sent to sendLine function.");
}

function sendLine(message) {
	const TOKEN = "KEqDNahL7R2Vth1n3lIEAWkzBkK5YXD/Tj+3KVFGdzLUC1ZnvW6mjtQzVcFTecT1VC1LxwGJ4dr5fwhi2qbDhvwbRJpocZM/kiuL2gqCP7b3FcTCm4TrS7j5V5TKeH24L1uAPjRgd9wyP8cMxOLl9AdB04t89/1O/w1cDnyilFU="; // Your LINE Channel Access Token
	const GROUP_ID = "C91923477490d6992af138a008c6b983b"; // Your LINE Group ID or User ID
	
	const url = "https://api.line.me/v2/bot/message/push";
	const payload = {
		to: GROUP_ID,
		messages: [{ type: "text", text: message }]
	};
	
	const options = {
		method: "post",
		contentType: "application/json",
		headers: { Authorization: `Bearer ${TOKEN}` },
		payload: JSON.stringify(payload),
		muteHttpExceptions: false
	};
	
	try {
		const response = UrlFetchApp.fetch(url, options);
		Logger.log("LINE API Response: " + response.getContentText());
	} catch (e) {
		Logger.log("Error sending LINE message: " + e.toString());
	}
}

function clearGreenhouseDataSheetDaily() {
	const sheetName = "Greenhouse";
	const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
	const sheet = spreadsheet.getSheetByName(sheetName);
	
	if (sheet) {
		const lastRow = sheet.getLastRow();
		if (lastRow > 1) {
			sheet.deleteRows(2, lastRow - 1);
			Logger.log(`Cleared data in sheet: ${sheetName}`);
		} else {
			Logger.log(`Sheet: ${sheetName} has no data to clear.`);
		}
	} else {
		Logger.log(`Sheet: ${sheetName} not found.`);
	}
}

function clearPondDataSheetDaily() {
	const sheetName = "Pond"; 
	const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
	const sheet = spreadsheet.getSheetByName(sheetName);
	
	if (sheet) {
		const lastRow = sheet.getLastRow();
		if (lastRow > 1) {
			sheet.deleteRows(2, lastRow - 1);
			Logger.log(`Cleared data in sheet: ${sheetName}`);
		} else {
			Logger.log(`Sheet: ${sheetName} has no data to clear.`);
		}
	} else {
		Logger.log(`Sheet: ${sheetName} not found.`);
	}
}
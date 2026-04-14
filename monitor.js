import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import { log, LOG_DIR } from "./logger.js";
import { notify } from "./notify.js";

// Config
const CHECK_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes
const LOW_SPACE_THRESHOLD_GB = 20;
const CRITICAL_SPACE_THRESHOLD_GB = 10;
const STATE_FILE = path.join(LOG_DIR, "monitor-state.json");

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf-8"));
  } catch {
    return { lastAlerts: {}, lastReport: null };
  }
}

function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function getDriveInfo() {
  const raw = execSync(
    'powershell -NoProfile -Command "Get-PSDrive -PSProvider FileSystem | ForEach-Object { Write-Output (\\\"$($_.Name)|$($_.Used)|$($_.Free)\\\") }"',
    { encoding: "utf-8", timeout: 15000 }
  );
  return raw.trim().split("\n").map((line) => {
    const [name, used, free] = line.trim().split("|");
    const usedGB = parseInt(used || "0") / (1024 ** 3);
    const freeGB = parseInt(free || "0") / (1024 ** 3);
    const totalGB = usedGB + freeGB;
    const pct = totalGB > 0 ? (usedGB / totalGB) * 100 : 0;
    return { name, usedGB, freeGB, totalGB, pct };
  });
}

function checkDrives(state) {
  const drives = getDriveInfo();
  const now = Date.now();

  for (const drive of drives) {
    if (drive.totalGB < 1) continue; // skip tiny/virtual drives

    const lastAlert = state.lastAlerts[drive.name] || 0;
    const hoursSinceAlert = (now - lastAlert) / (1000 * 60 * 60);

    if (drive.freeGB < CRITICAL_SPACE_THRESHOLD_GB && hoursSinceAlert > 1) {
      notify(
        "CRITICAL: Low Disk Space",
        `${drive.name}: drive has only ${drive.freeGB.toFixed(1)}GB free! (${drive.pct.toFixed(0)}% full)`
      );
      log(`CRITICAL ALERT: ${drive.name}: only ${drive.freeGB.toFixed(1)}GB free`);
      state.lastAlerts[drive.name] = now;
    } else if (drive.freeGB < LOW_SPACE_THRESHOLD_GB && hoursSinceAlert > 4) {
      notify(
        "Low Disk Space Warning",
        `${drive.name}: drive has ${drive.freeGB.toFixed(1)}GB free (${drive.pct.toFixed(0)}% full)`
      );
      log(`WARNING: ${drive.name}: ${drive.freeGB.toFixed(1)}GB free`);
      state.lastAlerts[drive.name] = now;
    }
  }

  return state;
}

function run() {
  log("Storage monitor started.");
  console.log("Storage Monitor running. Checking every 30 minutes.");
  console.log(`Alerts when free space < ${LOW_SPACE_THRESHOLD_GB}GB, critical < ${CRITICAL_SPACE_THRESHOLD_GB}GB`);
  console.log(`Log file: ${LOG_DIR}`);
  console.log("Press Ctrl+C to stop.\n");

  // Initial check
  let state = loadState();
  state = checkDrives(state);
  saveState(state);

  // Schedule recurring checks
  setInterval(() => {
    try {
      state = loadState();
      state = checkDrives(state);
      saveState(state);
    } catch (e) {
      log(`Monitor error: ${e.message}`);
    }
  }, CHECK_INTERVAL_MS);
}

run();

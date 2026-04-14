import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import { log, LOG_DIR } from "./logger.js";
import { notify } from "./notify.js";

// Config
const CHECK_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes
const DAILY_REPORT_HOUR = 9; // send daily status at 9 AM

// Alert tiers: threshold (GB free) → cooldown (hours between alerts)
const ALERT_TIERS = [
  { threshold: 5, cooldownHours: 1, level: "CRITICAL" },
  { threshold: 10, cooldownHours: 4, level: "WARNING" },
  { threshold: 20, cooldownHours: 12, level: "NOTICE" },
];
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

function ps(cmd, timeout = 15000) {
  return execSync(`powershell -NoProfile -Command "${cmd}"`, {
    encoding: "utf-8",
    timeout,
  });
}

function getDriveInfo() {
  const raw = ps(
    "Get-PSDrive -PSProvider FileSystem | ForEach-Object { $n=$_.Name; $u=$_.Used; $f=$_.Free; Write-Output ('{0}|{1}|{2}' -f $n,$u,$f) }"
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

    // Find the most severe matching tier
    const tier = ALERT_TIERS.find((t) => drive.freeGB < t.threshold);
    if (!tier) continue;

    const lastAlert = state.lastAlerts[drive.name] || 0;
    const hoursSinceAlert = (now - lastAlert) / (1000 * 60 * 60);

    if (hoursSinceAlert > tier.cooldownHours) {
      const titles = {
        CRITICAL: "CRITICAL: Disk Almost Full",
        WARNING: "Low Disk Space",
        NOTICE: "Disk Space Getting Low",
      };
      notify(
        titles[tier.level],
        `${drive.name}: ${drive.freeGB.toFixed(1)}GB free (${drive.pct.toFixed(0)}% full)`
      );
      log(`${tier.level}: ${drive.name}: ${drive.freeGB.toFixed(1)}GB free`);
      state.lastAlerts[drive.name] = now;
    }
  }

  return state;
}

function sendDailyReport(state) {
  const now = new Date();
  const today = now.toISOString().slice(0, 10); // "2026-04-14"
  const hour = now.getHours();

  // Only send once per day, at or after the configured hour
  if (state.lastDailyReport === today || hour < DAILY_REPORT_HOUR) return state;

  const drives = getDriveInfo().filter((d) => d.totalGB > 1);
  const lines = drives.map(
    (d) =>
      `${d.name}: ${d.freeGB.toFixed(1)}GB free / ${d.totalGB.toFixed(0)}GB (${d.pct.toFixed(0)}% used)`
  );

  notify("Daily Storage Report", lines.join("\n"));
  log(`Daily report sent: ${lines.join(" | ")}`);
  state.lastDailyReport = today;
  return state;
}

function run() {
  log("Storage monitor started.");
  console.log("Storage Monitor running. Checking every 10 minutes.");
  console.log("Alerts: <5GB every 1h | <10GB every 4h | <20GB every 12h");
  console.log(`Daily status report at ${DAILY_REPORT_HOUR}:00`);
  console.log(`Log file: ${LOG_DIR}`);
  console.log("Press Ctrl+C to stop.\n");

  // Initial check
  let state = loadState();
  state = checkDrives(state);
  state = sendDailyReport(state);
  saveState(state);

  // Schedule recurring checks
  setInterval(() => {
    try {
      state = loadState();
      state = checkDrives(state);
      state = sendDailyReport(state);
      saveState(state);
    } catch (e) {
      log(`Monitor error: ${e.message}`);
    }
  }, CHECK_INTERVAL_MS);
}

run();

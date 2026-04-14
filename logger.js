import fs from "fs";
import path from "path";

const LOG_DIR = path.join(process.env.USERPROFILE || "C:\\Users\\Default", ".storage-manager");
const LOG_FILE = path.join(LOG_DIR, "progress.log");

if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

export function log(message) {
  const timestamp = new Date().toLocaleTimeString("en-US", { hour12: false });
  const line = `[${timestamp}] ${message}\n`;
  fs.appendFileSync(LOG_FILE, line);
}

export function clearLog() {
  fs.writeFileSync(LOG_FILE, "");
}

export function readLog() {
  if (!fs.existsSync(LOG_FILE)) return "No log file found.";
  return fs.readFileSync(LOG_FILE, "utf-8") || "Log is empty.";
}

export { LOG_DIR, LOG_FILE };

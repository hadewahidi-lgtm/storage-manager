import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { log, clearLog, readLog, LOG_FILE } from "./logger.js";
import { notify } from "./notify.js";

const server = new McpServer({ name: "storage-manager", version: "2.0.0" });

// Helper: safe powershell path
function safe(str) {
  return str.replace(/'/g, "''");
}

// Helper: run powershell
function ps(cmd, timeout = 120000) {
  return execSync(`powershell -NoProfile -Command "${cmd}"`, {
    encoding: "utf-8",
    timeout,
  });
}

// ============================================
// CORE TOOLS
// ============================================

// Check disk space on all drives
server.tool("disk_usage", "Check free and total disk space on all drives", {}, async () => {
  log("Checking disk usage on all drives...");
  const result = ps(
    "Get-PSDrive -PSProvider FileSystem | ForEach-Object { $n=$_.Name; $u=[math]::Round($_.Used/1GB,2); $f=[math]::Round($_.Free/1GB,2); $t=[math]::Round(($_.Used+$_.Free)/1GB,2); $p=if($t -gt 0){[math]::Round($u/$t*100,1)}else{0}; Write-Output ('{0}: {1}GB used / {2}GB total ({3}% full, {4}GB free)' -f $n,$u,$t,$p,$f) }",
    15000
  );
  log("Disk usage check complete.");

  // Alert if any drive is above 80%
  const lines = result.trim().split("\n");
  for (const line of lines) {
    const match = line.match(/(\d+\.?\d*)% full/);
    if (match && parseFloat(match[1]) > 80) {
      notify("Low Disk Space", line.trim());
    }
  }

  return { content: [{ type: "text", text: result }] };
});

// Find large files
server.tool(
  "large_files",
  "Find the largest files in a directory (recursive)",
  {
    path: z.string().describe("Directory path to scan"),
    minSizeMB: z.number().default(100).describe("Minimum file size in MB"),
  },
  async ({ path: dirPath, minSizeMB }) => {
    log(`Scanning for files larger than ${minSizeMB}MB in ${dirPath}...`);
    const cmd = `Get-ChildItem -Path '${safe(dirPath)}' -Recurse -File -ErrorAction SilentlyContinue | Where-Object { $_.Length -gt ${minSizeMB * 1024 * 1024} } | Sort-Object Length -Descending | Select-Object -First 25 FullName, @{N='SizeMB';E={[math]::Round($_.Length/1MB,2)}} | Format-Table -AutoSize`;
    const result = ps(cmd);
    log(`Large file scan complete. Found results in ${dirPath}.`);
    return { content: [{ type: "text", text: result || "No files found above that size." }] };
  }
);

// Show folder sizes
server.tool(
  "folder_sizes",
  "Show size of each subfolder in a directory",
  { path: z.string().describe("Directory path to scan") },
  async ({ path: dirPath }) => {
    log(`Calculating folder sizes in ${dirPath}...`);
    const cmd = `Get-ChildItem -Path '${safe(dirPath)}' -Directory -ErrorAction SilentlyContinue | ForEach-Object { $size = (Get-ChildItem $_.FullName -Recurse -File -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum; [PSCustomObject]@{Folder=$_.Name; SizeMB=[math]::Round($size/1MB,2); SizeGB=[math]::Round($size/1GB,2)} } | Sort-Object SizeMB -Descending | Format-Table -AutoSize`;
    const result = ps(cmd);
    log(`Folder size calculation complete for ${dirPath}.`);
    return { content: [{ type: "text", text: result || "No subfolders found." }] };
  }
);

// Temp files
server.tool("temp_files", "Find temporary files that can be cleaned up", {}, async () => {
  log("Scanning temp directories...");
  const tempDirs = [
    process.env.TEMP || "C:\\Users\\Default\\AppData\\Local\\Temp",
    "C:\\Windows\\Temp",
  ];
  let output = "";
  for (const dir of tempDirs) {
    log(`Scanning ${dir}...`);
    try {
      const cmd = `$items = Get-ChildItem -Path '${safe(dir)}' -ErrorAction SilentlyContinue; $totalMB = [math]::Round(($items | Get-ChildItem -Recurse -File -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum/1MB, 2); Write-Output '${dir}: $totalMB MB total'; $items | Sort-Object LastWriteTime | Select-Object -First 10 Name, @{N='SizeMB';E={[math]::Round($_.Length/1MB,2)}}, LastWriteTime | Format-Table -AutoSize`;
      output += ps(cmd, 30000) + "\n";
    } catch {
      output += `Could not scan ${dir}\n`;
    }
  }
  log("Temp file scan complete.");
  return { content: [{ type: "text", text: output }] };
});

// Delete a file
server.tool(
  "delete_file",
  "Delete a specific file from the filesystem",
  { filePath: z.string().describe("Full path to the file to delete") },
  async ({ filePath }) => {
    if (!fs.existsSync(filePath)) {
      return { content: [{ type: "text", text: `File not found: ${filePath}` }] };
    }
    const stats = fs.statSync(filePath);
    const sizeMB = (stats.size / (1024 * 1024)).toFixed(2);
    fs.unlinkSync(filePath);
    log(`Deleted file: ${filePath} (${sizeMB} MB)`);
    notify("File Deleted", `${path.basename(filePath)} — ${sizeMB} MB freed`);
    return { content: [{ type: "text", text: `Deleted: ${filePath} (${sizeMB} MB freed)` }] };
  }
);

// Delete a folder
server.tool(
  "delete_folder",
  "Delete a folder and all its contents",
  { folderPath: z.string().describe("Full path to the folder to delete") },
  async ({ folderPath }) => {
    if (!fs.existsSync(folderPath)) {
      return { content: [{ type: "text", text: `Folder not found: ${folderPath}` }] };
    }
    log(`Calculating size of ${folderPath}...`);
    let sizeMB = 0;
    try {
      const bytes = ps(`(Get-ChildItem '${safe(folderPath)}' -Recurse -File -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum`, 30000).trim();
      sizeMB = (parseInt(bytes) / (1024 * 1024)).toFixed(2);
    } catch {}
    fs.rmSync(folderPath, { recursive: true, force: true });
    log(`Deleted folder: ${folderPath} (~${sizeMB} MB)`);
    notify("Folder Deleted", `${path.basename(folderPath)} — ~${sizeMB} MB freed`);
    return { content: [{ type: "text", text: `Deleted folder: ${folderPath} (~${sizeMB} MB freed)` }] };
  }
);

// Recycle bin
server.tool("recycle_bin", "Check recycle bin size and optionally empty it", {
  empty: z.boolean().default(false).describe("Set to true to empty the recycle bin"),
}, async ({ empty }) => {
  if (empty) {
    log("Emptying recycle bin...");
    ps("Clear-RecycleBin -Force -ErrorAction SilentlyContinue", 30000);
    log("Recycle bin emptied.");
    notify("Recycle Bin", "Recycle bin has been emptied");
    return { content: [{ type: "text", text: "Recycle bin emptied." }] };
  }
  const result = ps("$shell = New-Object -ComObject Shell.Application; $bin = $shell.NameSpace(10); $count = $bin.Items().Count; Write-Output ('Recycle Bin: ' + $count + ' items. Use empty:true to clear.')", 15000);
  return { content: [{ type: "text", text: result }] };
});

// ============================================
// NEW TOOLS
// ============================================

// File type breakdown
server.tool(
  "file_type_breakdown",
  "Show disk usage broken down by file type in a directory",
  { path: z.string().describe("Directory path to scan") },
  async ({ path: dirPath }) => {
    log(`Analyzing file types in ${dirPath}...`);
    const cmd = `Get-ChildItem -Path '${safe(dirPath)}' -Recurse -File -ErrorAction SilentlyContinue | Group-Object Extension | ForEach-Object { [PSCustomObject]@{Extension=if($_.Name){'$($_.Name)'}else{'(no ext)'}; Count=$_.Count; SizeMB=[math]::Round(($_.Group | Measure-Object Length -Sum).Sum/1MB,2)} } | Sort-Object SizeMB -Descending | Select-Object -First 25 | Format-Table -AutoSize`;
    const result = ps(cmd);
    log(`File type analysis complete for ${dirPath}.`);
    return { content: [{ type: "text", text: result || "No files found." }] };
  }
);

// Duplicate file finder
server.tool(
  "duplicate_files",
  "Find duplicate files by size and hash in a directory",
  {
    path: z.string().describe("Directory path to scan"),
    minSizeMB: z.number().default(1).describe("Minimum file size in MB to check"),
  },
  async ({ path: dirPath, minSizeMB }) => {
    log(`Scanning for duplicate files in ${dirPath} (min ${minSizeMB}MB)...`);

    // Step 1: group files by size
    log("Step 1/2: Grouping files by size...");
    const cmd = `Get-ChildItem -Path '${safe(dirPath)}' -Recurse -File -ErrorAction SilentlyContinue | Where-Object { $_.Length -gt ${minSizeMB * 1024 * 1024} } | Select-Object FullName, Length | ConvertTo-Json -Depth 3`;
    let rawFiles;
    try {
      rawFiles = ps(cmd, 180000);
    } catch {
      return { content: [{ type: "text", text: "Scan timed out. Try a smaller directory or higher minSizeMB." }] };
    }

    let files;
    try {
      const parsed = JSON.parse(rawFiles);
      files = Array.isArray(parsed) ? parsed : [parsed];
    } catch {
      return { content: [{ type: "text", text: "No files found matching criteria." }] };
    }

    // Group by size
    const bySize = {};
    for (const f of files) {
      const key = f.Length;
      if (!bySize[key]) bySize[key] = [];
      bySize[key].push(f.FullName);
    }

    // Step 2: hash files with same size
    log("Step 2/2: Hashing files with matching sizes...");
    const duplicates = [];
    let checked = 0;
    for (const [size, paths] of Object.entries(bySize)) {
      if (paths.length < 2) continue;
      const hashes = {};
      for (const p of paths) {
        try {
          const hash = crypto.createHash("md5");
          const buf = fs.readFileSync(p);
          hash.update(buf);
          const digest = hash.digest("hex");
          if (!hashes[digest]) hashes[digest] = [];
          hashes[digest].push(p);
        } catch {}
        checked++;
        if (checked % 20 === 0) log(`Hashed ${checked} files...`);
      }
      for (const [hash, dupPaths] of Object.entries(hashes)) {
        if (dupPaths.length > 1) {
          const sizeMB = (parseInt(size) / (1024 * 1024)).toFixed(2);
          duplicates.push({ sizeMB, count: dupPaths.length, files: dupPaths });
        }
      }
    }

    if (duplicates.length === 0) {
      log("No duplicates found.");
      return { content: [{ type: "text", text: "No duplicate files found." }] };
    }

    duplicates.sort((a, b) => parseFloat(b.sizeMB) - parseFloat(a.sizeMB));
    let output = `Found ${duplicates.length} sets of duplicates:\n\n`;
    let totalWaste = 0;
    for (const dup of duplicates.slice(0, 20)) {
      const waste = parseFloat(dup.sizeMB) * (dup.count - 1);
      totalWaste += waste;
      output += `--- ${dup.sizeMB} MB each (${dup.count} copies, ${waste.toFixed(2)} MB wasted) ---\n`;
      for (const f of dup.files) output += `  ${f}\n`;
      output += "\n";
    }
    output += `\nTotal reclaimable: ~${totalWaste.toFixed(2)} MB`;
    log(`Found ${duplicates.length} duplicate sets. ~${totalWaste.toFixed(2)} MB reclaimable.`);
    notify("Duplicates Found", `${duplicates.length} sets, ~${totalWaste.toFixed(2)} MB reclaimable`);
    return { content: [{ type: "text", text: output }] };
  }
);

// Old downloads finder
server.tool(
  "old_downloads",
  "Find old files in the Downloads folder",
  {
    olderThanDays: z.number().default(30).describe("Files older than this many days"),
  },
  async ({ olderThanDays }) => {
    const downloadsPath = path.join(process.env.USERPROFILE || "", "Downloads");
    log(`Scanning Downloads folder for files older than ${olderThanDays} days...`);
    const cmd = `Get-ChildItem -Path '${safe(downloadsPath)}' -File -ErrorAction SilentlyContinue | Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-${olderThanDays}) } | Sort-Object Length -Descending | Select-Object FullName, @{N='SizeMB';E={[math]::Round($_.Length/1MB,2)}}, @{N='DaysOld';E={[math]::Round(((Get-Date) - $_.LastWriteTime).TotalDays)}} | Format-Table -AutoSize`;
    const result = ps(cmd, 30000);
    log("Downloads scan complete.");
    return { content: [{ type: "text", text: result || "No old files found in Downloads." }] };
  }
);

// Node modules scanner
server.tool(
  "node_modules_scanner",
  "Find all node_modules folders and their sizes",
  {
    path: z.string().default("C:\\").describe("Root path to scan from"),
  },
  async ({ path: dirPath }) => {
    log(`Scanning for node_modules folders in ${dirPath}...`);
    const cmd = `Get-ChildItem -Path '${safe(dirPath)}' -Directory -Filter 'node_modules' -Recurse -Depth 5 -ErrorAction SilentlyContinue | ForEach-Object { $size = (Get-ChildItem $_.FullName -Recurse -File -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum; [PSCustomObject]@{Path=$_.FullName; SizeMB=[math]::Round($size/1MB,2)} } | Sort-Object SizeMB -Descending | Format-Table -AutoSize`;
    const result = ps(cmd, 300000);
    log("Node modules scan complete.");
    return { content: [{ type: "text", text: result || "No node_modules folders found." }] };
  }
);

// Windows cache cleanup
server.tool(
  "windows_cache_cleanup",
  "Find and optionally clean Windows caches (update cache, installer cache, thumbnail cache)",
  {
    clean: z.boolean().default(false).describe("Set to true to actually delete the caches"),
  },
  async ({ clean }) => {
    const caches = [
      { name: "Windows Update Cache", path: "C:\\Windows\\SoftwareDistribution\\Download" },
      { name: "Windows Installer Cache", path: "C:\\Windows\\Installer\\$PatchCache$" },
      { name: "Thumbnail Cache", path: path.join(process.env.LOCALAPPDATA || "", "Microsoft\\Windows\\Explorer") },
      { name: "Windows Temp", path: "C:\\Windows\\Temp" },
      { name: "User Temp", path: process.env.TEMP || "" },
    ];

    let output = "";
    let totalMB = 0;
    for (const cache of caches) {
      if (!cache.path || !fs.existsSync(cache.path)) {
        output += `${cache.name}: not found\n`;
        continue;
      }
      log(`Checking ${cache.name}...`);
      try {
        const bytes = ps(`(Get-ChildItem '${safe(cache.path)}' -Recurse -File -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum`, 30000).trim();
        const mb = (parseInt(bytes || "0") / (1024 * 1024)).toFixed(2);
        totalMB += parseFloat(mb);
        output += `${cache.name}: ${mb} MB — ${cache.path}\n`;

        if (clean) {
          log(`Cleaning ${cache.name}...`);
          try {
            ps(`Get-ChildItem '${safe(cache.path)}' -Recurse -File -ErrorAction SilentlyContinue | Remove-Item -Force -ErrorAction SilentlyContinue`, 60000);
            output += `  -> Cleaned!\n`;
          } catch {
            output += `  -> Some files could not be removed (in use)\n`;
          }
        }
      } catch {
        output += `${cache.name}: could not scan\n`;
      }
    }
    output += `\nTotal cache size: ~${totalMB.toFixed(2)} MB`;
    if (!clean) output += "\nSet clean: true to clear these caches.";
    log(`Cache scan complete. Total: ~${totalMB.toFixed(2)} MB`);
    return { content: [{ type: "text", text: output }] };
  }
);

// Installed programs by size
server.tool(
  "large_programs",
  "List installed programs sorted by size",
  {},
  async () => {
    log("Fetching installed programs...");
    const cmd = `Get-ItemProperty HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*, HKLM:\\Software\\Wow6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\* -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -and $_.EstimatedSize } | Select-Object @{N='Program';E={$_.DisplayName}}, @{N='SizeMB';E={[math]::Round($_.EstimatedSize/1024,2)}} | Sort-Object SizeMB -Descending | Select-Object -First 30 | Format-Table -AutoSize`;
    const result = ps(cmd, 30000);
    log("Installed programs list complete.");
    return { content: [{ type: "text", text: result || "Could not retrieve program list." }] };
  }
);

// Browser cache info
server.tool(
  "browser_cache",
  "Check browser cache sizes (Chrome, Edge, Firefox) and optionally clear them",
  {
    clean: z.boolean().default(false).describe("Set to true to delete browser caches"),
  },
  async ({ clean }) => {
    const localApp = process.env.LOCALAPPDATA || "";
    const appData = process.env.APPDATA || "";
    const caches = [
      { name: "Chrome Cache", path: path.join(localApp, "Google\\Chrome\\User Data\\Default\\Cache") },
      { name: "Chrome Code Cache", path: path.join(localApp, "Google\\Chrome\\User Data\\Default\\Code Cache") },
      { name: "Edge Cache", path: path.join(localApp, "Microsoft\\Edge\\User Data\\Default\\Cache") },
      { name: "Edge Code Cache", path: path.join(localApp, "Microsoft\\Edge\\User Data\\Default\\Code Cache") },
      { name: "Firefox Cache", path: path.join(localApp, "Mozilla\\Firefox\\Profiles") },
    ];

    let output = "";
    let totalMB = 0;
    for (const cache of caches) {
      if (!fs.existsSync(cache.path)) {
        output += `${cache.name}: not found\n`;
        continue;
      }
      log(`Checking ${cache.name}...`);
      try {
        const bytes = ps(`(Get-ChildItem '${safe(cache.path)}' -Recurse -File -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum`, 30000).trim();
        const mb = (parseInt(bytes || "0") / (1024 * 1024)).toFixed(2);
        totalMB += parseFloat(mb);
        output += `${cache.name}: ${mb} MB\n`;

        if (clean) {
          log(`Cleaning ${cache.name}...`);
          try {
            ps(`Get-ChildItem '${safe(cache.path)}' -Recurse -File -ErrorAction SilentlyContinue | Remove-Item -Force -ErrorAction SilentlyContinue`, 60000);
            output += `  -> Cleaned!\n`;
          } catch {
            output += `  -> Some files locked (browser may be open)\n`;
          }
        }
      } catch {
        output += `${cache.name}: could not scan\n`;
      }
    }
    output += `\nTotal browser cache: ~${totalMB.toFixed(2)} MB`;
    if (!clean) output += "\nSet clean: true to clear. Close browsers first for best results.";
    log(`Browser cache scan complete. Total: ~${totalMB.toFixed(2)} MB`);
    return { content: [{ type: "text", text: output }] };
  }
);

// Move files to another drive
server.tool(
  "move_to_drive",
  "Move a file or folder to another location (e.g. C: to D:)",
  {
    source: z.string().describe("Source file or folder path"),
    destination: z.string().describe("Destination path"),
  },
  async ({ source, destination }) => {
    if (!fs.existsSync(source)) {
      return { content: [{ type: "text", text: `Source not found: ${source}` }] };
    }
    log(`Moving ${source} -> ${destination}...`);
    const destDir = path.dirname(destination);
    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });
    }
    try {
      ps(`Move-Item -Path '${safe(source)}' -Destination '${safe(destination)}' -Force`, 300000);
      log(`Move complete: ${source} -> ${destination}`);
      notify("File Moved", `${path.basename(source)} moved to ${destination}`);
      return { content: [{ type: "text", text: `Moved: ${source} -> ${destination}` }] };
    } catch (e) {
      return { content: [{ type: "text", text: `Move failed: ${e.message}` }] };
    }
  }
);

// Empty folders finder
server.tool(
  "empty_folders",
  "Find and optionally remove empty folders",
  {
    path: z.string().describe("Directory to scan"),
    clean: z.boolean().default(false).describe("Set to true to delete empty folders"),
  },
  async ({ path: dirPath, clean }) => {
    log(`Scanning for empty folders in ${dirPath}...`);
    const cmd = `Get-ChildItem -Path '${safe(dirPath)}' -Directory -Recurse -ErrorAction SilentlyContinue | Where-Object { (Get-ChildItem $_.FullName -Force -ErrorAction SilentlyContinue).Count -eq 0 } | Select-Object FullName | Format-Table -AutoSize`;
    const result = ps(cmd);

    if (clean && result.trim()) {
      log("Removing empty folders...");
      ps(`Get-ChildItem -Path '${safe(dirPath)}' -Directory -Recurse -ErrorAction SilentlyContinue | Where-Object { (Get-ChildItem $_.FullName -Force -ErrorAction SilentlyContinue).Count -eq 0 } | Remove-Item -Force -ErrorAction SilentlyContinue`);
      log("Empty folders removed.");
      return { content: [{ type: "text", text: "Empty folders removed:\n" + result }] };
    }

    log("Empty folder scan complete.");
    return { content: [{ type: "text", text: result || "No empty folders found." }] };
  }
);

// Full storage report
server.tool(
  "storage_report",
  "Generate a comprehensive storage report with recommendations",
  {},
  async () => {
    clearLog();
    log("=== Starting full storage report ===");
    let report = "=== STORAGE REPORT ===\n\n";

    // Disk usage
    log("Checking drives...");
    const drives = ps("Get-PSDrive -PSProvider FileSystem | ForEach-Object { $n=$_.Name; $u=[math]::Round($_.Used/1GB,2); $f=[math]::Round($_.Free/1GB,2); $t=[math]::Round(($_.Used+$_.Free)/1GB,2); $p=if($t -gt 0){[math]::Round($u/$t*100,1)}else{0}; Write-Output ('{0}: {1}GB used / {2}GB total ({3}% full, {4}GB free)' -f $n,$u,$t,$p,$f) }", 15000);
    report += "DRIVES:\n" + drives + "\n";

    // Top 10 largest files on C:
    log("Finding largest files on C:...");
    const largeFiles = ps("Get-ChildItem -Path 'C:\\' -Recurse -File -ErrorAction SilentlyContinue | Sort-Object Length -Descending | Select-Object -First 10 FullName, @{N='SizeMB';E={[math]::Round($_.Length/1MB,2)}} | Format-Table -AutoSize");
    report += "TOP 10 LARGEST FILES (C:):\n" + largeFiles + "\n";

    // Temp files
    log("Checking temp files...");
    try {
      const tempSize = ps(`[math]::Round((Get-ChildItem -Path $env:TEMP -Recurse -File -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum/1MB, 2)`, 30000).trim();
      report += `TEMP FILES: ${tempSize} MB\n`;
    } catch {
      report += "TEMP FILES: could not scan\n";
    }

    // Downloads
    log("Checking old downloads...");
    try {
      const dlPath = path.join(process.env.USERPROFILE || "", "Downloads");
      const dlSize = ps(`[math]::Round((Get-ChildItem -Path '${safe(dlPath)}' -File -ErrorAction SilentlyContinue | Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-30) } | Measure-Object -Property Length -Sum).Sum/1MB, 2)`, 30000).trim();
      report += `OLD DOWNLOADS (>30 days): ${dlSize} MB\n`;
    } catch {
      report += "OLD DOWNLOADS: could not scan\n";
    }

    // Recycle bin
    log("Checking recycle bin...");
    try {
      const binCount = ps("$shell = New-Object -ComObject Shell.Application; $bin = $shell.NameSpace(10); Write-Output $bin.Items().Count", 15000).trim();
      report += `RECYCLE BIN: ${binCount} items\n`;
    } catch {
      report += "RECYCLE BIN: could not check\n";
    }

    report += "\n=== END REPORT ===";
    log("=== Storage report complete ===");
    notify("Storage Report Ready", "Full storage analysis complete. Check Claude for results.");
    return { content: [{ type: "text", text: report }] };
  }
);

// ============================================
// PROGRESS & LOG TOOLS
// ============================================

// Check progress log
server.tool("check_progress", "Check the progress log to see what operations are running", {}, async () => {
  const logContent = readLog();
  return { content: [{ type: "text", text: logContent }] };
});

// Clear progress log
server.tool("clear_log", "Clear the progress log", {}, async () => {
  clearLog();
  return { content: [{ type: "text", text: "Log cleared." }] };
});

// ============================================
// START SERVER
// ============================================

const transport = new StdioServerTransport();
await server.connect(transport);

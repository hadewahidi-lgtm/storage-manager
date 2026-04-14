# Storage Manager — MCP Server for Claude Code

An AI-powered storage management tool that gives Claude Code the ability to analyze, clean, and monitor your disk space on Windows.

## What is this?

This is an [MCP (Model Context Protocol)](https://modelcontextprotocol.io/) server — a plugin that gives Claude Code direct access to your filesystem for storage management. Instead of clicking through Windows Disk Cleanup menus or hunting through folders manually, just talk to Claude:

> "My C drive is almost full, figure out why"

Claude will scan your drives, find the problem, explain what's safe to delete, and clean it up — with your permission.

## How it works

```
You ←→ Claude Code ←→ Storage Manager MCP ←→ Your filesystem
```

1. You ask Claude a question about your storage in natural language
2. Claude calls the appropriate tool(s) from this MCP server
3. The tool runs PowerShell commands to scan/analyze/clean your drives
4. Claude reads the results and explains them to you in plain English
5. If cleanup is needed, Claude asks your permission before deleting anything

## Features

### 17 Storage Tools

#### Analysis — find what's eating your space
| Tool | What it does |
|------|-------------|
| `storage_report` | Full analysis of all drives in one shot — largest files, temp bloat, old downloads, recycle bin |
| `disk_usage` | Free/used space on every drive |
| `large_files` | Find the biggest files in any directory (configurable minimum size) |
| `folder_sizes` | Size breakdown by subfolder — see exactly which folders are hogging space |
| `file_type_breakdown` | Disk usage grouped by file extension (.mp4, .zip, .iso, etc.) |

#### Junk finders — spot things safe to clean
| Tool | What it does |
|------|-------------|
| `temp_files` | Scan Windows and user temp directories for bloat |
| `old_downloads` | Find forgotten files in your Downloads folder (configurable age) |
| `duplicate_files` | Find identical files wasting space using MD5 hashing |
| `node_modules_scanner` | Find bloated `node_modules` folders from dev projects |
| `browser_cache` | Check Chrome, Edge, and Firefox cache sizes |
| `windows_cache_cleanup` | Windows Update cache, installer cache, thumbnail cache |
| `empty_folders` | Find directories with nothing in them |
| `large_programs` | List installed programs sorted by size |

#### Actions — actually clean up
| Tool | What it does |
|------|-------------|
| `delete_file` | Delete a file (reports how much space was freed) |
| `delete_folder` | Delete a folder and all its contents (with size reporting) |
| `move_to_drive` | Move files/folders between drives (e.g. C: to D:) |
| `recycle_bin` | Check recycle bin contents or empty it |

#### Utility
| Tool | What it does |
|------|-------------|
| `check_progress` | See live progress of running scans |
| `clear_log` | Clear the progress log |

### Background Monitor

A separate process (`monitor.js`) that runs silently and sends Windows toast notifications:

| Condition | Notification | How often |
|-----------|-------------|-----------|
| Everything fine | Daily status summary (all drives) | Once at 9 AM |
| < 20 GB free | "Disk Space Getting Low" | Every 12 hours max |
| < 10 GB free | "Low Disk Space" warning | Every 4 hours max |
| < 5 GB free | "CRITICAL: Disk Almost Full" | Every hour |

The monitor checks every 10 minutes but only sends notifications at the intervals above, so it won't spam you. Alerts escalate as space gets tighter.

## Installation

### Requirements
- Windows 10 or 11
- [Node.js](https://nodejs.org/) v18 or newer
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code)

### Step 1: Clone and install dependencies

```bash
git clone https://github.com/hadewahidi-lgtm/storage-manager.git
cd storage-manager
npm install
```

### Step 2: Register with Claude Code

Run this in your terminal:

```bash
claude mcp add storage-manager --scope user -- node "/path/to/storage-manager/index.js"
```

Replace `/path/to/storage-manager/` with the actual path where you cloned the repo.

Then restart Claude Code. The 17 tools are now available — Claude will automatically use them when you ask about storage.

### Step 3 (optional): Install the background monitor

This sets up a Windows Scheduled Task that starts the monitor on login. Open **PowerShell as Administrator** and run:

```powershell
powershell -ExecutionPolicy Bypass -File "C:\path\to\storage-manager\install-monitor.ps1"
```

To start it immediately without restarting:

```powershell
Start-ScheduledTask -TaskName "StorageManagerMonitor"
```

To remove it later:

```powershell
Unregister-ScheduledTask -TaskName "StorageManagerMonitor" -Confirm:$false
```

## Usage

Just talk to Claude in Claude Code. Some examples:

```
"Run a full storage report"
"Why is my C drive so full?"
"Find duplicate files on D:"
"What's in my Downloads that I can delete?"
"Move my large files from C: to D:"
"Clean up browser caches"
"Find all node_modules folders and show their sizes"
"What file types are using the most space on C:?"
"Empty my recycle bin"
"Find files over 500MB on C:"
```

Claude will call the right tools, explain what it found, and ask before deleting anything.

## File structure

```
storage-manager/
  index.js              — MCP server with all 17 tools
  monitor.js            — Background disk space monitor
  install-monitor.ps1   — PowerShell script to register the monitor as a scheduled task
  notify.js             — Windows toast notification helper
  logger.js             — Progress logging (writes to ~/.storage-manager/)
  package.json          — Node.js dependencies
```

## How is this different from Windows Disk Cleanup?

| Windows Disk Cleanup | Storage Manager |
|---------------------|----------------|
| Fixed checklist of 5-6 categories | Investigates your specific situation |
| Same options every time | Finds any problem — duplicates, old projects, bloated folders |
| Navigate through Settings menus | Just ask in natural language |
| Can't explain what it's doing | Explains what's safe to delete and why |
| Can't move files between drives | Can reorganize your storage across drives |
| One-size-fits-all | Adapts to your usage patterns |
| No ongoing monitoring | Background monitor with smart alerts |

## Data & privacy

- Everything runs locally on your machine — no data is sent anywhere
- The MCP server communicates with Claude Code over stdin/stdout
- Logs are stored in `~/.storage-manager/` on your machine
- No telemetry, no analytics, no cloud

## License

MIT

# Storage Manager — MCP Server for Claude Code

An AI-powered storage management tool that gives Claude Code the ability to analyze, clean, and monitor your disk space on Windows.

## What is this?

Instead of clicking through Windows Disk Cleanup menus, just talk to Claude:

> "My C drive is almost full, figure out why"

Claude will scan your drives, find the problem, explain what's safe to delete, and clean it up — with your permission.

## Features

### 16 Storage Tools
| Tool | Description |
|------|-------------|
| `disk_usage` | Check free/used space on all drives |
| `large_files` | Find the biggest files in any directory |
| `folder_sizes` | Size breakdown by subfolder |
| `temp_files` | Find temporary file bloat |
| `delete_file` | Delete a file with size reporting |
| `delete_folder` | Delete a folder and all contents |
| `recycle_bin` | Check or empty the recycle bin |
| `file_type_breakdown` | Disk usage by file type (.mp4, .zip, etc.) |
| `duplicate_files` | Find identical files wasting space |
| `old_downloads` | Find forgotten files in Downloads |
| `node_modules_scanner` | Find bloated node_modules folders |
| `windows_cache_cleanup` | Clean Windows Update, installer, and thumbnail caches |
| `large_programs` | List installed programs by size |
| `browser_cache` | Check/clear Chrome, Edge, Firefox caches |
| `move_to_drive` | Move files between drives |
| `empty_folders` | Find and remove empty directories |
| `storage_report` | Full analysis in one shot |
| `check_progress` | See progress of running scans |

### Background Monitor
- Runs silently on Windows startup
- Checks disk space every 10 minutes
- Sends Windows toast notifications when drives are getting full
- Warning at < 20GB free, critical alerts at < 10GB free

### Progress & Notifications
- All operations log progress to `~/.storage-manager/progress.log`
- Windows toast notifications for alerts, scan results, and deletions

## Installation

### Requirements
- Windows 10/11
- [Node.js](https://nodejs.org/) (v18+)
- [Claude Code CLI](https://claude.ai/code)

### Setup

1. Clone and install:
```bash
git clone https://github.com/YOUR_USERNAME/storage-manager.git
cd storage-manager
npm install
```

2. Register with Claude Code:
```bash
claude mcp add storage-manager --scope user -- node "PATH_TO/storage-manager/index.js"
```

3. Restart Claude Code — the tools are now available.

4. (Optional) Install the background monitor — run in Admin PowerShell:
```powershell
powershell -ExecutionPolicy Bypass -File PATH_TO\storage-manager\install-monitor.ps1
```

## Usage

Just talk to Claude in Claude Code:

- "Run a full storage report"
- "Why is my C drive so full?"
- "Find duplicate files on C:"
- "What's in my Downloads that I can delete?"
- "Move my large files from C: to D:"
- "Clean up browser caches"
- "Find all node_modules folders"

## How is this different from Windows Disk Cleanup?

| Windows Cleanup | This |
|----------------|------|
| Fixed checklist of categories | Investigates your specific situation |
| Same 5 things every time | Finds any problem — duplicates, old projects, bloated folders |
| Navigate menus | Just talk |
| Can't explain what it's doing | Explains what's safe and why |
| Can't move files between drives | Can reorganize your storage |
| One-size-fits-all | Adapts to your usage patterns |

## License

MIT

# Website-Archiver

Archive a website by domain, including linked documents, CSS, and JavaScript files, then browse snapshots locally and track changes over time.

## What This App Does

- Crawls a starting URL and follows same-domain links.
- Downloads pages plus linked assets and documents (CSS, JS, PDF, DOCX, and more).
- Rewrites internal links to local paths for offline browsing.
- Saves each run as a timestamped snapshot.
- Serves a snapshot from a local web server for JavaScript-heavy pages.
- Compares snapshots and creates a changelog-style Markdown report.
- Provides a dashboard to add sites, archive from the UI, browse saved versions, and delete archived sites.

## Requirements

- Node.js 18+

## Install

```bash
npm install
```

## Usage

### 1) Archive a site snapshot

```bash
npm run archive -- https://example.com
```

Options:

- `-o, --output-dir <path>`: Archive root directory (default: `archives`)
- `-s, --snapshot-id <id>`: Custom snapshot identifier
- `-t, --timeout-ms <ms>`: Request timeout per URL (default: `20000`)

Example with custom snapshot id:

```bash
npm run archive -- https://example.com --snapshot-id 2026-05-07-baseline
```

### 2) Serve a snapshot locally

Use this when pages need HTTP serving instead of opening via `file://`.

```bash
npm run serve
```

Options:

- `-s, --snapshot-id <id>`: Snapshot to serve (latest by default)
- `-p, --port <port>`: Port (default: `8080`)
- `-o, --output-dir <path>`: Archive root

Example:

```bash
npm run serve -- --snapshot-id 2026-05-07-baseline --port 8090
```

### 3) Generate a change report

```bash
npm run report
```

By default, compares the latest two snapshots.

You can specify explicit snapshots:

```bash
npm run report -- --from 2026-05-07-baseline --to 2026-05-20-followup
```

Generated report path:

`archives/reports/change-report-<from>-to-<to>.md`

### 4) Launch the management dashboard

```bash
npm run dashboard
```

Then open:

`http://localhost:8090`

Dashboard features:

- Add a site URL and archive immediately.
- View all managed sites.
- Open any saved version in a browser.
- Open a Details page for each saved version to inspect failures and file-level changes from the previous version.
- Trigger Archive Now for an existing site.
- Delete an archived site and all snapshots.

Dashboard options:

- `-o, --output-dir <path>`: Archive root (default: `archives`)
- `-p, --port <port>`: Dashboard port (default: `8090`)
- `-t, --timeout-ms <ms>`: Archive request timeout (default: `20000`)

### 5) Build a Windows EXE to start/stop the dashboard website

Build the Windows apps:

```bash
npm run build:windows-exe
```

Primary double-click UI app output:

`dist/website-archiver-control.exe`

CLI controller output:

`dist/website-archiver-control-cli.exe`

Use the CLI controller to manage the dashboard server:

```powershell
# Start dashboard in background and open browser
.\dist\website-archiver-control-cli.exe start

# Check status
.\dist\website-archiver-control-cli.exe status

# Stop dashboard
.\dist\website-archiver-control-cli.exe stop
```

Note: The EXE uses your local `npm.cmd` to launch the dashboard, so Node.js and npm must be installed on the machine.

Useful options:

- `-o, --output-dir <path>`: Archive root directory (default: `archives`)
- `-p, --port <port>`: Dashboard port for `start` (default: `8090`)
- `--no-open`: Do not open browser when running `start`

### 6) Build a small Windows UI app (Start/Stop window)

This creates a small native Windows window with **Start**, **Stop**, **Refresh**, and **Open Site** buttons.

Build the UI app:

```powershell
dotnet publish .\windows-ui\WebsiteArchiverControlApp\WebsiteArchiverControlApp.csproj -c Release -r win-x64 --self-contained true /p:PublishSingleFile=true
```

Published EXE:

`windows-ui/WebsiteArchiverControlApp/bin/Release/net9.0-windows/win-x64/publish/WebsiteArchiverControlApp.exe`

Convenience copy:

`dist/ui/WebsiteArchiverControlApp.exe`

Notes:

- `dist/website-archiver-control.exe` is the GUI app for double-click launch.
- The UI app uses `dist/website-archiver-control-cli.exe` internally.
- If you move the UI EXE outside this repository, set environment variable `WA_CONTROL_EXE` to the full path of `website-archiver-control-cli.exe`.

## Output Layout

```text
archives/
	sites.json
	sites/
		<site-id>/
			<snapshot-id>/
				manifest.json
				files/
					index.html
	<snapshot-id>/
		manifest.json
		files/
			index.html
			... archived pages/assets/documents
	reports/
		change-report-<from>-to-<to>.md
```

## Notes

- Crawl scope is restricted to the same hostname as the start URL.
- Internal references are rewritten for local browsing where possible.
- Some highly dynamic pages may still require backend APIs not present in the archive.

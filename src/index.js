#!/usr/bin/env node
import { Command } from "commander";
import { runArchive } from "./archive.js";
import { runDashboard } from "./dashboard.js";
import { runReport } from "./report.js";
import { runServe } from "./serve.js";

const program = new Command();

program
  .name("website-archiver")
  .description("Archive domain-scoped websites with snapshot diff reporting.")
  .version("1.0.0");

program
  .command("archive")
  .description("Crawl and archive a website snapshot")
  .argument("<url>", "Root website URL (for example: https://example.com)")
  .option("-o, --output-dir <path>", "Archive output root", "archives")
  .option("-s, --snapshot-id <id>", "Custom snapshot ID")
  .option("-t, --timeout-ms <ms>", "Per-request timeout in milliseconds", value => Number(value), 20000)
  .action(async (url, options) => {
    try {
      const result = await runArchive({
        url,
        outputDir: options.outputDir,
        snapshotId: options.snapshotId,
        timeoutMs: options.timeoutMs
      });

      console.log(`Snapshot created: ${result.snapshotId}`);
      console.log(`Files saved: ${result.savedFileCount}`);
      console.log(`Failures: ${result.failedCount}`);
      console.log(`Manifest: ${result.manifestPath}`);
    } catch (error) {
      console.error(`Archive failed: ${error.message}`);
      process.exitCode = 1;
    }
  });

program
  .command("report")
  .description("Create a changelog-style report between snapshots")
  .option("-o, --output-dir <path>", "Archive output root", "archives")
  .option("--from <snapshot-id>", "Older snapshot ID")
  .option("--to <snapshot-id>", "Newer snapshot ID")
  .action(async options => {
    try {
      const result = await runReport(options);
      console.log(`Compared: ${result.fromSnapshot} -> ${result.toSnapshot}`);
      console.log(`Added: ${result.added}, Removed: ${result.removed}, Modified: ${result.modified}`);
      console.log(`Report: ${result.reportPath}`);
    } catch (error) {
      console.error(`Report generation failed: ${error.message}`);
      process.exitCode = 1;
    }
  });

program
  .command("serve")
  .description("Serve a snapshot locally for JS-enabled browsing")
  .option("-o, --output-dir <path>", "Archive output root", "archives")
  .option("-s, --snapshot-id <snapshot-id>", "Snapshot to serve (latest by default)")
  .option("-p, --port <port>", "Local server port", value => Number(value), 8080)
  .action(async options => {
    try {
      const result = await runServe(options);
      console.log(`Serving snapshot: ${result.snapshotId}`);
      console.log(`Directory: ${result.filesDir}`);
      console.log(`URL: http://localhost:${result.port}`);
    } catch (error) {
      console.error(`Serve failed: ${error.message}`);
      process.exitCode = 1;
    }
  });

program
  .command("dashboard")
  .description("Launch dashboard to manage archived sites and snapshots")
  .option("-o, --output-dir <path>", "Archive output root", "archives")
  .option("-p, --port <port>", "Dashboard port", value => Number(value), 8090)
  .option("-t, --timeout-ms <ms>", "Per-request timeout for archive actions", value => Number(value), 20000)
  .action(async options => {
    try {
      const result = await runDashboard(options);
      console.log(`Dashboard output root: ${result.outputDir}`);
      console.log(`Managed sites root: ${result.sitesDir}`);
      console.log(`Dashboard URL: http://localhost:${result.port}`);
    } catch (error) {
      console.error(`Dashboard failed: ${error.message}`);
      process.exitCode = 1;
    }
  });

program.parseAsync(process.argv);

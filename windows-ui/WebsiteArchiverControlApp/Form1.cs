namespace WebsiteArchiverControlApp;

public partial class Form1 : Form
{
    private const string ControllerExeName = "website-archiver-control-cli.exe";
    private string? _workingDirectory;
    private string? _nodeExePath;
    private string? _npmCmdPath;

    public Form1()
    {
        InitializeComponent();

        try
        {
            var appIcon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
            if (appIcon != null)
            {
                Icon = appIcon;
            }
        }
        catch
        {
            // If icon extraction fails, keep default form icon.
        }

        btnStart.Click += async (_, _) => await StartDashboardAsync();
        btnStop.Click += async (_, _) => await StopDashboardAsync();
        btnRefresh.Click += async (_, _) => await RefreshStatusAsync();
        btnOpenSite.Click += (_, _) => OpenSite();
        Shown += async (_, _) => await InitializeAppAsync();
    }

    private async Task InitializeAppAsync()
    {
        SetBusyState(true);
        lblStatus.Text = "Checking prerequisites...";

        var ready = await EnsurePrerequisitesAsync();
        if (!ready)
        {
            lblStatus.Text = "Prerequisite setup required";
            AppendOutput("Setup is incomplete. Install prerequisites and reopen the app.");
            return;
        }

        await RefreshStatusAsync();
    }

    private async Task<bool> EnsurePrerequisitesAsync()
    {
        try
        {
            _workingDirectory = ResolveWorkingDirectory();

            var nodeReady = await EnsureNodeAsync();
            if (!nodeReady)
            {
                return false;
            }

            var npmReady = await EnsureNpmInstallAsync();
            if (!npmReady)
            {
                return false;
            }

            var cliReady = await EnsureCliControllerAsync();
            if (!cliReady)
            {
                return false;
            }

            return true;
        }
        catch (Exception ex)
        {
            AppendOutput($"Prerequisite check failed: {ex.Message}");
            return false;
        }
    }

    private async Task<bool> EnsureNodeAsync()
    {
        var nodePath = await ResolveNodeExecutableAsync();

        if (string.IsNullOrWhiteSpace(nodePath))
        {
            AppendOutput("Node.js was not found.");
            return await PromptAndInstallNodeAsync();
        }

        var versionResult = await ExecuteProcessAsync(nodePath, "--version", _workingDirectory ?? Environment.CurrentDirectory);
        if (versionResult.ExitCode != 0)
        {
            AppendOutput("Node.js version check failed.");
            return await PromptAndInstallNodeAsync();
        }

        var versionText = versionResult.StdOut.Trim();
        if (!TryParseNodeMajor(versionText, out var majorVersion) || majorVersion < 18)
        {
            AppendOutput($"Node.js version {versionText} found. Node.js 18+ is required.");
            return await PromptAndInstallNodeAsync();
        }

        _nodeExePath = nodePath;
        var nodeDir = Path.GetDirectoryName(nodePath);
        if (!string.IsNullOrWhiteSpace(nodeDir))
        {
            var npmInNodeDir = Path.Combine(nodeDir, "npm.cmd");
            if (File.Exists(npmInNodeDir))
            {
                _npmCmdPath = npmInNodeDir;
            }
        }

        AppendOutput($"Node.js check passed: {versionText}");
        return true;
    }

    private async Task<bool> PromptAndInstallNodeAsync()
    {
        var answer = MessageBox.Show(
            "Node.js 18+ is required. Install Node.js LTS now using winget?",
            "Install Prerequisite",
            MessageBoxButtons.YesNo,
            MessageBoxIcon.Question
        );

        if (answer != DialogResult.Yes)
        {
            AppendOutput("Node.js installation was skipped by user.");
            return false;
        }

        AppendOutput("Installing Node.js LTS with winget...");
        var installResult = await ExecuteProcessAsync(
            "winget",
            "install OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements --silent",
            _workingDirectory ?? Environment.CurrentDirectory
        );

        if (!string.IsNullOrWhiteSpace(installResult.StdOut))
        {
            AppendOutput(installResult.StdOut.Trim());
        }

        if (installResult.ExitCode != 0)
        {
            if (!string.IsNullOrWhiteSpace(installResult.StdErr))
            {
                AppendOutput(installResult.StdErr.Trim());
            }

            MessageBox.Show(
                "Automatic Node.js install failed. Please install Node.js 18+ manually and reopen the app.",
                "Node.js Install Failed",
                MessageBoxButtons.OK,
                MessageBoxIcon.Error
            );
            return false;
        }

        // Refresh tool paths after installation.
        _nodeExePath = null;
        _npmCmdPath = null;

        return await EnsureNodeAsync();
    }

    private async Task<bool> EnsureNpmInstallAsync()
    {
        var workingDirectory = _workingDirectory ?? Environment.CurrentDirectory;
        var nodeModulesPath = Path.Combine(workingDirectory, "node_modules");

        if (Directory.Exists(nodeModulesPath))
        {
            AppendOutput("npm dependencies already installed.");
            return true;
        }

        var npmPath = await ResolveNpmExecutableAsync();
        if (string.IsNullOrWhiteSpace(npmPath))
        {
            AppendOutput("npm.cmd was not found after Node.js setup.");
            return false;
        }

        AppendOutput("Installing npm dependencies (first run setup)...");
        var npmInstall = await ExecuteProcessAsync(npmPath, "install", workingDirectory);

        if (!string.IsNullOrWhiteSpace(npmInstall.StdOut))
        {
            AppendOutput(npmInstall.StdOut.Trim());
        }

        if (npmInstall.ExitCode != 0)
        {
            if (!string.IsNullOrWhiteSpace(npmInstall.StdErr))
            {
                AppendOutput(npmInstall.StdErr.Trim());
            }

            MessageBox.Show(
                "npm install failed. See output log for details.",
                "npm Install Failed",
                MessageBoxButtons.OK,
                MessageBoxIcon.Error
            );
            return false;
        }

        AppendOutput("npm install completed.");
        return true;
    }

    private async Task<bool> EnsureCliControllerAsync()
    {
        try
        {
            _ = ResolveControllerPath();
            return true;
        }
        catch (FileNotFoundException)
        {
            AppendOutput("CLI controller is missing. Building it now...");
        }

        var npmPath = await ResolveNpmExecutableAsync();
        if (string.IsNullOrWhiteSpace(npmPath))
        {
            AppendOutput("Cannot build CLI controller because npm.cmd was not found.");
            return false;
        }

        var buildResult = await ExecuteProcessAsync(
            npmPath,
            "run build:windows-cli",
            _workingDirectory ?? Environment.CurrentDirectory
        );

        if (!string.IsNullOrWhiteSpace(buildResult.StdOut))
        {
            AppendOutput(buildResult.StdOut.Trim());
        }

        if (buildResult.ExitCode != 0)
        {
            if (!string.IsNullOrWhiteSpace(buildResult.StdErr))
            {
                AppendOutput(buildResult.StdErr.Trim());
            }

            MessageBox.Show(
                "Failed to build CLI controller automatically. See output log for details.",
                "CLI Build Failed",
                MessageBoxButtons.OK,
                MessageBoxIcon.Error
            );
            return false;
        }

        try
        {
            _ = ResolveControllerPath();
            AppendOutput("CLI controller build completed.");
            return true;
        }
        catch (Exception ex)
        {
            AppendOutput($"CLI controller is still missing after build: {ex.Message}");
            return false;
        }
    }

    private static bool TryParseNodeMajor(string versionText, out int major)
    {
        major = 0;
        var clean = versionText.Trim();
        if (clean.StartsWith("v", StringComparison.OrdinalIgnoreCase))
        {
            clean = clean[1..];
        }

        var firstPart = clean.Split('.', StringSplitOptions.RemoveEmptyEntries).FirstOrDefault();
        return int.TryParse(firstPart, out major);
    }

    private async Task<string?> ResolveNodeExecutableAsync()
    {
        if (!string.IsNullOrWhiteSpace(_nodeExePath) && File.Exists(_nodeExePath))
        {
            return _nodeExePath;
        }

        var envNode = Environment.GetEnvironmentVariable("WA_NODE_EXE");
        if (!string.IsNullOrWhiteSpace(envNode) && File.Exists(envNode))
        {
            return envNode;
        }

        var whereResult = await ExecuteProcessAsync("where", "node", _workingDirectory ?? Environment.CurrentDirectory);
        if (whereResult.ExitCode == 0)
        {
            var firstPath = whereResult.StdOut
                .Split(new[] { '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries)
                .FirstOrDefault();
            if (!string.IsNullOrWhiteSpace(firstPath) && File.Exists(firstPath))
            {
                return firstPath;
            }
        }

        var commonPaths = new[]
        {
            @"C:\Program Files\nodejs\node.exe",
            @"C:\Program Files (x86)\nodejs\node.exe",
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs", "nodejs", "node.exe")
        };

        return commonPaths.FirstOrDefault(File.Exists);
    }

    private async Task<string?> ResolveNpmExecutableAsync()
    {
        if (!string.IsNullOrWhiteSpace(_npmCmdPath) && File.Exists(_npmCmdPath))
        {
            return _npmCmdPath;
        }

        if (!string.IsNullOrWhiteSpace(_nodeExePath))
        {
            var nodeDir = Path.GetDirectoryName(_nodeExePath);
            if (!string.IsNullOrWhiteSpace(nodeDir))
            {
                var npmInNodeDir = Path.Combine(nodeDir, "npm.cmd");
                if (File.Exists(npmInNodeDir))
                {
                    return npmInNodeDir;
                }
            }
        }

        var whereResult = await ExecuteProcessAsync("where", "npm.cmd", _workingDirectory ?? Environment.CurrentDirectory);
        if (whereResult.ExitCode == 0)
        {
            var firstPath = whereResult.StdOut
                .Split(new[] { '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries)
                .FirstOrDefault();
            if (!string.IsNullOrWhiteSpace(firstPath) && File.Exists(firstPath))
            {
                return firstPath;
            }
        }

        return null;
    }

    private async Task StartDashboardAsync()
    {
        var args = $"start --port {(int)numPort.Value}";
        if (!chkOpenBrowser.Checked)
        {
            args += " --no-open";
        }

        await RunControllerCommandAsync(args, "Starting dashboard...");
        await RefreshStatusAsync();
    }

    private async Task StopDashboardAsync()
    {
        await RunControllerCommandAsync("stop", "Stopping dashboard...");
        await RefreshStatusAsync();
    }

    private async Task RefreshStatusAsync()
    {
        SetBusyState(true);
        try
        {
            var output = await ExecuteCommandAsync("status");
            AppendOutput(output);
            UpdateStatusLabel(output);
        }
        catch (Exception ex)
        {
            AppendOutput($"Status error: {ex.Message}");
            lblStatus.Text = "Unavailable";
        }
        finally
        {
            SetBusyState(false);
        }
    }

    private void OpenSite()
    {
        var port = (int)numPort.Value;
        var url = $"http://localhost:{port}";
        try
        {
            System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo
            {
                FileName = url,
                UseShellExecute = true
            });
        }
        catch (Exception ex)
        {
            AppendOutput($"Open site failed: {ex.Message}");
        }
    }

    private async Task RunControllerCommandAsync(string arguments, string heading)
    {
        SetBusyState(true);
        try
        {
            AppendOutput(heading);
            var output = await ExecuteCommandAsync(arguments);
            AppendOutput(output);
        }
        catch (Exception ex)
        {
            AppendOutput($"Command error: {ex.Message}");
        }
        finally
        {
            SetBusyState(false);
        }
    }

    private async Task<string> ExecuteCommandAsync(string arguments)
    {
        var controllerPath = ResolveControllerPath();
        var workingDirectory = _workingDirectory ?? ResolveWorkingDirectory();

        var startInfo = new System.Diagnostics.ProcessStartInfo
        {
            FileName = controllerPath,
            Arguments = arguments,
            WorkingDirectory = workingDirectory,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            CreateNoWindow = true,
            UseShellExecute = false
        };

        using var process = new System.Diagnostics.Process { StartInfo = startInfo };
        process.Start();

        var stdout = await process.StandardOutput.ReadToEndAsync();
        var stderr = await process.StandardError.ReadToEndAsync();
        await process.WaitForExitAsync();

        var output = string.IsNullOrWhiteSpace(stderr)
            ? stdout
            : $"{stdout}{Environment.NewLine}{stderr}";

        return string.IsNullOrWhiteSpace(output)
            ? "(no output)"
            : output.Trim();
    }

    private async Task<(int ExitCode, string StdOut, string StdErr)> ExecuteProcessAsync(string fileName, string arguments, string workingDirectory)
    {
        try
        {
            var startInfo = new System.Diagnostics.ProcessStartInfo
            {
                FileName = fileName,
                Arguments = arguments,
                WorkingDirectory = workingDirectory,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                CreateNoWindow = true,
                UseShellExecute = false
            };

            using var process = new System.Diagnostics.Process { StartInfo = startInfo };
            process.Start();

            var stdout = await process.StandardOutput.ReadToEndAsync();
            var stderr = await process.StandardError.ReadToEndAsync();
            await process.WaitForExitAsync();

            return (process.ExitCode, stdout, stderr);
        }
        catch (Exception ex)
        {
            return (-1, string.Empty, ex.Message);
        }
    }

    private string ResolveControllerPath()
    {
        var envPath = Environment.GetEnvironmentVariable("WA_CONTROL_EXE");
        if (!string.IsNullOrWhiteSpace(envPath) && File.Exists(envPath))
        {
            return envPath;
        }

        var candidates = new List<string>
        {
            Path.Combine(AppContext.BaseDirectory, ControllerExeName),
            Path.Combine(AppContext.BaseDirectory, "dist", ControllerExeName),
            Path.Combine(ResolveWorkingDirectory(), "dist", ControllerExeName)
        };

        foreach (var candidate in candidates)
        {
            if (File.Exists(candidate))
            {
                return candidate;
            }
        }

        throw new FileNotFoundException(
            "Controller executable not found. Build it with 'npm.cmd run build:windows-exe'."
        );
    }

    private string ResolveWorkingDirectory()
    {
        if (!string.IsNullOrWhiteSpace(_workingDirectory) && Directory.Exists(_workingDirectory))
        {
            return _workingDirectory;
        }

        var current = new DirectoryInfo(AppContext.BaseDirectory);
        while (current != null)
        {
            var packageJsonPath = Path.Combine(current.FullName, "package.json");
            if (File.Exists(packageJsonPath))
            {
                _workingDirectory = current.FullName;
                return current.FullName;
            }

            current = current.Parent;
        }

        _workingDirectory = Environment.CurrentDirectory;
        return Environment.CurrentDirectory;
    }

    private void UpdateStatusLabel(string output)
    {
        if (output.IndexOf("running", StringComparison.OrdinalIgnoreCase) >= 0)
        {
            lblStatus.Text = "Running";
            return;
        }

        if (output.IndexOf("stopped", StringComparison.OrdinalIgnoreCase) >= 0)
        {
            lblStatus.Text = "Stopped";
            return;
        }

        lblStatus.Text = "Unknown";
    }

    private void AppendOutput(string text)
    {
        if (string.IsNullOrWhiteSpace(text))
        {
            return;
        }

        txtOutput.AppendText($"[{DateTime.Now:HH:mm:ss}] {text}{Environment.NewLine}{Environment.NewLine}");
    }

    private void SetBusyState(bool isBusy)
    {
        btnStart.Enabled = !isBusy;
        btnStop.Enabled = !isBusy;
        btnRefresh.Enabled = !isBusy;
        btnOpenSite.Enabled = !isBusy;
        chkOpenBrowser.Enabled = !isBusy;
        numPort.Enabled = !isBusy;
    }
}

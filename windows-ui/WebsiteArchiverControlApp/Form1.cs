namespace WebsiteArchiverControlApp;

public partial class Form1 : Form
{
    private const string ControllerExeName = "website-archiver-control-cli.exe";

    public Form1()
    {
        InitializeComponent();
        btnStart.Click += async (_, _) => await StartDashboardAsync();
        btnStop.Click += async (_, _) => await StopDashboardAsync();
        btnRefresh.Click += async (_, _) => await RefreshStatusAsync();
        btnOpenSite.Click += (_, _) => OpenSite();
        Shown += async (_, _) => await RefreshStatusAsync();
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
        var workingDirectory = ResolveWorkingDirectory();

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
        var current = new DirectoryInfo(AppContext.BaseDirectory);
        while (current != null)
        {
            var packageJsonPath = Path.Combine(current.FullName, "package.json");
            if (File.Exists(packageJsonPath))
            {
                return current.FullName;
            }

            current = current.Parent;
        }

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

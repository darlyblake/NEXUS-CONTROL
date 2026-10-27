using System.Diagnostics;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace NexusControl.Agent.Windows;

internal sealed record AgentConfig(string RelayUrl, string DeviceId, string DeviceToken, bool AllowRemoteShell);

/// <summary>
/// Outbound-only relay client. The agent has no inbound listening port.
/// Remote PowerShell is disabled unless the owner explicitly enables it during setup.
/// </summary>
public sealed class AgentWorker : BackgroundService
{
    private readonly ILogger<AgentWorker> _logger;
    private readonly HashSet<string> _processedCommands = new();
    private readonly Queue<string> _processedOrder = new();
    private readonly object _commandLock = new();
    private readonly string _configPath = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData),
        "NEXUS CONTROL", "Agent", "agent.json");

    public AgentWorker(ILogger<AgentWorker> logger) => _logger = logger;

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _logger.LogInformation("NEXUS CONTROL Agent Windows started on {Host}.", Environment.MachineName);
        var delay = TimeSpan.FromSeconds(3);

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                var config = await LoadConfigAsync(stoppingToken);
                if (config is null)
                {
                    _logger.LogWarning("Agent is not paired. Run the explicit pairing installer to connect it.");
                    await Task.Delay(TimeSpan.FromSeconds(30), stoppingToken);
                    continue;
                }

                await RunSessionAsync(config, stoppingToken);
                delay = TimeSpan.FromSeconds(3);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "NEXUS CONTROL relay connection failed; retrying.");
                await Task.Delay(delay, stoppingToken);
                delay = TimeSpan.FromSeconds(Math.Min(delay.TotalSeconds * 2, 60));
            }
        }

        _logger.LogInformation("NEXUS CONTROL Agent Windows stopped.");
    }

    private async Task<AgentConfig?> LoadConfigAsync(CancellationToken ct)
    {
        if (!File.Exists(_configPath)) return null;
        await using var stream = File.OpenRead(_configPath);
        return await JsonSerializer.DeserializeAsync<AgentConfig>(stream, cancellationToken: ct);
    }

    private async Task RunSessionAsync(AgentConfig config, CancellationToken ct)
    {
        if (!Uri.TryCreate(config.RelayUrl, UriKind.Absolute, out var relay) ||
            relay.Scheme != Uri.UriSchemeHttps ||
            string.IsNullOrWhiteSpace(config.DeviceId) ||
            string.IsNullOrWhiteSpace(config.DeviceToken))
            throw new InvalidOperationException("Invalid or incomplete secure relay configuration.");

        var ws = new UriBuilder(relay) { Scheme = "wss", Path = "/ws", Query = "", Fragment = "" }.Uri;
        using var socket = new ClientWebSocket();
        socket.Options.KeepAliveInterval = TimeSpan.FromSeconds(20);
        await socket.ConnectAsync(ws, ct);
        await SendJsonAsync(socket, new { type = "auth", deviceId = config.DeviceId, token = config.DeviceToken }, ct);
        _logger.LogInformation("Connected to the configured NEXUS CONTROL relay.");

        var buffer = new byte[16 * 1024];
        while (socket.State == WebSocketState.Open && !ct.IsCancellationRequested)
        {
            using var ms = new MemoryStream();
            WebSocketReceiveResult result;
            do
            {
                result = await socket.ReceiveAsync(new ArraySegment<byte>(buffer), ct);
                if (result.MessageType == WebSocketMessageType.Close) return;
                if (result.MessageType != WebSocketMessageType.Text)
                    throw new InvalidDataException("Unexpected binary message from relay.");
                ms.Write(buffer, 0, result.Count);
                if (ms.Length > 64 * 1024) throw new InvalidDataException("Relay message exceeds the allowed size.");
            } while (!result.EndOfMessage);

            using var document = JsonDocument.Parse(ms.ToArray());
            var root = document.RootElement;
            if (!root.TryGetProperty("type", out var typeValue)) continue;
            var type = typeValue.GetString();
            if (type == "authenticated")
            {
                _logger.LogInformation("NEXUS CONTROL relay authentication succeeded.");
                continue;
            }
            if (type != "command") continue;
            await HandleCommandAsync(socket, config, root, ct);
        }
    }

    private async Task HandleCommandAsync(ClientWebSocket socket, AgentConfig config, JsonElement command, CancellationToken ct)
    {
        var commandId = command.TryGetProperty("commandId", out var id) ? id.GetString() ?? "" : "";
        var action = command.TryGetProperty("action", out var a) ? a.GetString() ?? "" : "";
        var timestamp = command.TryGetProperty("timestamp", out var t) && t.TryGetInt64(out var stamp) ? stamp : 0;
        var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();

        if (commandId.Length is < 1 or > 100 || Math.Abs(now - timestamp) > 60_000)
        {
            _logger.LogWarning("Rejected invalid or stale remote command.");
            return;
        }
        lock (_commandLock)
        {
            if (!_processedCommands.Add(commandId))
            {
                _logger.LogWarning("Rejected duplicate remote command {CommandId}.", commandId);
                return;
            }
            _processedOrder.Enqueue(commandId);
            while (_processedOrder.Count > 2000)
                _processedCommands.Remove(_processedOrder.Dequeue());
        }

        bool ok = false;
        string detail = "";
        string output = "";
        try
        {
            switch (action)
            {
                case "start_screen_share":
                case "stop_screen_share":
                    // The service runs in Session 0 and cannot capture the signed-in user's
                    // interactive desktop. Do not pretend that a stream started; a separate
                    // interactive-session companion and IPC channel are required.
                    await SendJsonAsync(socket, new
                    {
                        type = "screen_share_error",
                        commandId,
                        message = "Le partage d’écran n’est pas encore installé sur cet agent Windows : le compagnon de session interactive est manquant."
                    }, ct);
                    return;

                case "windows_status":
                    ok = true;
                    detail = "status";
                    output = JsonSerializer.Serialize(new
                    {
                        hostname = Environment.MachineName,
                        os = Environment.OSVersion.VersionString,
                        architecture = Environment.Is64BitOperatingSystem ? "x64" : "x86",
                        agentVersion = typeof(AgentWorker).Assembly.GetName().Version?.ToString() ?? "unknown",
                        remoteShellEnabled = config.AllowRemoteShell
                    });
                    break;

                case "windows_list_processes":
                    ok = true;
                    detail = "processes";
                    output = JsonSerializer.Serialize(Process.GetProcesses()
                        .Select(p =>
                        {
                            try { return new { name = p.ProcessName, pid = p.Id }; }
                            catch { return new { name = "unavailable", pid = p.Id }; }
                        })
                        .OrderBy(p => p.name)
                        .Take(100)
                        .ToArray());
                    break;

                case "windows_run_powershell":
                    if (!config.AllowRemoteShell)
                    {
                        detail = "Remote PowerShell is disabled on this device. Reinstall/configure the agent locally to explicitly enable it.";
                        break;
                    }
                    if (!command.TryGetProperty("script", out var scriptValue))
                    {
                        detail = "Missing script.";
                        break;
                    }
                    var script = scriptValue.GetString() ?? "";
                    if (string.IsNullOrWhiteSpace(script) || script.Length > 8000)
                    {
                        detail = "Script is empty or exceeds the 8000-character limit.";
                        break;
                    }
                    (ok, output, detail) = await RunPowerShellAsync(script, ct);
                    break;

                default:
                    detail = "Unsupported Windows action.";
                    break;
            }
        }
        catch (Exception ex)
        {
            detail = ex.Message.Length > 1500 ? ex.Message[..1500] : ex.Message;
            _logger.LogWarning(ex, "Remote action {Action} failed.", action);
        }

        _logger.LogInformation("Remote command {CommandId} action {Action} completed with success={Success}.", commandId, action, ok);
        await SendJsonAsync(socket, new
        {
            type = "command_result",
            commandId,
            action,
            ok,
            detail,
            output = output.Length > 10_000 ? output[..10_000] : output
        }, ct);
    }

    private static async Task<(bool Ok, string Output, string Detail)> RunPowerShellAsync(string script, CancellationToken ct)
    {
        // This executes under the Windows service identity (normally LocalSystem).
        // It is intentionally gated by an explicit local opt-in during installation.
        var start = new ProcessStartInfo
        {
            FileName = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), "WindowsPowerShell", "v1.0", "powershell.exe"),
            Arguments = "-NoLogo -NoProfile -NonInteractive -ExecutionPolicy RemoteSigned -Command -",
            RedirectStandardInput = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
            CreateNoWindow = true
        };
        using var process = new Process { StartInfo = start };
        if (!process.Start()) return (false, "", "Could not start PowerShell.");

        await process.StandardInput.WriteAsync(script.AsMemory(), ct);
        process.StandardInput.Close();

        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
        timeout.CancelAfter(TimeSpan.FromSeconds(90));
        try
        {
            var stdoutTask = process.StandardOutput.ReadToEndAsync(timeout.Token);
            var stderrTask = process.StandardError.ReadToEndAsync(timeout.Token);
            await process.WaitForExitAsync(timeout.Token);
            var stdout = await stdoutTask;
            var stderr = await stderrTask;
            var combined = string.Join(Environment.NewLine, new[] { stdout, stderr }.Where(s => !string.IsNullOrWhiteSpace(s)));
            return (process.ExitCode == 0, combined.Length > 10_000 ? combined[..10_000] : combined, $"PowerShell exit code: {process.ExitCode}");
        }
        catch (OperationCanceledException)
        {
            try { process.Kill(entireProcessTree: true); } catch { }
            if (ct.IsCancellationRequested) throw;
            return (false, "", "PowerShell timed out after 90 seconds.");
        }
    }

    private static async Task SendJsonAsync(ClientWebSocket socket, object value, CancellationToken ct)
    {
        var bytes = JsonSerializer.SerializeToUtf8Bytes(value);
        await socket.SendAsync(new ArraySegment<byte>(bytes), WebSocketMessageType.Text, true, ct);
    }
}

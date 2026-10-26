using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace NexusControl.Agent.Windows;

/// <summary>
/// Lifecycle foundation only. No network listener or remote command execution is
/// enabled until the authenticated pairing/session protocol has been reviewed.
/// </summary>
public sealed class AgentWorker : BackgroundService
{
    private readonly ILogger<AgentWorker> _logger;

    public AgentWorker(ILogger<AgentWorker> logger)
    {
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _logger.LogInformation(
            "NEXUS Agent Windows started. Host={Host}; OS={OS}; Version={Version}",
            Environment.MachineName,
            Environment.OSVersion.VersionString,
            typeof(AgentWorker).Assembly.GetName().Version?.ToString() ?? "unknown");

        while (!stoppingToken.IsCancellationRequested)
        {
            // Intentionally idle until the shared authenticated protocol is implemented.
            // Never accept commands from the LAN or Internet in this foundation build.
            _logger.LogDebug("NEXUS Agent Windows heartbeat.");
            await Task.Delay(TimeSpan.FromMinutes(1), stoppingToken);
        }
    }

    public override async Task StopAsync(CancellationToken cancellationToken)
    {
        _logger.LogInformation("NEXUS Agent Windows is stopping.");
        await base.StopAsync(cancellationToken);
    }
}

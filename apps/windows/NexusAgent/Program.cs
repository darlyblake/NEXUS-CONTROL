using Microsoft.Extensions.Hosting;
using NexusControl.Agent.Windows;

var builder = Host.CreateApplicationBuilder(args);

builder.Services.AddWindowsService(options =>
{
    options.ServiceName = "NEXUS CONTROL Agent";
});

builder.Services.AddHostedService<AgentWorker>();

await builder.Build().RunAsync();

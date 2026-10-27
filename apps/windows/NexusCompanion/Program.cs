using System.Net.WebSockets;
using System.Drawing;
using System.Runtime.InteropServices;
using System.Text.Json;
using System.Text;
using Microsoft.Win32;
using System.Windows.Forms;

namespace NexusControl.Companion;

internal sealed record CompanionConfig(string RelayUrl, string DeviceId, string DeviceToken, string PairId);

internal static class Program
{
    [STAThread]
    private static void Main()
    {
        ApplicationConfiguration.Initialize();
        var configPath = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData),
            "NEXUS CONTROL", "Agent", "companion.json");
        if (!File.Exists(configPath))
        {
            MessageBox.Show("La configuration du compagnon NEXUS CONTROL est introuvable. Réinstalle ou réassocie l’agent depuis le PC local.",
                "NEXUS CONTROL", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            return;
        }
        CompanionConfig? config;
        try { config = JsonSerializer.Deserialize<CompanionConfig>(File.ReadAllText(configPath), new JsonSerializerOptions { PropertyNameCaseInsensitive = true }); }
        catch (Exception ex)
        {
            MessageBox.Show("Configuration invalide : " + ex.Message, "NEXUS CONTROL", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return;
        }
        if (config is null || !Uri.TryCreate(config.RelayUrl, UriKind.Absolute, out var relay) ||
            relay.Scheme != Uri.UriSchemeHttps || string.IsNullOrWhiteSpace(config.DeviceToken) ||
            string.IsNullOrWhiteSpace(config.DeviceId))
        {
            MessageBox.Show("Configuration distante invalide. Une URL HTTPS et un jeton compagnon sont requis.",
                "NEXUS CONTROL", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return;
        }
        using var app = new CompanionApplication(config);
        Application.Run(app);
    }
}

internal sealed class CompanionApplication : ApplicationContext
{
    private readonly CompanionConfig _config;
    private readonly Control _dispatcher = new Control();
    private readonly NotifyIcon _tray;
    private readonly System.Windows.Forms.Timer _reconnectTimer;
    private ClientWebSocket? _socket;
    private CancellationTokenSource? _connectionCts;
    private ControlStatusForm? _statusForm;
    private string? _activeControlId;
    private DateTimeOffset _lastInputAt = DateTimeOffset.MinValue;
    private bool _connecting;
    private bool _disposed;

    public CompanionApplication(CompanionConfig config)
    {
        _config = config;
        _ = _dispatcher.Handle;
        var menu = new ContextMenuStrip();
        menu.Items.Add("État du compagnon", null, (_, _) => ShowStatus());
        menu.Items.Add("Arrêter le contrôle distant", null, (_, _) => StopControl("Arrêt demandé depuis Windows."));
        menu.Items.Add("Quitter le compagnon", null, (_, _) => ExitThread());
        _tray = new NotifyIcon
        {
            Icon = System.Drawing.SystemIcons.Shield,
            Text = "NEXUS CONTROL — compagnon Windows",
            ContextMenuStrip = menu,
            Visible = true
        };
        _tray.DoubleClick += (_, _) => ShowStatus();
        SystemEvents.SessionSwitch += OnSessionSwitch;
        _reconnectTimer = new System.Windows.Forms.Timer { Interval = 3000 };
        _reconnectTimer.Tick += async (_, _) => await EnsureConnectedAsync();
        _reconnectTimer.Start();
        _ = EnsureConnectedAsync();
    }

    private void OnSessionSwitch(object? sender, SessionSwitchEventArgs e)
    {
        if (e.Reason is SessionSwitchReason.SessionLock or SessionSwitchReason.SessionLogoff or
            SessionSwitchReason.ConsoleDisconnect or SessionSwitchReason.RemoteDisconnect)
            StopControl("Contrôle arrêté : la session Windows a été verrouillée ou déconnectée.");
    }

    private void ShowStatus()
    {
        if (_statusForm is { IsDisposed: false }) { if (!_statusForm.Visible) _statusForm.Show(); _statusForm.Activate(); return; }
        _statusForm = new ControlStatusForm(() => StopControl("Arrêt demandé depuis le panneau Windows."));
        _statusForm.SetState(_activeControlId is null ? "Compagnon connecté — aucun contrôle actif" : "CONTRÔLE DISTANT ACTIF", _activeControlId is not null);
        _statusForm.Show();
    }

    private async Task EnsureConnectedAsync()
    {
        if (_disposed || _connecting || _socket?.State == WebSocketState.Open) return;
        _connecting = true;
        try
        {
            _connectionCts?.Cancel();
            _connectionCts?.Dispose();
            _connectionCts = new CancellationTokenSource();
            var uri = new UriBuilder(_config.RelayUrl) { Scheme = "wss", Path = "/ws", Query = "", Fragment = "" }.Uri;
            var socket = new ClientWebSocket();
            socket.Options.KeepAliveInterval = TimeSpan.FromSeconds(20);
            await socket.ConnectAsync(uri, _connectionCts.Token);
            await SendAsync(socket, new { type = "auth", deviceId = _config.DeviceId, token = _config.DeviceToken }, _connectionCts.Token);
            _socket?.Dispose();
            _socket = socket;
            _tray.Text = "NEXUS CONTROL — compagnon connecté";
            _ = ReceiveLoopAsync(socket, _connectionCts.Token);
        }
        catch
        {
            _tray.Text = "NEXUS CONTROL — reconnexion en attente";
        }
        finally { _connecting = false; }
    }

    private async Task ReceiveLoopAsync(ClientWebSocket socket, CancellationToken ct)
    {
        var buffer = new byte[16 * 1024];
        try
        {
            while (!ct.IsCancellationRequested && socket.State == WebSocketState.Open)
            {
                using var ms = new MemoryStream();
                WebSocketReceiveResult result;
                do
                {
                    result = await socket.ReceiveAsync(new ArraySegment<byte>(buffer), ct);
                    if (result.MessageType == WebSocketMessageType.Close) return;
                    if (result.MessageType != WebSocketMessageType.Text) throw new InvalidDataException("Unexpected binary data.");
                    ms.Write(buffer, 0, result.Count);
                    if (ms.Length > 64 * 1024) throw new InvalidDataException("Message too large.");
                } while (!result.EndOfMessage);
                using var doc = JsonDocument.Parse(ms.ToArray());
                var root = doc.RootElement;
                if (root.TryGetProperty("type", out var type) && type.GetString() == "command")
                    await HandleCommandAsync(socket, root, ct);
                else if (root.TryGetProperty("type", out type) && type.GetString() == "peer_status" &&
                         root.TryGetProperty("connected", out var connected) && !connected.GetBoolean())
                    StopControl("Contrôle arrêté : connexion distante perdue.");
            }
        }
        catch { }
        finally
        {
            if (ReferenceEquals(_socket, socket))
            {
                _socket = null;
                _tray.Text = "NEXUS CONTROL — connexion perdue";
                StopControl("Contrôle arrêté : connexion au relais perdue.");
            }
            socket.Dispose();
        }
    }

    private async Task HandleCommandAsync(ClientWebSocket socket, JsonElement root, CancellationToken ct)
    {
        var action = root.TryGetProperty("action", out var actionValue) ? actionValue.GetString() ?? "" : "";
        var commandId = root.TryGetProperty("commandId", out var idValue) ? idValue.GetString() ?? "" : "";
        var timestamp = root.TryGetProperty("timestamp", out var timeValue) && timeValue.TryGetInt64(out var stamp) ? stamp : 0;
        if (commandId.Length is < 1 or > 100 || Math.Abs(DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() - timestamp) > 60_000)
            return;

        if (action == "windows_control_request")
        {
            if (_activeControlId is not null)
            {
                await SendStatusAsync(socket, "control_session_error", "Une session de contrôle est déjà active.", null, ct);
                return;
            }
            await SendStatusAsync(socket, "control_session_pending", null, null, ct);
            var answer = await OnUiAsync(() => MessageBox.Show(
                "Une demande de contrôle souris/clavier a été reçue depuis NEXUS CONTROL.\n\n" +
                "Autoriser temporairement les clics, déplacements de souris, défilements et l’envoi de texte ?\n\n" +
                "L’indicateur Windows restera visible. Tu peux arrêter la session ici à tout moment.",
                "Autoriser le contrôle distant NEXUS CONTROL ?",
                MessageBoxButtons.YesNo, MessageBoxIcon.Question, MessageBoxDefaultButton.Button2));
            if (answer != DialogResult.Yes)
            {
                await SendStatusAsync(socket, "control_session_denied", "Autorisation refusée localement sur Windows.", null, ct);
                return;
            }
            _activeControlId = Guid.NewGuid().ToString("N");
            _lastInputAt = DateTimeOffset.MinValue;
            await OnUiAsync(() => { ShowStatus(); _statusForm?.SetState("CONTRÔLE DISTANT ACTIF — " + Environment.MachineName, true); _tray.Text = "NEXUS CONTROL — CONTRÔLE DISTANT ACTIF"; return true; });
            await SendStatusAsync(socket, "control_session_started", null, _activeControlId, ct);
            return;
        }

        if (action == "windows_control_stop")
        {
            StopControl("Arrêt demandé depuis Ubuntu.");
            return;
        }

        if (action != "windows_remote_input" || _activeControlId is null) return;
        if (!root.TryGetProperty("controlId", out var controlValue) ||
            !string.Equals(controlValue.GetString(), _activeControlId, StringComparison.Ordinal)) return;
        if (!root.TryGetProperty("input", out var input) || !input.TryGetProperty("action", out var inputActionValue)) return;
        var inputAction = inputActionValue.GetString() ?? "";
        var now = DateTimeOffset.UtcNow;
        if (now - _lastInputAt < TimeSpan.FromMilliseconds(8)) return;
        _lastInputAt = now;
        try
        {
            switch (inputAction)
            {
                case "mouse_move":
                case "mouse_click":
                    if (!input.TryGetProperty("x", out var xValue) || !xValue.TryGetDouble(out var x) ||
                        !input.TryGetProperty("y", out var yValue) || !yValue.TryGetDouble(out var y) ||
                        x is < 0 or > 1 || y is < 0 or > 1) return;
                    var bounds = SystemInformation.VirtualScreen;
                    var px = bounds.Left + (int)Math.Round(x * Math.Max(0, bounds.Width - 1));
                    var py = bounds.Top + (int)Math.Round(y * Math.Max(0, bounds.Height - 1));
                    InputNative.MoveMouse(px, py, bounds);
                    if (inputAction == "mouse_click")
                    {
                        var button = input.TryGetProperty("button", out var buttonValue) ? buttonValue.GetString() : "left";
                        if (button == "right") InputNative.RightClick(); else InputNative.LeftClick();
                    }
                    break;
                case "mouse_scroll":
                    var dx = input.TryGetProperty("deltaX", out var dxValue) && dxValue.TryGetInt32(out var dxRead) ? Math.Clamp(dxRead, -1200, 1200) : 0;
                    var dy = input.TryGetProperty("deltaY", out var dyValue) && dyValue.TryGetInt32(out var dyRead) ? Math.Clamp(dyRead, -1200, 1200) : 0;
                    InputNative.Scroll(dx, dy);
                    break;
                case "keyboard_text":
                    if (!input.TryGetProperty("text", out var textValue)) return;
                    var text = textValue.GetString() ?? "";
                    if (text.Length > 2000) return;
                    InputNative.TypeText(text);
                    break;
            }
        }
        catch (Exception ex)
        {
            _tray.Text = "NEXUS CONTROL — erreur d’entrée : " + ex.Message[..Math.Min(50, ex.Message.Length)];
        }
    }

    private async Task SendStatusAsync(ClientWebSocket socket, string type, string? message, string? controlId, CancellationToken ct)
    {
        await SendAsync(socket, new { type, message, controlId, pairId = _config.PairId }, ct);
    }

    private void StopControl(string reason)
    {
        if (_dispatcher.InvokeRequired)
        {
            try { _dispatcher.BeginInvoke(new Action(() => StopControl(reason))); } catch { }
            return;
        }
        var hadSession = _activeControlId is not null;
        _activeControlId = null;
        if (_statusForm is { IsDisposed: false }) _statusForm.SetState("Compagnon connecté — aucun contrôle actif", false);
        _tray.Text = "NEXUS CONTROL — aucun contrôle actif";
        if (hadSession && _socket?.State == WebSocketState.Open)
            _ = SendStatusAsync(_socket, "control_session_stopped", reason, null, CancellationToken.None);
    }

    private Task<T> OnUiAsync<T>(Func<T> action)
    {
        if (!_dispatcher.InvokeRequired) return Task.FromResult(action());
        var completion = new TaskCompletionSource<T>(TaskCreationOptions.RunContinuationsAsynchronously);
        try
        {
            _dispatcher.BeginInvoke(new Action(() =>
            {
                try { completion.SetResult(action()); }
                catch (Exception ex) { completion.SetException(ex); }
            }));
        }
        catch (Exception ex) { completion.SetException(ex); }
        return completion.Task;
    }

    private static async Task SendAsync(ClientWebSocket socket, object value, CancellationToken ct)
    {
        var bytes = JsonSerializer.SerializeToUtf8Bytes(value);
        await socket.SendAsync(new ArraySegment<byte>(bytes), WebSocketMessageType.Text, true, ct);
    }

    protected override void ExitThreadCore()
    {
        _disposed = true;
        StopControl("Compagnon fermé localement.");
        _reconnectTimer.Stop();
        _reconnectTimer.Dispose();
        SystemEvents.SessionSwitch -= OnSessionSwitch;
        _connectionCts?.Cancel();
        _connectionCts?.Dispose();
        _socket?.Abort();
        _socket?.Dispose();
        _tray.Visible = false;
        _tray.Dispose();
        _statusForm?.Close();
        base.ExitThreadCore();
    }
}

internal sealed class ControlStatusForm : Form
{
    private readonly Label _label;
    private readonly Button _stop;
    private bool _active;

    public ControlStatusForm(Action stop)
    {
        Text = "NEXUS CONTROL — état du contrôle distant";
        TopMost = true;
        ShowInTaskbar = true;
        StartPosition = FormStartPosition.Manual;
        Location = new Point(Math.Max(0, Screen.PrimaryScreen!.WorkingArea.Right - 390), Math.Max(0, Screen.PrimaryScreen.WorkingArea.Top + 30));
        Size = new Size(360, 118);
        FormBorderStyle = FormBorderStyle.FixedToolWindow;
        _label = new Label { Dock = DockStyle.Top, Height = 48, TextAlign = ContentAlignment.MiddleLeft, Padding = new Padding(12), Font = new Font("Segoe UI", 9, FontStyle.Bold) };
        _stop = new Button { Dock = DockStyle.Bottom, Height = 34, Text = "Arrêter le contrôle distant", BackColor = Color.Firebrick, ForeColor = Color.White, FlatStyle = FlatStyle.Flat };
        _stop.Click += (_, _) => stop();
        Controls.Add(_stop);
        Controls.Add(_label);
        FormClosing += (_, e) => { if (e.CloseReason == CloseReason.UserClosing) { e.Cancel = true; if (!_active) Hide(); } };
    }

    public void SetState(string text, bool active)
    {
        if (InvokeRequired) { BeginInvoke(new Action(() => SetState(text, active))); return; }
        _active = active;
        _label.Text = text;
        BackColor = active ? Color.MistyRose : SystemColors.Control;
        _stop.Enabled = active;
        if (active && !Visible) Show();
    }
}

internal static class InputNative
{
    private const uint INPUT_MOUSE = 0;
    private const uint INPUT_KEYBOARD = 1;
    private const uint MOUSEEVENTF_MOVE = 0x0001;
    private const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
    private const uint MOUSEEVENTF_LEFTUP = 0x0004;
    private const uint MOUSEEVENTF_RIGHTDOWN = 0x0008;
    private const uint MOUSEEVENTF_RIGHTUP = 0x0010;
    private const uint MOUSEEVENTF_WHEEL = 0x0800;
    private const uint MOUSEEVENTF_HWHEEL = 0x1000;
    private const uint MOUSEEVENTF_ABSOLUTE = 0x8000;
    private const uint MOUSEEVENTF_VIRTUALDESK = 0x4000;
    private const uint KEYEVENTF_KEYUP = 0x0002;
    private const uint KEYEVENTF_UNICODE = 0x0004;

    [StructLayout(LayoutKind.Sequential)] private struct INPUT { public uint type; public INPUTUNION U; }
    [StructLayout(LayoutKind.Explicit)] private struct INPUTUNION { [FieldOffset(0)] public MOUSEINPUT mi; [FieldOffset(0)] public KEYBDINPUT ki; }
    [StructLayout(LayoutKind.Sequential)] private struct MOUSEINPUT { public int dx, dy; public uint mouseData, dwFlags, time; public IntPtr dwExtraInfo; }
    [StructLayout(LayoutKind.Sequential)] private struct KEYBDINPUT { public ushort wVk, wScan; public uint dwFlags, time; public IntPtr dwExtraInfo; }

    [DllImport("user32.dll", SetLastError = true)] private static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);
    private static void Send(params INPUT[] inputs)
    {
        if (SendInput((uint)inputs.Length, inputs, Marshal.SizeOf<INPUT>()) != (uint)inputs.Length)
            throw new InvalidOperationException("Windows a refusé l’événement d’entrée (droits ou session protégée).");
    }

    public static void MoveMouse(int x, int y, Rectangle bounds)
    {
        var nx = bounds.Width <= 1 ? 0 : (int)Math.Round((x - bounds.Left) * 65535d / (bounds.Width - 1));
        var ny = bounds.Height <= 1 ? 0 : (int)Math.Round((y - bounds.Top) * 65535d / (bounds.Height - 1));
        Send(new INPUT { type = INPUT_MOUSE, U = new INPUTUNION { mi = new MOUSEINPUT { dx = nx, dy = ny, dwFlags = MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_VIRTUALDESK } } });
    }
    public static void LeftClick() => Send(
        new INPUT { type = INPUT_MOUSE, U = new INPUTUNION { mi = new MOUSEINPUT { dwFlags = MOUSEEVENTF_LEFTDOWN } } },
        new INPUT { type = INPUT_MOUSE, U = new INPUTUNION { mi = new MOUSEINPUT { dwFlags = MOUSEEVENTF_LEFTUP } } });
    public static void RightClick() => Send(
        new INPUT { type = INPUT_MOUSE, U = new INPUTUNION { mi = new MOUSEINPUT { dwFlags = MOUSEEVENTF_RIGHTDOWN } } },
        new INPUT { type = INPUT_MOUSE, U = new INPUTUNION { mi = new MOUSEINPUT { dwFlags = MOUSEEVENTF_RIGHTUP } } });
    public static void Scroll(int horizontal, int vertical)
    {
        var list = new List<INPUT>();
        if (vertical != 0) list.Add(new INPUT { type = INPUT_MOUSE, U = new INPUTUNION { mi = new MOUSEINPUT { mouseData = unchecked((uint)vertical), dwFlags = MOUSEEVENTF_WHEEL } } });
        if (horizontal != 0) list.Add(new INPUT { type = INPUT_MOUSE, U = new INPUTUNION { mi = new MOUSEINPUT { mouseData = unchecked((uint)horizontal), dwFlags = MOUSEEVENTF_HWHEEL } } });
        if (list.Count > 0) Send(list.ToArray());
    }
    public static void TypeText(string text)
    {
        foreach (var rune in text.EnumerateRunes())
        {
            var units = rune.ToString();
            foreach (var ch in units)
            {
                Send(
                    new INPUT { type = INPUT_KEYBOARD, U = new INPUTUNION { ki = new KEYBDINPUT { wScan = ch, dwFlags = KEYEVENTF_UNICODE } } },
                    new INPUT { type = INPUT_KEYBOARD, U = new INPUTUNION { ki = new KEYBDINPUT { wScan = ch, dwFlags = KEYEVENTF_UNICODE | KEYEVENTF_KEYUP } } });
            }
        }
    }
}

using System.Diagnostics;
using System.IO;
using System.Text.Json;
using System.Windows;
using System.Windows.Input;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.Wpf;
using Windows.Media;
using Windows.Media.Control;
using Windows.Storage.Streams;

namespace Groove.Windows;

internal static class Program
{
    [STAThread]
    public static void Main()
    {
        var app = new Application();
        app.Run(new PlayerWindow());
    }
}

internal sealed class PlayerWindow : Window
{
    private const string Origin = "https://groove.local";
    private readonly WebView2 view = new();
    private readonly string dataPath = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Groove");
    private readonly SemaphoreSlim gate = new(1, 1);
    private GlobalSystemMediaTransportControlsSessionManager? manager;
    private GlobalSystemMediaTransportControlsSession? watched;
    private GlobalSystemMediaTransportControlsSessionMediaProperties? media;
    private bool dirty = true;
    private string? image;
    private string selected = "";
    private bool remember = true;
    private readonly JsonSerializerOptions json = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };

    public PlayerWindow()
    {
        Title = "Groove — Windows media player";
        Width = 390; Height = 730; MinWidth = 340; MinHeight = 170;
        WindowStartupLocation = WindowStartupLocation.CenterScreen;
        Background = System.Windows.Media.Brushes.Transparent;
        Content = view;
        Directory.CreateDirectory(dataPath);
        try
        {
            var path = Path.Combine(dataPath, "window.json");
            if (File.Exists(path))
            {
                var prefs = JsonSerializer.Deserialize<WindowPreferences>(File.ReadAllText(path));
                if (prefs is { Remember: true })
                {
                    Topmost = prefs.Topmost;
                    // Restore only positions that remain on the current virtual desktop.
                    if (prefs.Left >= SystemParameters.VirtualScreenLeft && prefs.Top >= SystemParameters.VirtualScreenTop &&
                        prefs.Left + 100 < SystemParameters.VirtualScreenLeft + SystemParameters.VirtualScreenWidth &&
                        prefs.Top + 100 < SystemParameters.VirtualScreenTop + SystemParameters.VirtualScreenHeight)
                    { Left = prefs.Left; Top = prefs.Top; WindowStartupLocation = WindowStartupLocation.Manual; }
                }
            }
        }
        catch (Exception ex) { Trace.WriteLine($"Window preferences could not be restored: {ex.Message}"); }
        Loaded += Initialize;
        Closed += (_, _) => { if (watched != null) watched.MediaPropertiesChanged -= MediaChanged; view.Dispose(); };
        Closing += (_, _) =>
        {
            try { File.WriteAllText(Path.Combine(dataPath, "window.json"), JsonSerializer.Serialize(new WindowPreferences(remember, Topmost, Left, Top))); }
            catch (Exception ex) { Trace.WriteLine($"Window preferences could not be saved: {ex.Message}"); }
        };
    }

    private async void Initialize(object sender, RoutedEventArgs e)
    {
        try
        {
            var assets = Path.Combine(AppContext.BaseDirectory, "wwwroot");
            if (!File.Exists(Path.Combine(assets, "index.html"))) throw new InvalidOperationException("Player files are missing. Build the web app before publishing Groove. See desktop/README.md.");
            manager = await GlobalSystemMediaTransportControlsSessionManager.RequestAsync();
            var environment = await CoreWebView2Environment.CreateAsync(null, Path.Combine(dataPath, "WebView"));
            await view.EnsureCoreWebView2Async(environment);
            view.CoreWebView2.SetVirtualHostNameToFolderMapping("groove.local", assets, CoreWebView2HostResourceAccessKind.DenyCors);
            view.CoreWebView2.Settings.AreDevToolsEnabled = false;
            view.CoreWebView2.Settings.AreDefaultContextMenusEnabled = false;
            view.CoreWebView2.Settings.IsStatusBarEnabled = false;
            await view.CoreWebView2.AddScriptToExecuteOnDocumentCreatedAsync("if (location.origin === 'https://groove.local') Object.defineProperty(window, '__GROOVE_DESKTOP__', { value: true });");
            view.CoreWebView2.NavigationStarting += (_, args) => { if (!IsLocal(args.Uri)) { args.Cancel = true; OpenExternal(args.Uri); } };
            view.CoreWebView2.NewWindowRequested += (_, args) => { args.Handled = true; OpenExternal(args.Uri); };
            view.CoreWebView2.WebMessageReceived += Message;
            view.CoreWebView2.NavigationCompleted += (_, args) =>
            {
                if (!args.IsSuccess)
                    MessageBox.Show(this, "Groove could not load its bundled player screen (" + args.WebErrorStatus + ").\n\nExtract the entire download to a new folder and keep wwwroot next to Groove.exe. No internet connection is needed to load the player.", "Groove — player load error", MessageBoxButton.OK, MessageBoxImage.Error);
            };
            // Virtual folder mappings do not provide a web server's default document resolution.
            // Navigating to '/' targets the directory itself and can return ERR_ACCESS_DENIED.
            view.Source = new Uri(Origin + "/index.html");
        }
        catch (Exception ex)
        {
            MessageBox.Show(this, "Groove could not start. Windows 10 (1809+) / 11 and Microsoft Edge WebView2 Runtime are required.\n\n" + ex.Message, "Groove", MessageBoxButton.OK, MessageBoxImage.Error);
            Close();
        }
    }

    private static bool IsLocal(string uri) => Uri.TryCreate(uri, UriKind.Absolute, out var parsed) && parsed.GetLeftPart(UriPartial.Authority) == Origin;
    private static void OpenExternal(string uri)
    {
        if (!Uri.TryCreate(uri, UriKind.Absolute, out var parsed) || parsed.Scheme != "https") return;
        try { Process.Start(new ProcessStartInfo(parsed.AbsoluteUri) { UseShellExecute = true }); }
        catch (Exception ex) { Trace.WriteLine($"External link could not open: {ex.Message}"); }
    }
    private void MediaChanged(GlobalSystemMediaTransportControlsSession sender, MediaPropertiesChangedEventArgs args) => dirty = true;
    private GlobalSystemMediaTransportControlsSession? Session() => selected.Length == 0 ? manager?.GetCurrentSession() : manager?.GetSessions().FirstOrDefault(s => s.SourceAppUserModelId == selected);

    private async Task<object> Snapshot()
    {
        var session = Session();
        if (session != watched)
        {
            if (watched != null) watched.MediaPropertiesChanged -= MediaChanged;
            watched = session; media = null; image = null; dirty = true;
            if (watched != null) watched.MediaPropertiesChanged += MediaChanged;
        }
        var sessions = manager!.GetSessions().Select(s => new { id = s.SourceAppUserModelId, name = s.SourceAppUserModelId }).ToArray();
        if (session == null) return new { playback = (object?)null, sessions, selected, topmost = Topmost };
        if (dirty || media == null)
        {
            dirty = false;
            try
            {
                media = await session.TryGetMediaPropertiesAsync();
                image = null;
                if (media.Thumbnail != null)
                {
                    using var stream = await media.Thumbnail.OpenReadAsync();
                    if (stream.Size is > 0 and <= 8388608 && new[] { "image/jpeg", "image/png", "image/webp", "image/bmp" }.Contains(stream.ContentType))
                    {
                        using var reader = new DataReader(stream);
                        await reader.LoadAsync((uint)stream.Size);
                        var bytes = new byte[(int)stream.Size]; reader.ReadBytes(bytes);
                        image = $"data:{stream.ContentType};base64,{Convert.ToBase64String(bytes)}";
                    }
                }
            }
            catch { dirty = true; throw; }
        }
        var info = session.GetPlaybackInfo();
        var controls = info.Controls;
        var timeline = session.GetTimelineProperties();
        var playing = info.PlaybackStatus == GlobalSystemMediaTransportControlsSessionPlaybackStatus.Playing;
        var duration = Math.Max(0, (timeline.EndTime - timeline.StartTime).TotalMilliseconds);
        var elapsed = playing ? Math.Max(0, (DateTimeOffset.UtcNow - timeline.LastUpdatedTime).TotalMilliseconds) * (info.PlaybackRate ?? 1) : 0;
        var position = Math.Clamp((timeline.Position - timeline.StartTime).TotalMilliseconds + elapsed, 0, duration);
        var key = session.SourceAppUserModelId + ":" + media!.Title + ":" + media.Artist + ":" + media.AlbumTitle;
        var repeat = info.AutoRepeatMode == MediaPlaybackAutoRepeatMode.Track ? "track" : info.AutoRepeatMode == MediaPlaybackAutoRepeatMode.List ? "context" : "off";
        var playback = new
        {
            item = new { id = key, uri = key, name = string.IsNullOrWhiteSpace(media.Title) ? "Untitled media" : media.Title, type = "track", duration_ms = duration,
                artists = new[] { new { name = string.IsNullOrWhiteSpace(media.Artist) ? session.SourceAppUserModelId : media.Artist } },
                album = new { name = media.AlbumTitle, images = image == null ? Array.Empty<object>() : new object[] { new { url = image } } } },
            is_playing = playing, progress_ms = position, shuffle_state = info.IsShuffleActive ?? false, repeat_state = repeat,
            device = new { id = session.SourceAppUserModelId, name = session.SourceAppUserModelId, volume_percent = (int?)null, is_restricted = false, supports_volume = false },
            actions = new { disallows = new Dictionary<string, bool> {
                ["pausing"] = !controls.IsPauseEnabled && !controls.IsPlayPauseToggleEnabled,
                ["resuming"] = !controls.IsPlayEnabled && !controls.IsPlayPauseToggleEnabled,
                ["skipping_next"] = !controls.IsNextEnabled, ["skipping_prev"] = !controls.IsPreviousEnabled,
                ["seeking"] = !controls.IsPlaybackPositionEnabled || duration <= 0,
                ["toggling_shuffle"] = !controls.IsShuffleEnabled,
                ["toggling_repeat_context"] = !controls.IsRepeatEnabled, ["toggling_repeat_track"] = !controls.IsRepeatEnabled } }
        };
        return new { playback, sessions, selected, topmost = Topmost };
    }

    private async void Message(object? sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        if (!IsLocal(e.Source)) return;
        string? id = null;
        await gate.WaitAsync();
        try
        {
            using var document = JsonDocument.Parse(e.WebMessageAsJson);
            var root = document.RootElement;
            id = root.GetProperty("id").GetString();
            var command = root.GetProperty("command").GetString();
            var args = root.GetProperty("args");
            object? result = null;
            switch (command)
            {
                case "snapshot": result = await Snapshot(); break;
                case "select":
                    var source = args.GetProperty("source").GetString() ?? "";
                    if (source.Length > 0 && !manager!.GetSessions().Any(s => s.SourceAppUserModelId == source)) throw new InvalidOperationException("That media app is no longer available.");
                    selected = source; result = await Snapshot(); break;
                case "topmost": Topmost = args.GetProperty("enabled").GetBoolean(); break;
                case "windowMode":
                    remember = args.GetProperty("remember").GetBoolean();
                    var scale = Math.Clamp(args.GetProperty("scale").GetDouble(), .8, 1.15);
                    var mode = args.GetProperty("mode").GetString();
                    Width = (mode == "expanded" ? 470 : 390) * scale;
                    Height = Math.Min(SystemParameters.WorkArea.Height, (mode == "mini" ? 220 : mode == "expanded" ? 850 : 740) * scale);
                    break;
                case "drag": if (Mouse.LeftButton == MouseButtonState.Pressed) DragMove(); break;
                default:
                    var session = Session() ?? throw new InvalidOperationException("Start media in an app that supports Windows media controls first.");
                    if (args.GetProperty("source").GetString() != session.SourceAppUserModelId) throw new InvalidOperationException("The active media app changed. Try again.");
                    var info = session.GetPlaybackInfo(); var c = info.Controls;
                    bool accepted;
                    switch (command)
                    {
                        case "play" when c.IsPlayEnabled: accepted = await session.TryPlayAsync(); break;
                        case "pause" when c.IsPauseEnabled: accepted = await session.TryPauseAsync(); break;
                        case "play" or "pause" when c.IsPlayPauseToggleEnabled: accepted = await session.TryTogglePlayPauseAsync(); break;
                        case "next" when c.IsNextEnabled: accepted = await session.TrySkipNextAsync(); break;
                        case "previous" when c.IsPreviousEnabled: accepted = await session.TrySkipPreviousAsync(); break;
                        case "seek" when c.IsPlaybackPositionEnabled:
                            var t = session.GetTimelineProperties();
                            var ms = args.GetProperty("position").GetDouble();
                            if (!double.IsFinite(ms) || ms < 0 || ms > (t.EndTime - t.StartTime).TotalMilliseconds) throw new InvalidOperationException("Seek position is outside this track.");
                            accepted = await session.TryChangePlaybackPositionAsync(t.StartTime.Ticks + TimeSpan.FromMilliseconds(ms).Ticks); break;
                        case "shuffle" when c.IsShuffleEnabled: accepted = await session.TryChangeShuffleActiveAsync(args.GetProperty("enabled").GetBoolean()); break;
                        case "repeat" when c.IsRepeatEnabled:
                            var repeat = args.GetProperty("mode").GetString();
                            accepted = await session.TryChangeAutoRepeatModeAsync(repeat == "track" ? MediaPlaybackAutoRepeatMode.Track : repeat == "context" ? MediaPlaybackAutoRepeatMode.List : MediaPlaybackAutoRepeatMode.None); break;
                        default: throw new InvalidOperationException("This media app does not support that control.");
                    }
                    if (!accepted) throw new InvalidOperationException("The media app declined this action. Its controls may be temporarily unavailable.");
                    break;
            }
            view.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(new { id, ok = true, data = result }, json));
        }
        catch (Exception ex)
        {
            if (view.CoreWebView2 != null) view.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(new { id, ok = false, error = ex.Message }, json));
        }
        finally { gate.Release(); }
    }
    private sealed record WindowPreferences(bool Remember, bool Topmost, double Left, double Top);
}

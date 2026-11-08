using System;
using System.Diagnostics;
using System.IO;
using System.Text;

// GUI 子系统负责从登录任务启动 PowerShell，避免先创建再隐藏终端。
internal static class QuietTunnelLauncher
{
    [STAThread]
    private static int Main(string[] args)
    {
        if (args.Length == 0 || !Path.IsPathRooted(args[0]) || !File.Exists(args[0]) ||
            !string.Equals(Path.GetExtension(args[0]), ".ps1", StringComparison.OrdinalIgnoreCase)) return 2;
        try {
            string powershell = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Windows),
                @"System32\WindowsPowerShell\v1.0\powershell.exe");
            var command = new StringBuilder("-NoProfile -NonInteractive -ExecutionPolicy RemoteSigned -File");
            foreach (string arg in args) command.Append(' ').Append(Quote(arg));
            var start = new ProcessStartInfo(powershell, command.ToString()) {
                WorkingDirectory = Path.GetDirectoryName(args[0]),
                UseShellExecute = false, CreateNoWindow = true,
                RedirectStandardOutput = true, RedirectStandardError = true
            };
            using (var job = new KeepliveProcessJob())
            using (var worker = Process.Start(start)) {
                try {
                    job.Attach(worker.Handle);
                    worker.OutputDataReceived += delegate { };
                    worker.ErrorDataReceived += delegate { };
                    worker.BeginOutputReadLine(); worker.BeginErrorReadLine();
                    worker.WaitForExit();
                    return worker.ExitCode;
                } finally {
                    // Attach 失败时 Job 尚未拥有进程，必须直接回收工作进程。
                    if (!worker.HasExited) { worker.Kill(); worker.WaitForExit(); }
                }
            }
        } catch { return 1; }
    }

    private static string Quote(string value)
    {
        var result = new StringBuilder("\"");
        int slashes = 0;
        foreach (char ch in value) {
            if (ch == '\\') { slashes++; continue; }
            if (ch == '"') result.Append('\\', slashes * 2 + 1).Append(ch);
            else result.Append('\\', slashes).Append(ch);
            slashes = 0;
        }
        return result.Append('\\', slashes * 2).Append('"').ToString();
    }
}

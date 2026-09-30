param([Parameter(Mandatory=$true)][string]$Configuration)
$ErrorActionPreference = 'Stop'
$config = Get-Content -LiteralPath $Configuration -Raw | ConvertFrom-Json

# The gate starts no descendants until assignment. Jobs retain ownership after pnpm exits.
# https://learn.microsoft.com/windows/win32/procthread/job-objects
Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;

public sealed class TestJob : IDisposable {
    [StructLayout(LayoutKind.Sequential)] struct BasicLimits {
        public long PerProcessTime, PerJobTime;
        public uint Flags;
        public UIntPtr MinWorkingSet, MaxWorkingSet;
        public uint ActiveProcessLimit;
        public UIntPtr Affinity;
        public uint PriorityClass, SchedulingClass;
    }
    [StructLayout(LayoutKind.Sequential)] struct IoCounters {
        public ulong ReadOperations, WriteOperations, OtherOperations, ReadBytes, WriteBytes, OtherBytes;
    }
    [StructLayout(LayoutKind.Sequential)] struct ExtendedLimits {
        public BasicLimits Basic;
        public IoCounters Io;
        public UIntPtr ProcessMemory, JobMemory, PeakProcessMemory, PeakJobMemory;
    }
    [StructLayout(LayoutKind.Sequential)] struct Accounting {
        public long UserTime, KernelTime, PeriodUserTime, PeriodKernelTime;
        public uint PageFaults, TotalProcesses, ActiveProcesses, TerminatedProcesses;
    }
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
    static extern IntPtr CreateJobObject(IntPtr attributes, string name);
    [DllImport("kernel32.dll", SetLastError=true)]
    static extern bool SetInformationJobObject(IntPtr job, int kind, ref ExtendedLimits limits, uint size);
    [DllImport("kernel32.dll", SetLastError=true)]
    static extern bool QueryInformationJobObject(IntPtr job, int kind, out Accounting data, uint size, IntPtr returned);
    [DllImport("kernel32.dll", SetLastError=true)]
    static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
    [DllImport("kernel32.dll", SetLastError=true)]
    static extern bool TerminateJobObject(IntPtr job, uint code);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
    IntPtr handle;
    public TestJob() {
        handle = CreateJobObject(IntPtr.Zero, null);
        if (handle == IntPtr.Zero) throw new Win32Exception();
        var limits = new ExtendedLimits();
        limits.Basic.Flags = 0x2000; // JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE; no breakaway.
        if (!SetInformationJobObject(handle, 9, ref limits, (uint)Marshal.SizeOf(typeof(ExtendedLimits)))) {
            var error = new Win32Exception(); Dispose(); throw error;
        }
    }
    public void Assign(IntPtr process) {
        if (!AssignProcessToJobObject(handle, process)) throw new Win32Exception();
    }
    public void Stop() {
        if (!TerminateJobObject(handle, 1)) throw new Win32Exception();
    }
    public uint Active {
        get {
            Accounting data;
            if (!QueryInformationJobObject(handle, 1, out data, (uint)Marshal.SizeOf(typeof(Accounting)), IntPtr.Zero)) throw new Win32Exception();
            return data.ActiveProcesses;
        }
    }
    public void Dispose() {
        if (handle != IntPtr.Zero) { CloseHandle(handle); handle = IntPtr.Zero; }
    }
    public static string Quote(string value) {
        var output = new StringBuilder("\"");
        int slashes = 0;
        foreach (char c in value) {
            if (c == '\\') { slashes++; continue; }
            if (c == '"') { output.Append('\\', slashes * 2 + 1); output.Append(c); }
            else { output.Append('\\', slashes); output.Append(c); }
            slashes = 0;
        }
        output.Append('\\', slashes * 2); output.Append('"'); return output.ToString();
    }
}
'@

$job = $null
$gate = $null
$owner = $null
$assigned = $false
$stopped = $false
$code = 1
try {
    $job = New-Object TestJob
    $owner = [System.Diagnostics.Process]::GetProcessById([int]$config.ownerPid)
    # Open and retain the process handle before starting the command; do not poll a reusable PID.
    $null = $owner.Handle
    if ($owner.HasExited -or (Test-Path -LiteralPath $config.cancelFile)) {
        $code = 143
    } else {
        $info = New-Object System.Diagnostics.ProcessStartInfo
        $info.FileName = $config.node
        $info.Arguments = [TestJob]::Quote($config.bootstrap) + ' ' + [TestJob]::Quote($Configuration)
        $info.UseShellExecute = $false
        $info.RedirectStandardInput = $true
        $info.CreateNoWindow = $true
        $gate = [System.Diagnostics.Process]::Start($info)
        $job.Assign($gate.Handle)
        $assigned = $true
        $gate.StandardInput.WriteLine('start')
        $gate.StandardInput.Close()
        while (-not $owner.HasExited -and -not $gate.HasExited -and
            -not (Test-Path -LiteralPath $config.cancelFile) -and
            -not (Test-Path -LiteralPath $config.resultFile)) {
            Start-Sleep -Milliseconds 20
        }
        if ($owner.HasExited -or (Test-Path -LiteralPath $config.cancelFile)) { $code = 143 }
        elseif (Test-Path -LiteralPath $config.resultFile) {
            # The marker can be observed during its write; wait for the gate to finish publishing it.
            $result = $null
            for ($attempt = 0; $attempt -lt 50 -and $null -eq $result; $attempt++) {
                try { $result = Get-Content -LiteralPath $config.resultFile -Raw | ConvertFrom-Json }
                catch { Start-Sleep -Milliseconds 20 }
            }
            if ($null -eq $result) { throw 'Missing complete test exit status' }
            $code = [int]$result.code
        }
    }
} finally {
    try {
        if ($assigned) {
            $job.Stop()
            $deadline = [System.Diagnostics.Stopwatch]::StartNew()
            while ($job.Active -ne 0 -and $deadline.ElapsedMilliseconds -lt 3000) { Start-Sleep -Milliseconds 20 }
            if ($job.Active -ne 0) { throw 'Owned Windows test job did not stop' }
        } elseif ($null -ne $gate -and -not $gate.HasExited) {
            # Assignment failed before the bootstrap received permission to spawn anything.
            $gate.Kill()
            if (-not $gate.WaitForExit(3000)) { throw 'Unassigned test bootstrap did not stop' }
        }
        $stopped = $true
    } finally {
        if ($null -ne $job) { $job.Dispose() }
        if ($null -ne $gate) { $gate.Dispose() }
        if ($null -ne $owner) { $owner.Dispose() }
    }
    if ($stopped) { Remove-Item -LiteralPath $config.directory -Recurse -Force }
}
exit $code

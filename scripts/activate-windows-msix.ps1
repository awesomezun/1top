param([Parameter(Mandatory)][string]$AppId, [string]$LaunchArguments = '')
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
[ComImport, Guid("2e941141-7f97-4756-ba1d-9decde894a3d"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IApplicationActivationManager {
    [PreserveSig] int ActivateApplication([MarshalAs(UnmanagedType.LPWStr)] string appId,
        [MarshalAs(UnmanagedType.LPWStr)] string arguments, uint options, out uint processId);
    [PreserveSig] int ActivateForFile(IntPtr appId, IntPtr items, IntPtr verb, out uint processId);
    [PreserveSig] int ActivateForProtocol(IntPtr appId, IntPtr items, out uint processId);
}
public static class OneTopActivation {
    public static uint Launch(string appId, string arguments) {
        var type = Type.GetTypeFromCLSID(new Guid("45BA127D-10A8-46EA-8AB7-56EA9078943C"));
        var manager = (IApplicationActivationManager)Activator.CreateInstance(type);
        try {
            uint pid;
            int result = manager.ActivateApplication(appId, arguments, 0, out pid);
            Marshal.ThrowExceptionForHR(result);
            return pid;
        } finally { Marshal.ReleaseComObject(manager); }
    }
}
'@
[OneTopActivation]::Launch($AppId, $LaunchArguments)

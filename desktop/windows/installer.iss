#ifndef AppVersion
  #define AppVersion "3.0.0"
#endif
[Setup]
AppId={{5645D56E-3CEB-4C67-A1C2-42043DE2F8B1}
AppName=1top
AppVersion={#AppVersion}
AppPublisher=1top
AppPublisherURL=https://1top.si
DefaultDirName={localappdata}\Programs\1top
DefaultGroupName=1top
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir=..\..\release\v{#AppVersion}
OutputBaseFilename=1top-{#AppVersion}-windows-x64-setup
SetupIconFile=..\..\build\windows\1top.ico
UninstallDisplayIcon={app}\1top.exe
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
CloseApplications=yes
RestartApplications=no
LicenseFile=..\..\LICENSE

[Files]
Source: "..\..\build\windows\dist\1top\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\1top"; Filename: "{app}\1top.exe"
Name: "{autodesktop}\1top"; Filename: "{app}\1top.exe"; Tasks: desktopicon

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; Flags: unchecked

[Run]
Filename: "{app}\1top.exe"; Description: "Open 1top"; Flags: nowait postinstall skipifsilent

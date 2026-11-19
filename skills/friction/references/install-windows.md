# Installing and running Friction on Windows

Verified 2026-11-08 against the GitHub release `v1.0.0-rc.3`, the download page
(https://friction.graphics/download.html), `src/app/friction.iss` (Inno Setup script) and
`src/core/appsupport.cpp`.

## Downloads (v1.0.0-rc.3, 31 Dec 2025)

From https://github.com/friction2d/friction/releases/tag/v1.0.0-rc.3 or the download page:

| File | What |
|------|------|
| `friction-1.0.0-rc.3-setup-win64.exe` (~28 MB) | Installer |
| `friction-1.0.0-rc.3-windows-x64.7z` (~26 MB) | Portable archive ("Portable Version" on the site) |
| `*.sha256`, `*.sig` | Checksum and PGP signature (key at https://friction.graphics/public.key) |

A "Development snapshot" build from `main` is also linked on the download page. Projects
saved by a snapshot may not open in rc.3 (see project-files.md).

Verify a download in PowerShell:

```powershell
Get-FileHash .\friction-1.0.0-rc.3-setup-win64.exe -Algorithm SHA256
Get-Content .\friction-1.0.0-rc.3-setup-win64.exe.sha256
```

## Requirements

- Windows 10/11 x64 (including N editions).
- Visual C++ Redistributable 2017 or newer (download page says it is needed on Windows 10).
- OpenGL 3.3 GPU + driver (min: GeForce 8, Radeon HD 2000, Intel HD 4000). On startup
  Friction reports "Your GPU drivers do not seem to be compatible" if GPU init fails.
- AVX-capable x86_64 CPU (Sandy Bridge / Bulldozer or newer), 4 GB RAM min, 16 GB+
  recommended.
- WASAPI audio device.

## Installer behaviour (from friction.iss)

- Default install dir: `C:\Program Files\Friction\` (`{commonpf64}\Friction`), executable
  `friction.exe` (plus `frictioncore.dll`, `frictionui.dll`, `skia.dll`, Qt and FFmpeg DLLs).
- Allows per-user install via the privileges dialog (`PrivilegesRequiredOverridesAllowed=dialog`).
- Registers the `.friction` extension; double-click runs `"friction.exe" "%1"`.

## Unsigned binaries

The binaries are not code-signed (download page "Known issues"). Windows SmartScreen may
show "Windows protected your PC"; the user has to choose "More info" > "Run anyway"
themselves after verifying the checksum.

## First run

A Quick Setup wizard runs once (`settings/firstRun`). Its presets page lets the user
install bundled render output profiles and expression presets (copyX, copyY, noise,
orbitX, orbitY, oscillation, rotation, time, trackObject, wave, wiggle, frameRemapLoop,
frameRemapLoopBounce) into the user folders below.

## Where things live

`AppSupport::getAppConfigPath()` = `QStandardPaths::GenericConfigLocation` + `/friction`,
which on Windows is:

```
%LOCALAPPDATA%\friction\                 (C:\Users\<you>\AppData\Local\friction)
    Expressions\        *.fexpr expression presets / global JS functions
    ShaderEffects\      *.gre + *.frag custom shader effects (docs say "ShadersEffects" - source says ShaderEffects)
    OutputProfiles\     *.conf render output profiles
```

The Expressions and shader paths can be changed in Preferences (settings keys
`CustomExpressionPath`, `CustomShaderPath`). Application settings (non-portable) go
through Qt `QSettings("friction", "friction")`, i.e. the registry under
`HKEY_CURRENT_USER\Software\friction\friction`.

macOS/Linux equivalents per docs: `~/Library/Preferences/friction/...`,
`~/.config/friction/...`.

## Portable mode

From `AppSupport::isAppPortable()` (Windows only): portable mode is on when a file named
`portable.txt` exists next to `friction.exe` **and** that folder is writable. Then:

- config, settings (`config\friction.conf`, INI) and the user folders move to
  `<app folder>\config\`;
- a one-time dialog shows the portable config path.

If the extracted 7z does not already contain `portable.txt`, create an empty one. Do not
put a portable copy under `C:\Program Files` (not writable, so portable mode silently
turns off).

## Launching from a shell

```powershell
& "C:\Program Files\Friction\friction.exe" "D:\work\intro.friction"
```

Only the first argument (a project path) is honored. There are no render/export flags.

## Optional extras

- Shader effects bundle: docs mention installing a bundle of extra shaders; check
  Preferences > Shaders for the active folder.
- FFmpeg: not needed separately - Friction links its own FFmpeg build and warns if it
  detects an unsupported (non-Friction) FFmpeg build.

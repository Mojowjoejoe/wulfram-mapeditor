# Windows desktop release

Wulfram Forge ships as a self-contained Windows x64 application hosted by
Microsoft Edge WebView2. The release executable embeds the entire production web
build and the .NET runtime; Node.js, npm, and a web server are not needed on the
target machine.

Build locally with a .NET 9 SDK:

```bash
npm ci
npm run build:desktop -- --version 0.6.0
```

The resulting artifact is
`dist/desktop/WulframForge-0.6.0-win-x64-self-contained.zip`. The executable
extracts its hashed web payload into the current user's local application-data
folder, maps it to `https://wulfram-forge.local`, and loads that origin in
WebView2. This preserves `localStorage`, downloads, WebGL, and keyboard controls
without listening on a network port.

The native shell opts into per-monitor-v2 DPI awareness, resets WebView content
zoom to 100%, and disables browser zoom so Windows display scaling is applied
exactly once. Responsive controls compact at small logical viewports while the
3D renderer caps its backing pixel ratio for predictable GPU cost.

The desktop bridge discovers `wulfram-maps` from `--maps-repo`, the
`WULFRAM_MAPS_REPO` environment variable, the last folder selected in the app,
or common sibling/Desktop locations. Repository source stays line-oriented and
is validated in JavaScript before it crosses the native bridge. Native code only
performs scoped file operations and invokes argument-safe local `git` commands
after the user chooses **Publish**.

## WebView2 runtime

The standard artifact uses the installed Evergreen WebView2 Runtime. To produce
a fully offline bundle with Microsoft's Fixed Version Runtime, first extract an
official x64 Fixed Version package, then set:

```powershell
$env:WEBVIEW2_FIXED_RUNTIME_DIR = 'C:\path\to\fixed-runtime'
npm run build:desktop -- --version 0.6.0
```

The build places it at `WulframForge/WebView2Runtime/` and labels the artifact
`offline-fixed-webview2`. At startup, the shell prefers that runtime and falls
back to Evergreen when it is absent. Microsoft notes that a Fixed Version runtime
adds more than 250 MB and must be serviced with application updates.

Pushing a `v*` tag runs [the release workflow](../.github/workflows/release.yml),
tests the portable fixture, builds the self-contained Windows artifact, records
its SHA-256 digest, and attaches the ZIP, Authenticode receipt, and checksum manifest
to a GitHub Release. Tagged public releases fail closed unless the executable is
successfully Authenticode-signed, RFC 3161 timestamped, and verified before packaging.

Configure the release repository or protected `release` environment with these
GitHub Actions secrets:

- `WINDOWS_SIGNING_CERTIFICATE_BASE64`: base64-encoded PFX containing a trusted
  Windows code-signing certificate and its private key
- `WINDOWS_SIGNING_CERTIFICATE_PASSWORD`: the PFX import password

The workflow imports the certificate into the ephemeral runner's current-user store,
passes only its public SHA-1 thumbprint to SignTool, signs with SHA-256, timestamps
with the configured RFC 3161 service, verifies the embedded signature, and removes
the certificate and temporary PFX in an `always()` cleanup step. Manual workflow runs
without secrets may still create an explicitly unsigned developer artifact; a `v*`
tag may not.

## Headed performance and DPI check

For a local headed Edge measurement, launch the built executable with a
loopback debugging port and run the checked-in probe:

```powershell
Start-Process .\dist\desktop\win-x64\WulframForge.exe -Environment @{ WULFRAM_FORGE_REMOTE_DEBUGGING_PORT = '9223' }
npm run measure:desktop
```

On the 2560×1600, 200%-scaled verification display, WebView2 reported a
1280×730 CSS viewport at device-pixel-ratio 2, no document overflow, and about
60 frames per second both idle and during keyboard camera motion. The probe also
decodes a shipped texture inside the live origin and records a screenshot plus
console/network failures.

## Balanced generator desktop smoke check

The balanced-generator smoke probe can target either the development server or
the embedded desktop origin. Launch a built executable with remote debugging,
then set both variables before running the probe:

```powershell
$env:WULFRAM_CDP_PORT = '9224'
$env:WULFRAM_CDP_URL_PREFIX = 'https://wulfram-forge.local'
node .\tools\smoke-balanced-ui.mjs .\artifacts\balanced-generator-desktop.png
```

The probe reloads the app, opens the generator, first cancels an active batch and
proves that the current project did not change, then creates three candidates. It
requires three accessible relief previews, at least one passing candidate, and all
eleven report gates before applying the selected candidate and writing before/after
screenshots. Its JSON receipt includes candidate generation time and the renderer's
used and allocated JavaScript heap sizes.

Set the logical viewport and device scale factor to reproduce a Windows display
configuration. The probe rejects document overflow at the configured viewport:

```powershell
$env:WULFRAM_VIEWPORT_WIDTH = '1280'
$env:WULFRAM_VIEWPORT_HEIGHT = '730'
$env:WULFRAM_DEVICE_SCALE_FACTOR = '2'
node .\tools\smoke-balanced-ui.mjs .\artifacts\balanced-generator-high-dpi.png
```

Pass a new output directory as the optional second path argument to run the complete
persistence journey. This mode deliberately clears only the debug profile's Forge
autosave, then verifies apply, undo, redo, local save, reload restoration, game/editor
ZIP export, package reopening, and UI re-import:

```powershell
node .\tools\smoke-balanced-ui.mjs .\artifacts\balanced-generator-desktop.png .\artifacts\persistence-smoke
```

The probe does not replace live map playtesting.

<#
  release.ps1 - one-command Android release build for DryWatch (React Native)

  Put this file in the project ROOT (the folder that contains "android" and "node_modules").

  Usage:
    .\release.ps1                          builds a release APK (arm64-v8a, fast)
    .\release.ps1 -AllAbis                 builds a release APK for all architectures
    .\release.ps1 -DebugBuild              builds a debug APK (quick device test)
    .\release.ps1 -Task bundleRelease      builds a release AAB (Play Store bundle)
    .\release.ps1 -SkipClean               skips deleting old build folders (faster, less safe)

  What it does:
    1. Finds JDK 21 (Android Studio JBR or Adoptium), installs Temurin 21 with winget if missing
    2. Writes the JDK location into ~/.gradle/gradle.properties and turns off flaky auto-download
    3. Stops Gradle/Kotlin daemons so nothing holds file locks
    4. Deletes every stale build folder (app, root, and all node_modules native libs),
       clearing read-only attributes first - this fixes the recurring AccessDenied errors
    5. Runs the Gradle build with --no-daemon and saves a full log
    6. Copies the APK/AAB to .\release-output with a timestamp
    7. Stops the daemons again so locks do not carry over to the next run
#>

param(
  [ValidateSet('assembleRelease', 'bundleRelease')]
  [string]$Task = 'assembleRelease',
  [switch]$DebugBuild,
  [switch]$AllAbis,
  [switch]$SkipClean,
  [string]$ProjectRoot = $PSScriptRoot
)

$ErrorActionPreference = 'Continue'
$sw = [System.Diagnostics.Stopwatch]::StartNew()

function Step($msg) { Write-Host ""; Write-Host "==> $msg" -ForegroundColor Cyan }
function Ok($msg)   { Write-Host "    $msg" -ForegroundColor Green }
function Warn($msg) { Write-Host "    $msg" -ForegroundColor Yellow }
function Fail($msg) { Write-Host ""; Write-Host "FAILED: $msg" -ForegroundColor Red; exit 1 }

# ---------- 0. Sanity checks ----------
$android = Join-Path $ProjectRoot 'android'
$gradlew = Join-Path $android 'gradlew.bat'
if (-not (Test-Path $gradlew)) {
  Fail "Cannot find android\gradlew.bat under '$ProjectRoot'. Put release.ps1 in the project root or pass -ProjectRoot."
}
if ($ProjectRoot -match '\\OneDrive\\') {
  Warn "Project is under OneDrive. Sync can lock build files here. Moving it to C:\dev is the permanent fix."
}

# ---------- 1. JDK 21 ----------
function Find-Jdk21 {
  $studio = "C:\Program Files\Android\Android Studio\jbr"
  if (Test-Path "$studio\bin\java.exe") {
    $v = & "$studio\bin\java.exe" -version 2>&1 | Out-String
    if ($v -match 'version "21') { return $studio }
  }
  $f = Get-ChildItem "C:\Program Files\Eclipse Adoptium" -Directory -Filter "jdk-21*" -ErrorAction SilentlyContinue |
       Sort-Object Name -Descending | Select-Object -First 1
  if ($f) { return $f.FullName }
  return $null
}

Step "Checking for JDK 21"
$jdk = Find-Jdk21
if (-not $jdk) {
  Warn "No JDK 21 found. Installing Temurin 21 with winget (a permission prompt may appear)..."
  winget install --id EclipseAdoptium.Temurin.21.JDK --exact --silent --accept-package-agreements --accept-source-agreements
  $jdk = Find-Jdk21
}
if (-not $jdk) {
  Fail "No JDK 21 found or installed. Download the JDK 21 x64 MSI from adoptium.net in your browser, install it, then run this script again."
}
Ok "Using JDK: $jdk"

$env:JAVA_HOME = $jdk
$env:Path = "$jdk\bin;$env:Path"

# ---------- 2. Gradle global settings ----------
Step "Updating Gradle global settings"
$gradleHome = Join-Path $env:USERPROFILE '.gradle'
New-Item -ItemType Directory -Force $gradleHome | Out-Null
$props = Join-Path $gradleHome 'gradle.properties'
$lines = @()
if (Test-Path $props) {
  $lines = @(Get-Content $props | Where-Object { $_ -notmatch '^org\.gradle\.java\.installations\.(paths|auto-download)=' })
}
$lines += "org.gradle.java.installations.paths=$($jdk -replace '\\','/')"
$lines += "org.gradle.java.installations.auto-download=false"
Set-Content $props $lines
Ok "gradle.properties updated"

# ---------- 3. Stop daemons ----------
function Stop-GradleProcesses {
  Push-Location $android
  & $gradlew --stop 2>&1 | Out-Null
  Pop-Location
  Get-CimInstance Win32_Process -Filter "Name='java.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -match 'gradle|kotlin' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
}

Step "Stopping Gradle and Kotlin daemons"
Stop-GradleProcesses
Start-Sleep -Seconds 2
Ok "Daemons stopped"

# ---------- 4. Clean build folders ----------
function Remove-Dir($p) {
  for ($n = 1; $n -le 3; $n++) {
    try {
      attrib -R "$p\*" /S /D 2>$null | Out-Null
      Remove-Item -Recurse -Force $p -ErrorAction Stop
      return $true
    } catch {
      Start-Sleep -Seconds 2
    }
  }
  return (-not (Test-Path $p))
}

if (-not $SkipClean) {
  Step "Deleting stale build folders"
  $dirs = @(
    "$android\build",
    "$android\app\build",
    "$android\.gradle",
    "$ProjectRoot\node_modules\@react-native\gradle-plugin\shared\build",
    "$ProjectRoot\node_modules\@react-native\gradle-plugin\build"
  )
  $dirs += @(Get-ChildItem "$ProjectRoot\node_modules\*\android\build"   -Directory -ErrorAction SilentlyContinue | ForEach-Object FullName)
  $dirs += @(Get-ChildItem "$ProjectRoot\node_modules\@*\*\android\build" -Directory -ErrorAction SilentlyContinue | ForEach-Object FullName)

  $stuck = @()
  foreach ($d in $dirs) {
    if (Test-Path $d) {
      if (Remove-Dir $d) { Ok "Deleted $d" } else { $stuck += $d }
    }
  }
  if ($stuck.Count -gt 0) {
    Write-Host ""
    Write-Host "These folders are still locked:" -ForegroundColor Red
    $stuck | ForEach-Object { Write-Host "  $_" -ForegroundColor Red }
    Fail "Something is holding files open. Close Android Studio, Explorer windows and emulators, or reboot, then run again. Resource Monitor (resmon) > CPU > Associated Handles shows the locking process."
  }
}

# ---------- 5. Build ----------
Step "Running gradlew $Task"
$logDir = Join-Path $ProjectRoot 'release-output'
New-Item -ItemType Directory -Force $logDir | Out-Null
$stamp = Get-Date -Format 'yyyyMMdd-HHmm'
$log = Join-Path $logDir "build-$stamp.log"

# arm64-v8a only by default: 2-3x faster and smaller for phone testing.
# Pass -AllAbis for a full-architecture build (Play Store upload etc).
$archArgs = @()
if (-not $AllAbis) { $archArgs += '-PreactNativeArchitectures=arm64-v8a' }
$daemonArgs = @('--no-daemon')

$gradleTask = if ($DebugBuild) { 'assembleDebug' } else { $Task }

$exitCode = 1
try {
  Push-Location $android
  & $gradlew $gradleTask @archArgs @daemonArgs --console=plain 2>&1 | Tee-Object -FilePath $log
  $exitCode = $LASTEXITCODE
  Pop-Location
}
finally {
  Step "Stopping daemons so no locks carry over"
  Stop-GradleProcesses
}

if ($exitCode -ne 0) {
  Write-Host ""
  Write-Host "BUILD FAILED (exit code $exitCode)" -ForegroundColor Red
  $logLines = @(Get-Content $log)
  if ($logLines.Count -gt 0) {
    $i = 0..($logLines.Count - 1) | Where-Object { $logLines[$_] -match 'What went wrong' } | Select-Object -First 1
    if ($null -ne $i) {
      $end = [Math]::Min($i + 6, $logLines.Count - 1)
      Write-Host "First error:" -ForegroundColor Yellow
      $logLines[$i..$end] | ForEach-Object { Write-Host "  $_" -ForegroundColor Yellow }
    }
  }
  Write-Host "Full log: $log"
  Write-Host "Send the first error above if you need help."
  exit $exitCode
}

# ---------- 6. Collect output ----------
Step "Collecting the build output"
if ($DebugBuild) {
  $outDir = "$android\app\build\outputs\apk\debug"; $pattern = '*.apk'
} elseif ($Task -eq 'bundleRelease') {
  $outDir = "$android\app\build\outputs\bundle\release"; $pattern = '*.aab'
} else {
  $outDir = "$android\app\build\outputs\apk\release";    $pattern = '*.apk'
}
$artifacts = @(Get-ChildItem $outDir -Filter $pattern -ErrorAction SilentlyContinue)
if ($artifacts.Count -eq 0) {
  Fail "Build said success but no $pattern was found in $outDir"
}

$last = $null
foreach ($a in $artifacts) {
  $dest = Join-Path $logDir ("{0}-{1}{2}" -f $a.BaseName, $stamp, $a.Extension)
  Copy-Item $a.FullName $dest -Force
  $mb = [Math]::Round($a.Length / 1MB, 1)
  Ok "$dest  ($mb MB)"
  $last = $dest
}

$sw.Stop()
Write-Host ""
Write-Host ("DONE in {0:mm\:ss}" -f $sw.Elapsed) -ForegroundColor Green
Write-Host "Output folder: $logDir"
if ($last) { explorer.exe "/select,`"$last`"" }

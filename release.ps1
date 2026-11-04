# DryWatch release build script.
# Fixes the recurring Windows file-lock build failures by resetting all
# lock sources before every build. Run from anywhere in PowerShell:
#   powershell -ExecutionPolicy Bypass -File release.ps1
# Add -DebugBuild for a debug APK instead of release.

param(
    [switch]$DebugBuild
)

$ErrorActionPreference = "Stop"
$ProjectRoot = "C:\Users\Darth\Documents\Claude\DryWatch"
$AndroidDir = Join-Path $ProjectRoot "android"
$Jdk = "C:\Program Files\Android\Android Studio\jbr"

Write-Host "=== DryWatch release build ===" -ForegroundColor Cyan

# 1. Stop all Gradle daemons (releases most file locks)
Write-Host "[1/4] Stopping Gradle daemons..." -ForegroundColor Yellow
& (Join-Path $AndroidDir "gradlew.bat") --stop 2>&1 | Out-Null

# 2. Kill leftover Java processes that may hold build files open.
#    Android Studio will re-launch its own JVM when reopened, so this is
#    safe as long as you are not editing in another Java tool right now.
Write-Host "[2/4] Killing stray Java processes..." -ForegroundColor Yellow
$javaProcs = Get-Process java -ErrorAction SilentlyContinue
if ($javaProcs) {
    $javaProcs | Stop-Process -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
    Write-Host "      Killed $($javaProcs.Count) java process(es)."
} else {
    Write-Host "      No stray Java processes."
}

# 3. Clear build output so Gradle never fights stale files
Write-Host "[3/4] Clearing build output..." -ForegroundColor Yellow
$buildDir = Join-Path $AndroidDir "app\build"
if (Test-Path $buildDir) {
    Remove-Item -Recurse -Force $buildDir -ErrorAction SilentlyContinue
}
# Whisper native libs inside node_modules also accumulate stale build state.
$whisperBuild = Join-Path $ProjectRoot "node_modules\whisper.rn\android\build"
if (Test-Path $whisperBuild) {
    Remove-Item -Recurse -Force $whisperBuild -ErrorAction SilentlyContinue
}
Write-Host "      Cleared."

# 4. Build
$env:JAVA_HOME = $Jdk
$arch = "-PreactNativeArchitectures=arm64-v8a"
$task = if ($DebugBuild) { "assembleDebug" } else { "assembleRelease" }

Write-Host "[4/4] Running $task (arm64-v8a, --no-daemon)..." -ForegroundColor Yellow
Set-Location $AndroidDir
& .\gradlew.bat $task $arch --no-daemon --console=plain
$exit = $LASTEXITCODE

if ($exit -eq 0) {
    $apk = if ($DebugBuild) {
        Join-Path $AndroidDir "app\build\outputs\apk\debug\app-debug.apk"
    } else {
        Join-Path $AndroidDir "app\build\outputs\apk\release\app-release.apk"
    }
    Write-Host ""
    Write-Host "=== BUILD SUCCESSFUL ===" -ForegroundColor Green
    if (Test-Path $apk) {
        $size = [math]::Round((Get-Item $apk).Length / 1MB, 1)
        Write-Host "APK: $apk ($size MB)"
    }
} else {
    Write-Host ""
    Write-Host "=== BUILD FAILED (exit $exit) - send the first error above ===" -ForegroundColor Red
}
exit $exit

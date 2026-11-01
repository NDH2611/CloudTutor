param([string]$ResumeReport = "", [string]$SceneVideo = "")
$ErrorActionPreference = "Stop"
try {
    $CtProject = Split-Path $PSScriptRoot -Parent
    Set-Location -LiteralPath $CtProject
    foreach ($CtTool in @("node", "aws", "ffmpeg", "ffprobe")) {
        if (-not (Get-Command $CtTool -ErrorAction SilentlyContinue)) { throw "Missing local tool: $CtTool" }
    }
    node (Join-Path $PSScriptRoot "testClassify.js")
    if ($LASTEXITCODE -ne 0) { throw "Classifier local tests failed." }
    if ($ResumeReport) {
        node (Join-Path $PSScriptRoot "monitor.js") $ResumeReport
        if ($LASTEXITCODE -ne 0) { throw "Resume stopped. Keep report and send error." }
        return
    }
    if (-not $SceneVideo) {
        Add-Type -AssemblyName System.Windows.Forms
        $CtPicker = New-Object System.Windows.Forms.OpenFileDialog
        $CtPicker.Title = "Chon doan phim/canh that KHONG CHU; am thanh se duoc thay bang im lang"
        $CtPicker.Filter = "Video (*.mp4;*.mov;*.mkv)|*.mp4;*.mov;*.mkv"
        $CtPicker.InitialDirectory = $CtProject
        if ($CtPicker.ShowDialog() -ne "OK") { throw "No scene video selected. Nothing uploaded." }
        $SceneVideo = $CtPicker.FileName
    }
    if (-not (Test-Path -LiteralPath $SceneVideo)) { throw "Scene video not found." }
    $CtReport = Join-Path $CtProject ("reports\three-branches\" + (Get-Date -Format "yyyyMMdd-HHmmss") + "-" + [guid]::NewGuid().ToString("N").Substring(0, 6))
    New-Item -ItemType Directory -Path $CtReport -Force | Out-Null
    Write-Host "REPORT:" $CtReport
    Write-Host "[1/3] Preparing three short MP4 files. No AWS uploads yet."
    function Invoke-CtFfmpeg {
        param([string[]]$Arguments)
        & ffmpeg -hide_banner -loglevel error -y @Arguments
        if ($LASTEXITCODE -ne 0) { throw "FFmpeg failed. Nothing should be uploaded until all media are prepared." }
    }
    $CtSpeech = Join-Path $CtReport "speech.mp4"
    $CtExistingSpeech = $null
    if (Test-Path .\e2e-current-run.json) {
        $CtOld = Get-Content .\e2e-current-run.json -Raw | ConvertFrom-Json
        $CtExistingSpeech = ($CtOld.cases | Where-Object { $_.name -eq "speech" } | Select-Object -First 1).file
    }
    if ($CtExistingSpeech -and (Test-Path -LiteralPath $CtExistingSpeech)) {
        Copy-Item -LiteralPath $CtExistingSpeech -Destination $CtSpeech
        Write-Host "Using previously tested English speech fixture."
    } else {
        Add-Type -AssemblyName System.Speech
        $CtSynth = New-Object System.Speech.Synthesis.SpeechSynthesizer
        try {
            $CtVoice = @($CtSynth.GetInstalledVoices() | Where-Object { $_.Enabled -and $_.VoiceInfo.Culture.Name -like "en-*" }) | Select-Object -First 1
            if (-not $CtVoice) { throw "No English TTS voice. Supply the previous speech fixture before rerunning media preparation." }
            $CtSynth.SelectVoice($CtVoice.VoiceInfo.Name)
            $CtSynth.SetOutputToWaveFile((Join-Path $CtReport "speech.wav"))
            $CtSynth.Speak("Cloud computing lets students store data on remote servers. Storage keeps videos safe. Queues buffer background tasks. Functions process the videos and create useful learning materials.")
        } finally { $CtSynth.Dispose() }
        Invoke-CtFfmpeg -Arguments @("-f", "lavfi", "-i", "color=c=black:s=640x360:r=25", "-i", (Join-Path $CtReport "speech.wav"), "-map", "0:v:0", "-map", "1:a:0", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-ar", "16000", "-ac", "1", "-shortest", "-movflags", "+faststart", $CtSpeech)
    }
    Add-Type -AssemblyName System.Drawing
    $CtBitmap = New-Object System.Drawing.Bitmap(1280, 720)
    $CtGraphics = [System.Drawing.Graphics]::FromImage($CtBitmap)
    $CtFont = New-Object System.Drawing.Font("Arial", 52, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)
    try {
        $CtGraphics.Clear([System.Drawing.Color]::White)
        $CtGraphics.DrawString("CLOUD COMPUTING", $CtFont, [System.Drawing.Brushes]::Black, [single]70, [single]120)
        $CtGraphics.DrawString("STORAGE QUEUES AND FUNCTIONS", $CtFont, [System.Drawing.Brushes]::Black, [single]70, [single]240)
        $CtGraphics.DrawString("STUDENTS LEARN FROM VIDEO", $CtFont, [System.Drawing.Brushes]::Black, [single]70, [single]360)
        $CtBitmap.Save((Join-Path $CtReport "ocr-slide.png"), [System.Drawing.Imaging.ImageFormat]::Png)
    } finally { $CtFont.Dispose(); $CtGraphics.Dispose(); $CtBitmap.Dispose() }
    Invoke-CtFfmpeg -Arguments @("-loop", "1", "-framerate", "25", "-i", (Join-Path $CtReport "ocr-slide.png"), "-f", "lavfi", "-i", "anullsrc=r=16000:cl=mono", "-t", "12", "-map", "0:v:0", "-map", "1:a:0", "-vf", "scale=640:360", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", "-movflags", "+faststart", (Join-Path $CtReport "silent-text.mp4"))
    Invoke-CtFfmpeg -Arguments @("-i", $SceneVideo, "-f", "lavfi", "-i", "anullsrc=r=16000:cl=mono", "-t", "12", "-map", "0:v:0", "-map", "1:a:0", "-vf", "scale=640:360:force_original_aspect_ratio=decrease,pad=640:360:(ow-iw)/2:(oh-ih)/2", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", "-movflags", "+faststart", (Join-Path $CtReport "silent-scene.mp4"))
    foreach ($CtName in @("speech", "silent-text", "silent-scene")) {
        $CtProbe = & ffprobe -v error -show_streams -show_format -of json (Join-Path $CtReport "$CtName.mp4")
        if ($LASTEXITCODE -ne 0) { throw "Cannot inspect generated video: $CtName" }
        $CtDetails = $CtProbe | ConvertFrom-Json
        if (@($CtDetails.streams | Where-Object { $_.codec_type -eq "audio" }).Count -eq 0 -or @($CtDetails.streams | Where-Object { $_.codec_type -eq "video" }).Count -eq 0) { throw "Generated MP4 needs video and audio track: $CtName" }
        $CtUtf8 = New-Object System.Text.UTF8Encoding($false)
        [System.IO.File]::WriteAllText((Join-Path $CtReport "$CtName-ffprobe.json"), ($CtProbe -join "`n"), $CtUtf8)
    }
    Write-Host "[2/3] Uploading THREE test jobs through the MAIN pipeline."
    Write-Host "This uses Transcribe/MediaConvert/Rekognition and up to three selected Vision frames."
    Write-Host "ASR/OCR may reach M3 on the shared AI queue. No queue destinations will be changed."
    Write-Host "[3/3] Polling M2 source and handoff (up to 15 minutes)."
    node (Join-Path $PSScriptRoot "monitor.js") $CtReport
    if ($LASTEXITCODE -ne 0) { throw "Run stopped. Send output and resume the SAME report folder; do not upload new copies." }
} catch {
    Write-Host "STOP:" $_.Exception.Message -ForegroundColor Red
    exit 1
}

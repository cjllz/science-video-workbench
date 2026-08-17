param(
  [Parameter(Mandatory = $true)][string]$Text,
  [Parameter(Mandatory = $true)][string]$OutputPath,
  [string]$Voice = "Microsoft Huihui Desktop",
  [int]$Rate = 1
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Speech
$synthesizer = [System.Speech.Synthesis.SpeechSynthesizer]::new()
try {
  $synthesizer.SelectVoice($Voice)
  $synthesizer.Rate = $Rate
  $synthesizer.SetOutputToWaveFile($OutputPath)
  $synthesizer.Speak($Text)
} finally {
  $synthesizer.Dispose()
}

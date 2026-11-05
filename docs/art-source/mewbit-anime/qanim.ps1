param([string]$SeqFile, [string[]]$Only = @(), [int]$SeedBase = 200)
# Generates animation frames. Each sequence is a list of frames; `ref` is 'prev' (the previous frame
# of this sequence, for continuity) or a path relative to docs/character/anime.
$ErrorActionPreference = 'Continue'
$dir = 'C:\Users\moskw\Documents\ChatGPT\NeoBeatBuddy\docs\character\anime'
$keep = 'Keep the character, outfit, colors, proportions and the exact drawing style of image 1 unchanged: rough hand-drawn sketchy ink lines with variable line weight, light hatching in shadows, flat cel colors, hard-edged cel shadows, plain flat white background, whole body visible from ears to boots, same scale and same position as image 1. She has exactly two arms and two hands. She wears the large over-ear headphones with glowing cyan rings on her ears in every frame. Change only this, small change from image 1:'
$keepFree = $keep.Replace('same scale and same position as image 1', 'same scale as image 1').Replace('Change only this, small change from image 1:', 'Change only the pose and expression:')
$seqs = Get-Content $SeqFile -Raw | ConvertFrom-Json -AsHashtable
$seed = $SeedBase
foreach ($k in ($seqs.Keys | Sort-Object)) {
  if ($Only.Count -and $k -notin $Only) { $seed += 10; continue }
  $prev = $null
  $n = 0
  foreach ($f in $seqs[$k]) {
    $n++
    $seed++
    $ref = if ($f.ref -eq 'prev') { $prev } else { Join-Path $dir $f.ref }
    $dest = "$dir\frames\raw\game\$k\f$n"
    $existing = Get-ChildItem $dest -Filter *.png -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $existing) {
      & D:\LocalImageAI\scripts\Image-AI.ps1 generate --model qwen-base --profile quality --width 768 --height 1152 --seed $seed `
        --image $ref --prompt "$(if ($f.free) { $keepFree } else { $keep }) $($f.p)" --destination $dest | Out-Null
      $existing = Get-ChildItem $dest -Filter *.png | Select-Object -First 1
    }
    $prev = $existing.FullName
    "$k f$n done"
  }
  $seed = [math]::Ceiling($seed / 10) * 10
}

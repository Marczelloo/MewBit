param([string[]]$Only = @(), [int[]]$Seeds = @(11, 22))
$out = "C:\Users\moskw\AppData\Local\Temp\claude\98f97ba77745d508\a0542fc7-d26b-4d19-b7a3-b82b4302eb6c\scratchpad\bg-mocks"
$ref = "C:\Users\moskw\Documents\ChatGPT\NeoBeatBuddy\docs\character\anime\style5-lift\bp-30.png"

$style = "Empty background scene for an anime rhythm game, drawn in exactly the same art style as the reference image: hand-inked anime illustration with slightly loose, soft dark-violet line art of varied weight, fine sketchy hatching in the shadows, flat cel colour fills with two or three hard-edged tones, muted near-black and charcoal-violet base colours with small saturated magenta and cyan accents. The woman in the reference image is only a guide for line and colour style: do not draw her. No people, no characters, no animals, no faces, no text, no letters, no numbers, no logos, no writing on signs."
$layout = "Wide 16:9 view, eye-level camera, fixed still scene and evenly lit. The scene continues naturally and unbroken across the whole width of the picture. Around the centre it stays simple and dim, with only soft distant shapes, while the larger and brighter details sit towards the left and right sides. A flat empty floor runs across the bottom fifth of the picture."

$scenes = [ordered]@{
    "01-dach"     = "A city rooftop at night: concrete floor tiles in perspective, a low metal railing, two big speaker stacks at the far left and right edges, cables on the floor, a skyline of dark towers with small magenta and cyan windows behind, a large pale lavender moon upper left."
    "02-klub"     = "The empty stage of a small underground live music club: dark wooden stage floor, stacks of amplifiers and a drum riser at the sides, a lighting truss with unlit spotlights overhead, a dark curtain at the back, thin magenta and cyan LED strips along the truss."
    "03-pokoj"    = "A cozy bedroom music studio at night: desk with two monitors and a small synth keyboard on the left, shelves with records and cat-ear headphones on a stand, framed abstract geometric art prints showing only simple coloured shapes, no figures, LED strip light along the ceiling, a big window with a night city on the right, wooden floor with a soft rug."
    "04-arcade"   = "The inside of a retro game arcade at night: rows of arcade cabinets along the left and right walls with blank glowing screens, patterned dark carpet floor, ceiling with neon tube lines in magenta and cyan, a dark quiet corridor receding in the middle."
    "05-zaulek"   = "A narrow Tokyo-style back alley on a rainy night: wet asphalt floor with reflections, closed shop shutters, vending machines with blank glowing panels, tangled overhead power lines, abstract neon heart and music note shapes on the walls, paper lanterns without writing."
    "06-metro"    = "An empty underground subway platform at night: tiled floor with a yellow safety line, square support pillars at the left and right, blank advertising panels glowing softly, fluorescent ceiling lights, a dark tunnel opening in the middle."
    "07-glitch"   = "An abstract digital void inside a glitching computer world: floating broken wireframe platforms, a dark grid floor receding to the horizon, torn rectangular glitch slices and data blocks in magenta and cyan drifting in the upper left and upper right, deep dark violet emptiness in the middle."
    "08-swit"     = "A city rooftop at dawn after an all-night party: concrete floor, a low railing, speaker stacks at the edges, strings of small lanterns overhead, soft pink and violet morning sky with flat cel-shaded clouds, distant dark towers."
}

foreach ($name in $scenes.Keys) {
    if ($Only.Count -and $Only -notcontains $name) { continue }
    foreach ($seed in $Seeds) {
        $dest = Join-Path $out "$name-s$seed"
        if (Test-Path $dest) { Write-Output "skip $name $seed"; continue }
        $prompt = "$style Scene: $($scenes[$name]) $layout"
        & D:\LocalImageAI\scripts\Image-AI.ps1 generate --model flux3-klein --profile quality --width 1344 --height 768 --seed $seed --image $ref --destination $dest --no-upsample --timeout 300 --prompt $prompt 2>&1 | Select-Object -Last 2
    }
}
Write-Output "ALL DONE"

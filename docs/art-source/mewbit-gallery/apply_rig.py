"""One-off: the gallery moves to the rig's frames, previews in the page and full size loaded per pose."""
import re

s = open("template.html", encoding="utf8").read()
assert "loadFull" not in s

s = re.sub(r'const GROUPS = \[.*?\n\];\n', '''const GROUPS = [
  { id: "game", title: "W grze", note: "Nowe klatki z riga, do oceny. W samej grze są jeszcze stare." },
  { id: "unlock", title: "Odblokowanie", note: "Po wpisaniu kodu Konami." },
  { id: "lobby", title: "Lobby", note: "Żaden ekran jeszcze ich nie pokazuje." },
  { id: "results", title: "Wyniki", note: "Żaden ekran jeszcze ich nie pokazuje." },
];
''', s, flags=re.S)

poses = [
    ("neutral", "game", 64, 16, "", "Poza rozgrywką i przy combo poniżej 10."),
    ("vibe1", "game", 64, 24, 'bubble: "nyaa~!"', "Combo od 10 do 24. Tę wersję już zatwierdziłeś."),
    ("vibe2", "game", 64, 24, 'bubble: "wooo!!"', "Combo od 25 do 49."),
    ("vibe3", "game", 48, 24, 'bubble: "SUGOI!!"', "Combo 50 i więcej."),
    ("miss", "game", 14, 24, 'hold: true, bubble: "eep!"', "Po pudle przy combo poniżej 25, na 600 ms."),
    ("crushed", "game", 28, 24, 'hold: true, bubble: "nyoo… ;-;"', "Po pudle przy combo 25 lub wyższym, na 1200 ms."),
    ("milestone", "game", 21, 24, "hold: true", "Gdy rośnie mnożnik, na 900 ms."),
    ("fever", "game", 48, 24, 'bubble: "FEVER!!! ✦"', "Przez cały czas trwania FEVER."),
    ("charting", "game", 48, 12, 'bubble: "charting…"', "Gdy gra przygotowuje nuty do utworu."),
    ("emerge", "unlock", 38, 24, "hold: true", "Wychodzi ze szczeliny po wpisaniu kodu Konami. W grze jej lewą część zasłania krawędź szczeliny, tutaj widać całą klatkę."),
    ("reveal", "unlock", 30, 24, 'hold: true, bubble: "you found me!"', "Na karcie odblokowania, zaraz po emerge."),
    ("stretch", "lobby", 64, 16, "unused: true", "Przypisana do lobby."),
    ("adjust", "lobby", 48, 16, "unused: true", "Przypisana do lobby."),
    ("peek", "lobby", 48, 16, "unused: true", "Przypisana do lobby."),
    ("hype", "lobby", 32, 24, "unused: true", "Przypisana do lobby."),
    ("go", "lobby", 22, 24, 'hold: true, unused: true, bubble: "nyaa~ ✦"', "Przypisana do lobby."),
    ("cheer", "results", 32, 24, "unused: true", "Przypisana do wyników."),
    ("okay", "results", 48, 12, "unused: true", "Przypisana do wyników."),
    ("sad", "results", 48, 12, "unused: true", "Przypisana do wyników."),
    ("newbest", "results", 26, 24, "hold: true, unused: true", "Przypisana do wyników."),
]
lines = [f'  {name}: {{ group: "{group}", order: run({count}), fps: {fps},{" " + extra + "," if extra else ""} when: "{when}" }},' for name, group, count, fps, extra, when in poses]
s = re.sub(r'const POSES = \{.*?\n\};\n', "const POSES = {\n" + "\n".join(lines) + "\n};\n", s, flags=re.S)

s = s.replace('''const url = (pose, n) => FRAMES[pose][pad(n)];
''', '''const url = (pose, n) => FRAMES[pose][pad(n)];
// The page itself carries small previews; the selected pose swaps to full size as soon as its bundle arrives.
const FULL = {};
const big = (pose, n) => FULL[pose]?.[pad(n)] ?? url(pose, n);
const loadFull = (pose) => {
  FULL[pose] ??= null;
  if (FULL[pose] !== null || loadFull.busy?.has(pose)) return;
  (loadFull.busy ??= new Set()).add(pose);
  fetch(`bundles/${pose}.json`).then((response) => response.json()).then((frames) => {
    FULL[pose] = frames;
    if (state.pose === pose) paintFrame();
  }).catch(() => { $("ins-low").hidden = state.pose !== pose; }).finally(() => loadFull.busy.delete(pose));
};
''')
s = s.replace('''  $("main-img").src = url(name, file);
''', '''  $("main-img").src = big(name, file);
''')
s = s.replace('''    onion.src = url(name, pose.order[before]);
''', '''    onion.src = big(name, pose.order[before]);
''')
s = s.replace('''  replayAt = 0;
  try { history.replaceState''', '''  replayAt = 0;
  $("ins-low").hidden = true;
  loadFull(state.pose);
  try { history.replaceState''')
s = s.replace('''      <p class="facts" id="ins-facts"></p>
''', '''      <p class="facts" id="ins-facts"></p>
      <p class="when" id="ins-low" hidden>Pełna jakość się nie wczytała, widać podgląd.</p>
''')
s = s.replace('''<small>${files(name).length} klatek · ${seconds(pose)} s${pose.hold ? " · raz" : " · pętla"}</small>''', '''<small>${files(name).length} klatek · ${seconds(pose)} s${pose.hold ? " · raz" : " · pętla"}</small>''')
open("template.html", "w", encoding="utf8", newline="\n").write(s)
print("applied", s.count("run("))

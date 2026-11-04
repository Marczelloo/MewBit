# Czy rozdzielanie instrumentów pomaga wybrać nuty

**Wniosek: nie przechodzi progu. Generator zostaje przy K, bez rozdzielania w produkcji.** Generator nie został zmieniony. Użyto 80 utworów do analizy i Hopes and Dreams, 20 utworów testowych nie użyto.

Model: Demucs `htdemucs_6s` (perkusja, bas, wokal, gitara, pianino, reszta). K to prosty model z siły uderzenia w miksie i siatki. ALL to wszystkie cechy z miksu, bez rozdzielania.

## Próg zapisany przed pierwszym wynikiem

| warunek | wynik | spełniony |
|---|---|---|
| K+ścieżki co najmniej +.02 F1 nad K na Normal, przedział powyżej zera | +.0044 [−.0003, +.0094] | nie |
| K+ścieżki lepsze od samego miksu na Normal, przedział powyżej zera | −.0006 [−.0046, +.0035] | nie |
| Easy i Hard nie tracą więcej niż .005 F1 | Easy +.0364, Hard +.0021 | tak |

## Wyniki (walidacja po utworach, mediana AUC / F1)

| zestaw | Easy | Normal | Hard |
|---|---|---|---|
| K | .9154 / .7064 | .9196 / .7631 | .8999 / .7758 |
| ALL | .9346 / .7066 | .9347 / .7721 | .9133 / .7909 |
| same ścieżki | .8906 / .6293 | .8763 / .6575 | .8519 / .6832 |
| K+ścieżki | .9281 / .7115 | .9318 / .7578 | .9121 / .7727 |
| ALL+ścieżki | .9388 / .7151 | .9353 / .7745 | .9173 / .7899 |
| ALL+ścieżki, drzewa | .9444 / .7233 | .945 / .7683 | .9242 / .7909 |

Średnia zmiana F1 po utworach [95%]:

| porównanie | Easy | Normal | Hard |
|---|---|---|---|
| K+ścieżki − K | +.0364 [.0198, .0545] | +.0044 [−.0003, .0094] | +.0021 [−.0010, .0049] |
| ALL − K | +.0341 [.0161, .0532] | +.0050 [−.0003, .0103] | +.0155 [.0126, .0183] |
| K+ścieżki − ALL | +.0023 [−.0077, .0124] | −.0006 [−.0046, .0035] | −.0134 [−.0164, −.0105] |
| ALL+ścieżki − ALL | +.0111 [.0052, .0177] | +.0029 [.0003, .0054] | +.0003 [−.0014, .0021] |

Na Easy K+ścieżki zyskuje, ale tyle samo daje sam miks. Ścieżki dokładają realnie tylko do ALL na Easy i minimalnie na Normal.

## Sprawdzenie po wyniku (rozpoznawcze, nie drugi próg)

`followup.py`. Tabele poniżej powstały po poznaniu wyniku i nie zmieniają decyzji.

**Górna granica: najlepszy instrument w każdym oknie 8 s.** Pierwsza wersja w `measure.py` porównywała K z samą ścieżką bez siatki, co było nieuczciwe, bo K ma siatkę. Ta wersja daje każdej ścieżce tę samą siatkę. Pokrycie momentów człowieka:

| | Easy | Normal | Hard |
|---|---|---|---|
| K | .6734 | .7632 | .7753 |
| najlepsza ścieżka na okno, wybór znając odpowiedź | .7435 | .8097 | .8059 |
| to samo z K z szumem zamiast ścieżek (zysk z samego wyboru z sześciu) | .7021 | .7830 | .7910 |
| najgłośniejszy instrument melodyczny, wybór do zrobienia naprawdę | .6672 | .7570 | .7696 |

Znając z góry właściwy instrument, zyskalibyśmy ponad szum +.041 na Easy, +.027 na Normal i +.015 na Hard. Tej wiedzy nie mamy. Reguła, którą dałoby się wdrożyć, czyli najgłośniejszy instrument melodyczny, jest o .006 gorsza od K na każdym poziomie. Poziom szumu w tym wierszu (.05) jest wybrany arbitralnie, więc to rząd wielkości.

**Miara słabo rozróżnia instrumenty.** Dowolna jedna ścieżka z siatką daje na Normal F1 .748–.765, a K .763. Bas z siatką (.7525) jest prawie tak dobry jak K, czyli większość wyniku robi siatka. Brak zysku w tej mierze znaczy: ścieżki nie zbliżają nas do momentów człowieka. Nie znaczy, że brzmienie nie może być lepsze.

**Na których utworach.** Zmiana K+ścieżki wobec K na Normal: 14 z 78 utworów zyskuje ponad .02, 6 traci ponad .02, reszta bez zmiany. Pomaga głównie tam, gdzie jest dużo perkusji (górna tercja +.0132 na Normal, +.0664 na Easy; dolna +.0008 i +.0217), a nie w spokojnych utworach melodycznych. Flower Dance traci (−.0119 Easy, −.0158 Normal), Mizuoto bez wyraźnej zmiany (+.0093, −.0064, Hard +.0082), Yoru +.0169 na Easy.

## Hopes and Dreams względem opisu ze słuchu

Udział energii ważony A i nuty na sekundę ze ścieżek:

| część | perk. | bas | other | wokal | gitara | nuty/s other / wokal / gitara |
|---|---|---|---|---|---|---|
| 0–20 skrzypce | 0 | 0 | 100% | 0 | 0 | 3,2 / 0 / 0,1 |
| 20–22 szybka sekwencja | 6 | 1 | 31 | 0 | 62 | 2,5 / 0 / 5,0 |
| 22–45 melodia, gitara w tle | 10 | 3 | 4 | 7 | 75 | 0,5 / 0,8 / 3,5 |
| 45–67 sama gitara | 27 | 16 | 5 | 0 | 52 | 1,1 / 0 / 3,9 |
| 67–79 gitara z melodią | 5 | 1 | 1 | 0 | 92 | 0 / 0 / 3,8 |
| 79–90 gitara z dzwonkiem | 4 | 1 | 2 | 0 | 93 | 0,5 / 0 / 4,1 |
| 90–112 melodia i flet | 14 | 3 | 71 | 0 | 13 | 3,8 / 0 / 1,3 |

Rozdzielanie łapie zmianę instrumentu i granice 20 s i 90 s. Nie rozdziela melodii od gitary w 22–90 s, bo obie lądują na ścieżce gitary, więc nie rozstrzyga pytania „melodia czy gitara”. Ścieżka pianina jest pusta.

Gdzie padają nuty K na Normal (tolerancja 40 ms):

| część | nut K | na nucie instrumentu | tylko na mocnej perkusji | nut instrumentów w tej części |
|---|---|---|---|---|
| 0–20 skrzypce | 73 | 25% | 0% | 66 |
| 22–45 melodia | 104 | 33% | 42% | 112 |
| 45–67 sama gitara | 58 | 52% | 31% | 109 |
| 67–79 gitara z melodią | 57 | 33% | 44% | 46 |
| 79–90 gitara z dzwonkiem | 58 | 36% | 43% | 50 |
| 90–112 melodia i flet | 123 | 36% | 42% | 112 |

K w częściach melodycznych często idzie za perkusją: około 42% nut pada na uderzenie bez nuty instrumentu w pobliżu. To zgadza się z tym, co słychać, i jest to słabość K. Nie mamy dla tego utworu mapy człowieka, a wykrywanie nut na miękkich skrzypcach i akordach gubi część nut, więc te procenty są zaniżone. To jeden utwór.

## Koszt

| | czas względem długości utworu | uwagi |
|---|---|---|
| GPU RTX 3050 Laptop | 0,26× | 80 utworów, 2800 s na 10788 s audio, pik pamięci zgłoszony 619 MB |
| CPU tego laptopa, 4 wątki | 0,51× | jeden utwór 63 s, mały pomiar |
| Raspberry Pi | około 1,5–3× | przybliżenie ×3–6 względem powyższego, nie zmierzone; 3-minutowy utwór to 5–9 minut, plus pamięć modelu, której na Pi nie sprawdzono |

Stemy: 1,3 GB na 80 utworów (mono 22 kHz FLAC). Obraz Dockera: 10,9 GB.

## Czego to nie mówi

- Człowiek z korpusu to przybliżenie, a nie gust grającego. Easy v26 na Hopes and Dreams zostało ocenione wysoko bez tej miary.
- Wykrywanie sekcji i zmian instrumentu ze ścieżek nie było tu oceniane. Na Hopes and Dreams wygląda obiecująco, ale to jeden utwór.
- Nie sprawdzono innego modelu rozdzielania ani osobnego wykrywania wokalu. Nie sprawdzono też ułożenia nut na torach ani czasu trzymania.

## Uruchomienie

`Dockerfile` buduje obraz `mewbeat-stems`. Kolejność: `separate.py` (obraz `mewbeat-stems`), `stem_features.py`, `measure.py`, `followup.py` (obraz `mewbeat-ma`). Wyniki trafiają do `.mewbeat-debug/data/stems/` (poza gitem), logi `measure.log` i `followup.log` są obok skryptów.

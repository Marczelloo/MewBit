# Holdy a przeciągane dźwięki

Pomiar przed planem rytmu, gęstości i holdów. 80 utworów z części do analizy, 20 testowych nieużytych. Ścieżki Demucs służą tu tylko jako wzorzec tego, co brzmi; nie wchodzą do generatora.

## Wniosek

1. **Największa luka v26 to budowa holda, nie to, na czym leży.** Za mało nut pod holdem, hold prawie zawsze puszcza na następnym momencie, za mało długich holdów. Najbardziej na Normal i Hard.
2. **Długi hold trafia w trwający dźwięk, krótki w dużej mierze nie.** U ludzi na Normal długi hold leży na trwającym dźwięku 3,8× częściej niż placebo, w v26 2,5×.
3. **Głowę holda u ludzi wyznacza głównie przerwa w mapie** (AUC ok. .75). Sam miks daje .56–.63, a ścieżki niemal nic nie dokładają. Zgranie z dźwiękiem jest więc preferencją przy wyborze długich holdów, nie regułą dla wszystkich.
4. **Obecny `lead` prawie nie widzi przeciąganych dźwięków** (.104), a 63% z nich to wokal. Sam miks łapie .234, ale rozpoznanie startu długiego dźwięku ma AUC tylko .64–.65 i precyzję ok. .10 (3× baza). Tani detektor jest słaby; fałszywy alarm nie szkodzi, bo hold i tak leży na przerwie.
5. **Udział nut na samej perkusji nie jest celem.** Ludzie mają go tyle samo lub więcej niż v26. Zostaje jako kontrola na utworach, gdzie słuch mówi, że melodia ginie.

## Budowa holdów

| | Easy ludzie / v26 | Normal ludzie / v26 | Hard ludzie / v26 |
|---|---|---|---|
| udział holdów | .142 / .115 | .118 / .088 | .104 / .068 |
| długość w beatach (mediana) | 1,21 / 1,13 | .92 / 1,04 | .76 / .52 |
| holdy ≥1,5 beatu | .271 / .208 | .171 / .104 | .129 / .036 |
| holdy z nutą pod spodem | .054 / 0 | .147 / .042 | .194 / .024 |
| nut pod holdem | .10 / 0 | .278 / .053 | .436 / .051 |
| te nuty w drugiej ręce | .76 / – | .775 / 1,0 | .72 / 1,0 |
| puszczenie na następnym momencie | .888 / .979 | .771 / .942 | .683 / .936 |

## Holdy a dźwięk

Placebo to ten sam hold przesunięty losowo w obrębie utworu.

| | Easy ludzie / v26 | Normal ludzie / v26 | Hard ludzie / v26 |
|---|---|---|---|
| hold na trwającym dźwięku (placebo) | .283 (.23) / .29 (.232) | .393 (.288) / .306 (.255) | .412 (.326) / .458 (.398) |
| to samo, sam miks | .131 / .137 | .191 / .179 | .215 / .25 |
| **długi hold na trwającym dźwięku (placebo)** | .165 (.061) / .173 (.068) | .219 (.057) / .196 (.079) | .222 (.069) / .211 (.092) |
| głowa holda na starcie dźwięku | .186 / .172 | .257 / .183 | .27 / .233 |
| koniec holda na końcu dźwięku (gdy na dźwięku) | .702 / .646 | .631 / .653 | .589 / .522 |
| luźno: coś dalej brzmi (placebo) | .889 (.85) / .845 (.84) | .811 (.778) / .843 (.842) | .701 (.687) / .633 (.607) |
| przeciągany dźwięk ma hold (placebo) | .245 (.198) / .184 (.132) | .272 (.191) / .198 (.17) | .28 (.204) / .146 (.116) |
| przeciągany dźwięk ma nutę na starcie | .358 / .331 | .449 / .448 | .554 / .572 |
| hold na trwającym wokalu | .173 / .175 | .244 / .179 | .242 / .288 |

Luźna definicja na energii ścieżki nie rozróżnia niczego (.81 wobec .78), więc odpada jako kryterium.

## Co przewiduje głowę holda

AUC, mediana po utworach, walidacja po utworach.

| | Easy | Normal | Hard |
|---|---|---|---|
| przerwa do następnego momentu | .748 | .737 | .767 |
| tani model z miksu | .572 | .562 | .629 |
| tani model + przerwa | .745 | .756 | .774 |
| do tego ścieżki | .752 | .759 | .772 |

## Czy miks słyszy start długiego dźwięku

Na momentach ludzkich map, wzorcem są ścieżki.

| | Easy | Normal | Hard |
|---|---|---|---|
| baza | .041 | .032 | .028 |
| AUC | .638 | .65 | .639 |
| precision@k | .115 | .102 | .094 |
| najlepszy pojedynczy sygnał, `chroma_stab` | .605 | .606 | .59 |

`lead_len` i `bass_len` dają około .50. Pokrycie 1748 przeciąganych dźwięków (8,12 na minutę, mediana): lead .104, bass .193, lead+bass .259, miks z HPSS .234.

## Hopes and Dreams

W 0–112 s jest 16 przeciąganych dźwięków. Normal trzyma 1, Hard 1, Easy 0. Holdów jest sporo (Normal 2, 1, 10, 11, 6, 6, 12 w kolejnych częściach), ale leżą gdzie indziej.

| część | przeciągane | Easy / Normal / Hard trzyma | tylko perkusja E / N / H |
|---|---|---|---|
| 0–20 s skrzypce | 8 | 0 / 0 / 0 | 0 / 0 / 0 |
| 20–22 s szybka sekwencja | 0 | – | – |
| 22–45 s melodia | 2 | 0 / 0 / 1 | .526 / .368 / .245 |
| 45–67 s sama gitara | 3 | 0 / 1 / 0 | .261 / .162 / .123 |
| 67–79 s gitara z melodią | 0 | – | .5 / .368 / .277 |
| 79–90 s gitara z dzwonkiem | 0 | – | .5 / .407 / .321 |
| 90–112 s melodia i flet | 3 | 0 / 0 / 0 | .547 / .425 / .344 |

Do sprawdzenia słuchem: skrzypce 0:03, 0:05, 0:09, 0:13, 0:16; gitara 0:23, 0:49, 0:55; wokal 2:37, 3:03.

## Czego to nie mówi

- Że mapy ludzkie są tu wzorcem. Użytkownik wprost chce holdów na przeciąganych nutach i ciągniętym wokalu, także jeśli ludzie robią to rzadziej.
- Czy lepszy detektor z miksu by pomógł. Sprawdzone są tylko cechy z `extract.py`; dłuższe okno HPSS, tolerancja wibrata i kanał środkowy nie były mierzone.
- Czy ścieżki są poprawne. Demucs myli instrumenty, a próg „przeciągany” (`MIN_MS`, spadek do 15 dB) to mój wybór.
- Jak to się gra. To ocenia użytkownik.

## Uruchomienie

W obrazie `mewbeat-ma`: `/repo` to repozytorium tylko do odczytu, `/out` to `.mewbeat-debug`, `/scripts` to katalog `salience` z `feat/`. Najpierw `extract.py` (ścieżki w `.mewbeat-debug/data/stems/`), potem `measure.py`. Logi leżą obok skryptów, pełne wyniki w `.mewbeat-debug/data/stems/_sust/_measure.json`.

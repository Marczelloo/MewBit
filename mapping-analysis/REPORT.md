# Dlaczego mapy generatora mewbeat grają się nienaturalnie: porównanie z mapami osu!mania 4K

Generator: `helpers/mewbeat/charts/` (v19) z cechami z pluginu `lavalink-plugins/mewbeat/` (features v2). Kodu nie zmieniałem.
Korpus: 100 utworów Ranked osu!mania 4K, 292 mapy ludzi i 60 chartów generatora (20 utworów testowych × 3 poziomy).
Szczegóły per poziom: `levels/<poziom>/REPORT.md`. Dane i definicje: `shared/`. Skrypty etapu 3: `synthesis/`.
Wszystkie porównania generatora z ludźmi dotyczą 20 utworów testowych w parach (ten sam utwór i poziom).
Rozkłady podaję jako p10 / p50 / p90 po mapach. „IQR ludzi” to rozstęp międzykwartylowy metryki u ludzi na danym poziomie.

## 1. Najważniejsze wnioski

Przyczyny nienaturalności, od największego wpływu. E, N, H oznaczają poziomy, których przyczyna dotyczy.

1. **Brak szkieletu beatów (E, N, H; najmocniej E).** Ludzie stawiają nutę prawie na każdym beacie, a generator wybiera zdarzenia według klasy instrumentu i siły, nie według miejsca w takcie.
   - Beaty z nutą: 0,36 / 0,63 / 0,62 u generatora wobec 0,86 / 0,92 / 0,95 u ludzi.
   - Downbeaty z nutą: 0,35 / 0,67 / 0,66 wobec 0,95 / 0,96 / 0,96.
   - Przy najłagodniejszym odczycie czasu (przyciągnięcie do siatki w ±25 ms) generator dochodzi do 0,44 / 0,76 / 0,79, więc to nie jest artefakt drgania.
   - Na Normal sama pozycja w siatce przewiduje decyzję człowieka z AUC 0,977.
2. **Błędna siatka (wszystkie poziomy, wzmacnia 1, 3, 5).**
   - W 25 ze 100 utworów beat tracker podaje połowę tempa: zawsze w utworach 190–230 BPM, bo zakres i prior trackera to 60–200 BPM wokół 120. Ludzie traktują te tempa dosłownie, np. na Easy grają 1/2 przy 210 BPM.
   - Faza taktu jest poprawna (≥ 80% downbeatów) tylko w 18 z 90 utworów z siatką, a w 51 trafia w mniej niż 30% downbeatów.
   - 10 utworów nie ma siatki w ogóle.
   - Przy połowie tempa gra liczy też wolniejsze spadanie nut (`chart.bpm`), ok. 24% wolniej.
3. **Za rzadko i bez strumienia 1/2 na Easy i Normal (E, N).**
   - Gęstość względem ludzi: 0,57 (E) i 0,61 (N), Hard 0,78.
   - Odstępy 1/2: E 0,00 wobec 0,28 (zero w 17/20 utworów), N 0,25 wobec 0,64.
   - Najdłuższa seria 1/2: E 0 wobec 5, N 4 wobec 31.
   - Na Normal hamuje to kilka reguł naraz. Eksperyment z samym limitem gęstości daje +0,03; po zdjęciu trzech reguł tnących strumień gęstość Normal dochodzi do 0,78.
   - Na Easy żadne strojenie parametrów nie pomaga, bo przyczyna leży w logice wyboru (pkt 1).
4. **Holdy innego rodzaju niż ludzkie (E, N, H).**
   - U ludzi hold kończy się w chwili następnej nuty w 0,99 / 0,96 / 0,97 przypadków, u generatora w 0,35 / 0,10 / 0,23.
   - Holdy generatora są dłuższe: 2,0 / 1,9 / 1,7 beatu wobec 1,0 / 1,0 / 0,5.
   - Mają nuty w środku: 0,73 / 0,90 / 0,96 holdów wobec 0,00 / 0,13 / 0,19.
5. **Akordów za mało i w złych miejscach (E, N, H; najmocniej H).**
   - Udział akordów: 0,07 / 0,14 / 0,11 wobec 0,16 / 0,32 / 0,50.
   - Akord na starcie kiai: generator ~0, ludzie 0,75 (E) i 1,00 (N, H), co na N i H jest twardą zasadą.
   - Akord na granicy sekcji: 0,00 / 0,13 / 0,12 wobec 0,40 / 0,71 / 0,88.
   - Akordy generatora są prawie zawsze na obie ręce (0,99 na H), u ludzi połowa to skoki jednej ręki.
6. **Słaba reakcja na strukturę utworu (najmocniej E).**
   - Nuta na granicy sekcji: 0,41 / 0,78 / 0,83 wobec 1,00.
   - Na Easy gęstość nie idzie za głośnością: ρ = 0,05 wobec 0,36, a kiai ma gęstość 0,98× reszty wobec 1,23×.
   - Na Easy generator robi 15 pauz ≥ 2 beaty na minutę wobec 3 u ludzi, i to w głośnej muzyce.
7. **Rytm nie powtarza się, gdy powtarza się muzyka (E, N, H).**
   - Identyczność rytmu w muzycznych powtórzeniach: 0,31 / 0,41 / 0,44 wobec 0,90 / 0,91 / 0,94.
   - Przy łagodnym odczycie czasu: 0,57–0,60.
   - Zysk nad linią bazową: 0,12–0,21 wobec 0,28–0,30 u ludzi.
8. **Niższe poziomy nie powstają z wyższych (relacja poziomów).**
   - U ludzi niższy poziom to w 99–100% podzbiór rytmu wyższego, a zostają kolejno downbeaty, beaty, 1/2 i 1/4.
   - U generatora 8–9% nut niższego poziomu nie istnieje na wyższym.
   - Przy Normal → Easy generator zachowuje 61–64% downbeatów i beatów, a jednocześnie 40–48% nut na 1/8, triolach i poza siatką, czyli odwrotnie niż ludzie.
9. **Ręce i wzorce (E, N, H).**
   - Tor zależy od instrumentu: stopa w lewej ręce w 0,74 nut na H, u ludzi 0,50.
   - Lokalnie ręce są nierówne: Easy p50 0,08 wobec 0,03; na Normal p90 ≤ 0,10 ma 5/20 chartów generatora wobec 77/78 map ludzi.
   - Tryli na Hard jest 9 razy więcej: 43,7 wobec 4,7 na minutę.
   - Środkowe tory na Easy mają 63% nut wobec 51%.
10. **Wybór dźwięku według klasy pluginu (N, H).**
    - Hi-haty są pomijane z założenia (Normal recall 0,00 wobec 0,25).
    - Na Hard generator idzie za melodią zamiast za perkusją.
    - Ludzie wybierają prawie niezależnie od instrumentu: przy upraszczaniu kick, snare, hat, bas i lead zostają w zbliżonym stopniu.
    - Na sygnale syntetycznym klasyfikator perkusji pluginu oznaczał 42% hi-hatów jako werbel (`shared/onset_bias.json`).

Twoja obserwacja o Hard i Normal **potwierdza się w tym, co gracz czuje jako „granie z muzyką”**: gęstość, ciągłość 1/2 i odtworzenie ludzkich chwil. Nie potwierdza się jako ogólna przewaga. Szczegóły w części 4.

Hipotezy z `shared/algorithm.md`, które dane **obaliły lub osłabiły**:
- **Brak trioli jest marginalny.** Mapy z ponad 5% trioli: 0/99 E, 3/98 N, 8/95 H, głównie video game.
- **Udział holdów nie jest problemem.** Generator ma go zbliżonego do ludzi (np. H 0,07 wobec 0,07); źle jest z rodzajem holdów.
- **Makrodynamika sekcji na Hard jest zbliżona do ludzkiej:** stosunek gęstości kiai 1,18 wobec 1,27, korelacja z RMS 0,54 wobec 0,49.

## 2. Korpus

**Wybór** (`shared/corpus_selection.md`, `pipeline/corpus/select_corpus.py`, migawka osu! API z 2026-11-02/03):
- **Populacja:** 6103 zestawy Ranked osu!mania z dyfficulty 4K.
- **Wzór:** `score = 0,40·pct(log plays) + 0,25·pct(log favourites) + 0,35·pct(ocena bayesowska)`.
  - Percentyle liczone w grupach (gatunek × okres 3-letni); grupy < 15 zestawów normalizowane tylko w okresie.
  - Ocena bayesowska: średnia ocen ściągnięta do średniej globalnej wagą 10 głosów.
  - Pierwszeństwo mają zestawy z wszystkimi trzema poziomami.
- **Kwoty:** ≤ 25 na gatunek, ≥ 6 gatunków, ≤ 3 zestawy na mappera (host i właściciele wybranych dyfficulty), ≤ 35 na okres, każdy przedział BPM 0,8–1,25× udziału w populacji, jedna piosenka liczy się raz.
- **Podział:** 80 trening / 20 test, rozłączny po mapperach, proporcjonalny do gatunków; w teście same pełne zestawy.

**Zakresy poziomów** (`shared/levels.md`, ustalone regułą zapisaną przed analizą: AIMod, a granica z danych tylko przy różnicy > 0,3★):

| Poziom | Zakres SR | Map | Mapperów (dyfficulty) | SR p10 / p50 / p90 | Trening / test |
|---|---|---|---|---|---|
| Easy | [0; 1,65) | 99 | 80 | 1,21 / 1,45 / 1,58 | 79 / 20 |
| Normal | [1,65; 2,7) | 98 | 81 | 1,93 / 2,15 / 2,37 | 78 / 20 |
| Hard | [2,7; 3,4) | 95 | 82 | 2,78 / 3,08 / 3,35 | 75 / 20 |

**Pokrycie poziomów i nazwy dyfficulty:**
- 93 zestawy mają wszystkie trzy poziomy, a jedna dyfficulty na zestaw i poziom jest najbliższa medianie SR zakresu.
- Nazwy dyfficulty są zawodne: w zakresie Normal jest 1051 dyfficulty nazwanych „Hard”.

**Rozkłady:**
- **Gatunki:** anime 25, electronic 25, video game 21, pop 18, rock 3, novelty 2, po 1 classical, folk, hip hop, jazz, metal i other. Test: electronic 6, anime 5, pop 4, video game 4, novelty 1.
- **Mapperzy:** 81 hostów zestawów, maks. 3 zestawy na hosta.
- **Lata rankingu:** 2013–2026, mediana 2023. Okresy: 2022–24 35, 2025–27 31, 2019–21 16, 2016–18 11, 2013–15 7.
- **BPM:** p10 / p50 / p90 = 130 / 176 / 210, zakres 77–284. Przedziały: < 120: 4, 120–150: 15, 150–180: 33, 180–210: 38, ≥ 210: 10.
- **Popularność:** zagrania p50 377 tys., głosy p50 723.

**Odstępstwa i zmiany kryteriów** (wszystkie opisane w `corpus_selection.md`):
1. **Kryterium BPM zaostrzone dwukrotnie.** Sam dobór po popularności dawał 10% utworów < 150 BPM (populacja 25%) i 21% ≥ 210 BPM (populacja 7%). Gra gra głównie utwory < 150 BPM.
2. **Deduplikacja piosenek.** Dwie piosenki trafiły dwa razy od różnych mapperów, po jednej kopii w treningu i teście.
3. **Jeden zestaw wykluczony** (1746870). Żadna kopia z mirrorów nie zgadzała się z sumami MD5 oficjalnego API.
- Kwoty spełnione bez odstępstw. Pliki `.osz` pochodzą z mirrora osu.direct za Twoją zgodą; każda wybrana dyfficulty jest zweryfikowana co do MD5 z oficjalnym API.

**Możliwe zniekształcenia próby:**
- Popularne mapy osu!mania to głównie szybka muzyka japońska i elektroniczna: anime, electronic i video game to 71% korpusu. Pop zachodni, hip hop i rock, czyli typowe utwory bota, są słabo reprezentowane. Tylko 4 gatunki nadają się do porównań.
- 67% map pochodzi z lat 2022–2027, tak jak w populacji. Styl ostatnich lat dominuje.
- Mapy Ranked przeszły modding, więc to wzorzec „poprawnego” mapowania, nie przeciętnego.
- Gracz Easy osu! nie jest nowicjuszem z Discorda (część 8).

**Jakość dopasowania nut do audio** (`shared/alignment.md`):
- Oś czasu osu! wyprzedza zdekodowane audio o 19–54 ms (mediana 36). Przyczyną jest m.in. opóźnienie enkodera MP3, które obcina ffmpeg.
- Korygowane jednym przesunięciem na utwór. Zgodność z niezależnym dopasowaniem na onsetach pluginu: mediana 3 ms. Dryf w utworze: p90 5 ms.
- 5 utworów oznaczonych do ostrożnej interpretacji.
- Detektory onsetów skalibrowane na sygnale o znanych onsetach (librosa −10…−14 ms, poprawiane).

## 3. Poziomy

Profil ludzi pochodzi z treningu (reguły sprawdzone na teście), porównanie z generatorem z testu.
Klasa: **Z** = twarda zasada (≥ ~95% map), **T** = silna tendencja (~75–95%), **S** = styl mappera lub gatunku.
Wszystkie reguły Z i T potwierdziły się na 20 mapach testowych każdego poziomu.

### 3.1 Easy (`levels/easy/REPORT.md`)

**Profil ludzi** (79 map, 60 mapperów):
- **Szkielet** (Z/T): nuta na 81% beatów i 90% downbeatów, w najgłośniejszej tercji utworu na 94% beatów, w najcichszej na 62%.
- **1/2 okazjonalnie:** 18% półbeatów; serie zwykle ≤ 5 nut (zgodnie z RC).
- **Gęstość:** ok. 3,4 nuty/s (p10–p90 2,7–4,4) niezależnie od BPM, więc w beatach maleje z tempem. Najkrótszy odstęp to zawsze 1/2 beatu, także ok. 140 ms przy 210+ BPM.
- **Holdy** (Z/T): 1-beatowe, puste, kończone w chwili następnej nuty (0,99), zaczynane na beacie (0,95). Udział 0,03–0,25, zależnie od utworu (S).
- **Akordy:** 16% chwil, połowa na jedną rękę. Na wejściu kiai akord w 75%, nuta w 96%.
- **Struktura:** nuta na każdej granicy sekcji (T: 71/79 map), kiai gęstsze 1,23×, gęstość koreluje z RMS (ρ 0,36).
- **Pauzy:** ≥ 2 beaty ok. 3 na minutę, ≥ 8 beatów rzadko, tylko w cichych miejscach.
- **Ręce** (Z): równe także w oknach 4 taktów (|lewa − 0,5| p50 0,03), tory równo obciążone.

**Gatunki** (anime, electronic, video game, pop; reszta za mała):
- Reguły Z i T obowiązują w każdym z nich.
- Po kontroli BPM różni się tylko podążanie za wokalem: anime 0,42 i pop 0,35 chwil na onsecie wokalu wobec electronic 0,17.
- Electronic ma więcej krótkich pauz (8 na minutę, dropy i breaki): to styl.
- Ilość 1/2 zależy od BPM, nie od gatunku.

| Metryka (test, n = 20) | Ludzie p10 / p50 / p90 | Generator p10 / p50 / p90 |
|---|---|---|
| nuty/s | 2,72 / 3,64 / 4,40 | 1,43 / 1,87 / 2,41 |
| beaty z nutą | 0,68 / 0,86 / 0,92 | 0,22 / 0,36 / 0,56 |
| downbeaty z nutą | 0,77 / 0,95 / 1,00 | 0,05 / 0,35 / 0,71 |
| odstępy 1/2 | 0,04 / 0,28 / 0,38 | 0,00 / 0,00 / 0,09 (zero w 17/20 utworów, wszystkich ≥ 150 BPM) |
| odstępy 2-beatowe | 0,00 / 0,03 / 0,14 | 0,12 / 0,26 / 0,81 |
| min. odstęp [ms] | 135 / 162 / 198 | 214 / 286 / 327 |
| akordy | 0,01 / 0,16 / 0,22 | 0,00 / 0,07 / 0,13 |
| puszczenie holda na następnej nucie | 0,93 / 0,99 / 1,00 | 0,17 / 0,35 / 0,49 |
| holdy z nutą w środku | 0,00 / 0,00 / 0,09 | 0,50 / 0,73 / 0,93 |
| pauzy ≥ 2 beaty / min | 0,0 / 3,0 / 14,7 | 6,6 / 15,0 / 26,2 |
| nuta na granicy sekcji | 0,74 / 1,00 / 1,00 | 0,12 / 0,41 / 0,81 |
| gęstość ~ RMS (ρ) | −0,05 / 0,36 / 0,55 | −0,13 / 0,05 / 0,30 |
| recall / precision względem człowieka | – | 0,43 / 0,84 |

Na trzech gatunkach testu z ≥ 4 utworami różnice mają ten sam kierunek; pojedyncze gatunki są zbyt małe na osobne wnioski.

**Problemy Easy** (od największego wpływu):
1. Rwany puls bez szkieletu beatów (pkt 1.1).
2. Brak 1/2 powyżej 150 BPM (pkt 1.3).
3. Siatka: połowa tempa w 8/20, zła faza w 13/19 (pkt 1.2).
4. Holdy (pkt 1.4).
5. Brak reakcji na strukturę (pkt 1.6).
6. Dziury w głośnej muzyce zamiast prawdziwych przerw.
7. Powtórzenia.
8. Ręce i środek klawiatury: tory 1+2 mają 0,63 nut.
9. Stałe 1,5 s bez nut na początku (niski wpływ).

**Adaptacja z osu!:** nowicjusz z Discorda może potrzebować mniejszej gęstości niż gracz osu! Easy. Najpierw należy usuwać 1/2 i beaty w cichych fragmentach, a beaty i downbeaty głośnych fragmentów zostawić. Rozstrzygnie to test z graczem.

### 3.2 Normal (`levels/normal/REPORT.md`)

**Profil ludzi** (78 map, 61 mapperów):
- **Ciągły puls** (Z/T): nuta na 89% beatów, 61% półbeatów, 3% ćwierćbeatów. Pozycja w siatce przewiduje wybór z AUC 0,977; dźwięk decyduje głównie o półbeatach.
- **Gęstość ok. 6 nut/s** (5,0–7,3) w całym zakresie 100–284 BPM.
- **Podział zależy od tempa:** < 150 BPM pojawia się 1/4, 150–230 BPM dominuje 1/2, od ok. 240 BPM 1/1. RC przewiduje ten próg niżej (240 → minimalne 1/2); dane trzymają 1/2 dłużej.
- **Długie serie 1/2:** najdłuższa p50 31 nut. RC prosi o pauzę 1/1 po każdej frazie; w 53/78 mapach serie nie przekraczają 33 nut, ale zalecenie „where natural” jest często pomijane.
- **Holdy:** ≥ 1/2 beatu (Z, 77/78). Krótkie (< ¾ beatu) puste, puszczenie na następnej chwili 0,96. W długich holdach (≥ 1½) druga ręka gra w ok. połowie map (S).
- **Akordy:** 32% chwil, na 51% zmapowanych beatów; liczba akordów w takcie rośnie z głośnością (ρ 0,33). Akord na starcie kiai w 68/70 map (Z), na granicy sekcji 0,71.
- **Ręce** w oknach 4 taktów: p90 ≤ 0,10 w 77/78 map (Z). Lewa ręka 0,50 dla każdej klasy dźwięku, wbrew radzie poradnika o „pitch relevancy”.
- **Rytm w powtórzeniach muzyki:** 0,91.

**Gatunki:**
- Reguły wspólne.
- Po kontroli BPM różni się tylko trafianie w wokal: anime 0,39, pop 0,34, video game 0,30, electronic 0,20.
- Różnice nominalne (więcej półbeatów i akordów w strumieniu w anime, więcej przerw w electronic) nie przeżywają korekty na wielokrotne testy.

| Metryka (test, n = 20) | Ludzie p10 / p50 / p90 | Generator p10 / p50 / p90 |
|---|---|---|
| nuty/s | 5,12 / 6,00 / 6,93 | 2,92 / 3,70 / 4,73 |
| beaty z nutą | 0,77 / 0,92 / 0,96 | 0,32 / 0,63 / 0,73 |
| półbeaty z nutą | 0,34 / 0,58 / 0,84 | 0,06 / 0,23 / 0,43 |
| odstępy 1/2 | 0,46 / 0,64 / 0,81 | 0,08 / 0,25 / 0,48 |
| najdłuższa seria 1/2 | 12,7 / 31 / 67,5 | 3 / 4 / 10 |
| akordy | 0,20 / 0,32 / 0,46 | 0,04 / 0,14 / 0,19 |
| akord na granicy / na starcie kiai | 0,71 / 1,00 (p50) | 0,13 / 0,00 (p50) |
| długość holda [beaty] | 0,50 / 1,00 / 1,30 | 1,38 / 1,86 / 2,77 |
| puszczenie holda na następnej nucie | 0,84 / 0,97 / 1,00 | 0,02 / 0,10 / 0,20 |
| holdy z nutą w środku | 0,00 / 0,13 / 0,36 | 0,71 / 0,90 / 0,96 |
| nuta na granicy sekcji | 0,85 / 1,00 / 1,00 | 0,42 / 0,78 / 1,00 |
| rytm w powtórzeniach | 0,91 (p50) | 0,41 (łagodnie: 0,60) |
| recall / precision | – | 0,58 / 0,85 |

Niedobory występują w każdym z czterech dużych gatunków.

**Problemy Normal** (od największego wpływu):
1. Za rzadko i bez strumienia 1/2 (pkt 1.3): „gdy stawia nutę, trafia (precyzja 0,85), ale pomija 42% ludzkich chwil”.
2. Tempo i faza (pkt 1.2). W 12/19 utworów odczuwany beat generatora to 2 beaty ludzkie, bo `feltBeatMs` mnoży beat przez `foldFactor` albo tracker łapie połowę tempa. Wszystkie progi Normal działają wtedy dwa razy za mocno.
3. Holdy (pkt 1.4).
4. Akordy (pkt 1.5).
5. Dziury w pulsie: odstępy 3/2 i 2 beaty 0,03 i 0,04 wobec 0,01 i 0,00 (częstsze w 18/20 utworów).
6. Przerwy i kontrast: generator gra w 11/13 ludzkich przerw ≥ 4 beaty.
7. Powtórzenia.
8. Ręce i tryle w jednej ręce.
9. Hi-haty pominięte.
10. W 5 utworach nuty systematycznie o 8–10 ms za wcześnie (niski wpływ).

### 3.3 Hard (`levels/hard/REPORT.md`)

**Profil ludzi** (75 map, 62 mapperów):
- **Szkielet półbeatów** (Z/T): nuta na 93% beatów i 83% półbeatów. 76% zmapowanych beatów to akordy, 1/4 tam, gdzie słychać perkusję.
- **Gęstość:** ok. 9,4 nuty/s niezależnie od BPM, liczba nut na beat maleje z tempem, zgodnie ze skalą RC.
- **Twarde zasady:**
  - brak nut poza siatką i prawie puste sloty 1/8;
  - ręce 50 ± 2%, także w każdych 4 taktach, bez przypisywania instrumentu do ręki;
  - akordy w ≥ 25% chwil, połowa to skoki jednej ręki;
  - akord na downbeacie granicy sekcji i na starcie kiai;
  - puszczenia holdów na siatce 1/4;
  - tryle ≤ 9 nut.
- **Holdy** to krótkie nuty rytmiczne (p50 ½ beatu) kończone przy następnej chwili (0,97). Poradnik zachęca do łączenia LN z nutami 1/4, ale dane z tego zakresu SR tego nie pokazują.
- **Anchory:** sprzeczne z RC w ok. połowie map (anchor ≥ 5 nut w 53%).
- **Akordy w strumieniach 1/4:** ok. 1/3 map stawia je gęściej niż co 1 beat (jumpstreamy), wbrew RC.

**Gatunki** (po odjęciu BPM):
- anime i pop mają więcej akordów (0,52 i 0,44 wobec 0,36–0,38), bardziej zróżnicowane wzorce i więcej holdów;
- electronic i video game mają wzorce bardziej powtarzalne, video game więcej schodów i 1/4;
- to styl gatunku, potwierdzony kierunkiem na teście.

| Metryka (test, n = 20) | Ludzie p10 / p50 / p90 | Generator p10 / p50 / p90 |
|---|---|---|
| nuty/s | 8,06 / 9,11 / 10,85 | 5,26 / 7,04 / 7,76 |
| chwile na beat | 2,02 (p50) | 2,01 (p50) |
| beaty z nutą | 0,85 / 0,95 / 0,99 | 0,48 / 0,62 / 0,77 |
| półbeaty z nutą | 0,65 / 0,82 / 0,93 | 0,34 / 0,53 / 0,67 |
| najdłuższa seria 1/2 | 19,6 / 36,5 / 100,5 | 7 / 10 / 18 |
| akordy | 0,29 / 0,50 / 0,56 | 0,05 / 0,11 / 0,20 |
| akordy na obie ręce | 0,45 / 0,52 / 0,68 | 0,94 / 0,99 / 1,00 |
| akord na starcie kiai | 1,00 (p50) | 0,00 (p50) |
| długość holda [beaty] | 0,50 / 0,50 / 1,00 | 1,37 / 1,71 / 2,88 |
| puszczenie holda na następnej nucie | 0,78 / 0,97 / 1,00 | 0,09 / 0,23 / 0,45 |
| tryle / min | 4,7 (p50) | 43,7 (p50) |
| lewa ręka przy stopie | 0,50 | 0,74 |
| recall / precision | – | 0,74 / 0,71 |

Hard generatora ma tyle samo chwil na beat co ludzie (2,01 wobec 2,02), ale mniej nut/s, bo prawie bez akordów. Makrodynamika sekcji, kiai i kontrast są zbliżone do ludzkich.

**Problemy Hard** (od największego wpływu):
1. Rytm bez szkieletu: dziury w półbeatach, nuty na 1/8, odstępy „other” 0,19, po łagodnym odczycie 0,05.
2. Akordy (pkt 1.5).
3. Siatka: drganie, połowa tempa w 8/19, zła faza w 12/19.
4. Holdy.
5. Gęstość: limit liczy nuty, a nie chwile.
6. Ręka zależna od instrumentu.
7. Tryle.
8. Melodia zamiast perkusji.
9. Granice sekcji i start kiai bez akcentu.
10. Słabsze powtarzanie rytmu.
11. Start chartu.

## 4. Różnice między poziomami

### 4.1 Czy Hard generatora jest lepszy niż Normal?

Sprawdziłem to dwoma sposobami (`synthesis/level_distance.py`, panel 18 metryk ustalony przed liczeniem).

**Cały panel: hipoteza się nie potwierdza.** Mediany odległości od ludzi po metrykach (w IQR ludzi): Easy 1,26, Normal 1,18, Hard 1,13. Po utworach (mediana panelu w utworze: Easy 1,46, Normal 1,27, Hard 1,37) Hard jest bliżej ludzi niż Normal w 11 z 20 utworów (dokładny Wilcoxon p = 0,67): bez różnicy. Normal jest bliżej ludzi niż Easy także tylko w 11 z 20 (p = 0,105), więc na pełnym panelu żaden poziom nie odstaje istotnie. Easy jest najsłabszy w wymiarach „grania z muzyką” (tabela niżej: gęstość, beaty i półbeaty z nutą, odstępy 1/2, recall), nie Normal.

**Wymiary „grania z muzyką”: hipoteza się potwierdza.** Stosunek generator / człowiek w tym samym utworze:

| Wymiar | Easy | Normal | Hard | Hard bliżej ludzi niż Normal |
|---|---|---|---|---|
| gęstość (nuty/beat) | 0,57 | 0,61 | 0,78 | 19/20, p < 0,001 |
| półbeaty z nutą | 0,24 | 0,44 | 0,67 | 18/20, p = 0,003 |
| odstępy 1/2 | 0,00 | 0,44 | 0,61 | 14/20, p = 0,004 |
| najdłuższa seria 1/2 | 0,00 | 0,15 | 0,29 | 14/20, p = 0,09 |
| odtworzone ludzkie chwile (recall) | 0,43 | 0,58 | 0,74 | 18/20, p < 0,001 |
| beaty z nutą | 0,42 | 0,72 | 0,66 | 9/20, bez różnicy |
| akordy | 0,37 | 0,40 | 0,25 | 5/20 (Normal lepszy, p = 0,019) |

Hard jest też bliżej w pauzach, minijackach, holdach (puszczenie 3,5 wobec 9,8 IQR) i nutach poza siatką. Normal jest bliżej w akordach, trylach, pokryciu beatów, powtórzeniach i trafianiu w onsety.

**Wniosek.** Na Hard generator gra prawie tyle co człowiek i odtwarza 74% ludzkich chwil, więc „gra z muzyką”, choć z błędami akordów i wzorców. Na Normal gra 61% ludzkiej gęstości, z rwanym strumieniem 1/2 i w połowie utworów w połowie tempa. To prawdopodobnie odczuwasz jako „wyraźnie gorzej”. Precyzja jest odwrotna (Normal 0,85, Hard 0,71): nuty Normal są poprawne, ale jest ich za mało.

**Co to powoduje w kodzie** (`shared/algorithm.md`, część 4; sprawdzone eksperymentem `synthesis/ablation.py`):
1. **Hard przechodzi przez filtr bez reguł „czytelności”.** Ma tylko odstępy w ms, `maxJack 3` i limit gęstości 9 nut/s, sufit 10. To blisko ludzkich 9,1 nut/s; ludzkie szczyty w oknie 2 s to 1,2× sufitu.
2. **Normal ma najwięcej reguł wyjątkowych.** `maxFastRun 3` (≤ 3 szybkie odstępy z rzędu), `maxQuarterShare 0,1`, `quarterMinEnergy 0,75`, `gapBeats ¼` w „odczuwanych” beatach, `chordGapBeats`. Do tego `maxNps 5`, sufit 5,5: ludzkie szczyty w oknie 2 s to 1,45× sufitu, najdalej ze wszystkich poziomów.
3. **Wynik eksperymentu na Normal** (generator bez zmian, parametry nadpisane w pamięci):
   - sam limit gęstości 6,5 / 7,5: gęstość 0,61 → 0,64;
   - zdjęcie `maxFastRun`, `maxQuarterShare`, `quarterMinEnergy`: gęstość 0,69, odstępy 1/2 0,40;
   - wszystko razem: gęstość 0,78, półbeaty 0,39, odstępy 1/2 0,47, recall 0,71, czyli poziom Hard.

   Koszt: akordy spadają do 0,04, a precyzja do 0,75. Pokrycie beatów nie rośnie (0,63 → 0,66), bo zależy od siatki i wyboru zdarzeń (pkt 1.1, 1.2).
4. **`feltBeatMs` mnoży beat przez `foldFactor`.** Na Easy i Normal każde złożenie tempa podwaja wszystkie progi liczone w beatach. Na Hard tych progów nie ma.

### 4.2 Czy niższe poziomy powstają przez przerzedzenie wyższych?

**W kodzie: nie.** Każdy poziom jest liczony osobno ze wspólnej puli zdarzeń i ma własne filtry, limity i dodatkowe przebiegi. Easy może iść za innym layerem prowadzącym (`vocalLeads`) i gra tylko jeden layer (`oneLayer`); `generate.js:chartNotes`. Nie ma kroku „weź Hard i usuń”.

**W danych** (`synthesis/cross_levels.py`; ludzie: 94–97 pełnych zestawów, generator: 20 testowych):

| Para | Ludzie: niższy / wyższy (chwile) | Ludzie: chwile niższego obecne w wyższym | Generator: niższy / wyższy | Generator: obecne w wyższym | Generator: nowe nuty |
|---|---|---|---|---|---|
| Hard → Normal | 0,73 | 1,00 | 0,54 | 0,91 | 0,09 |
| Normal → Easy | 0,66 | 0,99 | 0,54 | 0,92 | 0,08 |
| Hard → Easy | 0,49 | 1,00 | 0,29 | 0,93 | 0,07 |

Co zostaje z wyższego poziomu (mediana po zestawach):

| Para | downbeat | beat | 1/2 | 1/4 | 1/8 | triole | poza siatką | akord (chwila) | hold |
|---|---|---|---|---|---|---|---|---|---|
| ludzie H → N | 0,99 | 0,95 | 0,72 | 0,16 | 0,21 | 0,14 | 0,00 | 0,99 | 0,96 |
| generator H → N | 0,90 | 0,87 | 0,37 | 0,06 | 0,19 | 0,22 | 0,47 | 0,72 | 0,55 |
| ludzie N → E | 0,98 | 0,89 | 0,34 | 0,04 | 0,00 | 0,07 | – | 0,98 | 0,86 |
| generator N → E | 0,61 | 0,64 | 0,16 | 0,21 | 0,40 | 0,45 | 0,48 | 0,89 | 0,46 |

**Zasady upraszczania u ludzi:**
1. **Niższy poziom to podzbiór rytmu wyższego.** Ludzie usuwają chwile, a nie przesuwają ich ani nie dodają: 0–1% nowych nut.
2. **Usuwa się według hierarchii metrycznej.** Downbeat zostaje prawie zawsze, beat prawie zawsze, 1/2 częściowo, 1/4 prawie nigdy. Hard → Easy: 0,95 / 0,86 / 0,24 / 0,00.
3. **Akord upraszcza się do pojedynczej nuty w tym samym miejscu.** Chwila akordu zostaje w 98–99%, ale jako akord tylko w 56% (H → N) i 22% (N → E).
4. **Holdy zostają** (86–96%) i na niższym poziomie ich udział lekko rośnie (H 0,07 → N 0,09 → E 0,13). Długi dźwięk zostaje holdem, a gęste nuty wokół znikają.
5. **Instrument prawie nie ma znaczenia.** H → N zachowuje kick 0,73, snare 0,80, hat 0,80, bas 0,76, lead 0,80.
6. **Tory są układane od nowa.** Zgodność torów na wspólnych chwilach to tylko 0,44–0,53: rytm się dziedziczy, wzorzec nie.

**Generator:**
- nie jest zagnieżdżony: 7–9% nowych nut;
- przerzedza mocniej (Easy ma 29% chwil Hard wobec 49% u ludzi);
- nie trzyma hierarchii. Przy N → E zachowuje 61–64% downbeatów i beatów, a 40–48% nut na 1/8, triolach i poza siatką, czyli odwrotnie niż ludzie;
- odrzuca według klasy instrumentu: hat zostaje w 12% przy H → N.

## 5. Audyt kodu

Ścieżki względem repozytorium. „Ryzyko” dotyczy pozostałych poziomów. Parametry z `DIFFICULTIES` są niezależne między poziomami, ale funkcje wspólne działają na wszystkich.

| # | Problem (poziomy) | Plik i funkcja | Dziś | Dowód | Proponowana zmiana | Ryzyko dla innych poziomów | Wpływ / nakład |
|---|---|---|---|---|---|---|---|
| A1 | Połowa tempa (E, N, H) | `dsp/TempoEstimator.java` (`MIN_BPM 60`, `MAX_BPM 200`, `PRIOR_CENTRE_BPM 120`, l. 11–14); `charts/timing.js:foldTempo` (l. 37, podwaja tylko < 95 BPM przy ≥ 8 onsetach/beat) | Tempo szybkich utworów wypada na ~100 BPM | 25/100 utworów, wszystkie 190–230 BPM; ludzie grają je dosłownie | Zakres trackera do ~300 BPM. Wybór oktawy tempa: kandydat 2× wygrywa, gdy silnych onsetów na beat ≥ ~4 albo gdy daje ludzką gęstość. Test: `algo_beat_tracking` | Wspólne. Hard dostaje 2× gęstszą siatkę, więc jego reguły w ms (`minNoteGapMs`) muszą zostać, a progi w beatach trzeba przeliczyć | wysoki / średni |
| A2 | Zła faza taktu (E, N, H) | `TempoEstimator` → `downbeatPhase` (jedna faza mod 4 na utwór); `FeatureExtractor.finish` (l. 209) | Downbeat co 4 beaty od jednej fazy | Faza ≥ 0,8 w 18/90 utworów, < 0,3 w 51/90 | Faza per sekcja (zmiana chromy, niskie pasmo, akcent werbla na 2 i 4); kontrola na granicach fraz | Wspólne: akordy, frazy i akcenty zależą od downbeatów na każdym poziomie | wysoki / średni |
| A3 | Brak siatki (wszystkie) | `timing.js:buildTiming` (próg pewności 0,5 / 0,35) | `NO_TIMING`: nuty w surowych czasach | 10/100 utworów; np. 2270163: nuty na 1/4 i holdy na 1/6–1/8 | Fallback na siatkę z najlepszego kandydata tempa z obniżoną pewnością zamiast braku siatki | Wspólne, ryzyko niskie | średni / niski |
| A4 | Wolniejsze spadanie przy połowie tempa (wszystkie) | `generate.js:chartFrom` (l. 212, `bpm` z mediany beatu) → `activity/.../highway.js:tempoScrollFactor` | √(BPM/120) w [0,85; 1,2] | 200 BPM liczone jako 100: 0,91 zamiast 1,2, ok. 24% wolniej | Brać BPM po korekcie A1 | Wspólne, brak ryzyka | średni / niski |
| B1 | Brak szkieletu beatów (E, N, H) | `patterns.js:drumEvents` (l. 117: level 0 tylko na beacie i przy sile ≥ mediana frazy), `hatsOf` (level 2), `tonalEvents` (l. 265); `difficultyFilter.js:applyDifficulty`, `selectionOrder` | Wybór według poziomu zdarzenia i siły | Beaty 0,36 / 0,63 / 0,62 wobec 0,86 / 0,92 / 0,95. Eksperyment Easy: parametry nie pomagają, `maxLevel 1` daje beaty 0,45 przy precyzji 0,75 | Wybór momentów według hierarchii metrycznej: najpierw downbeaty i beaty, gdzie muzyka brzmi (RMS lub dowolny onset), potem 1/2, potem 1/4. Siła i klasa instrumentu tylko porządkują w obrębie poziomu hierarchii (część 6) | Duża zmiana wspólna. Hard może stracić melodyczne synkopy, więc je zachować jako warstwę 1/4 przy perkusji lub wokalu | wysoki / wysoki |
| C1 | Za rzadki Normal, bez strumienia 1/2 (N) | `difficulty.js` normal: `maxNps 5`, `maxNpsCeiling 5,5`, `maxFastRun 3`, `maxQuarterShare 0,1`, `quarterMinEnergy 0,75`; `difficultyFilter.js:fastRunHolds`, `capQuarters`, `densityHolds` | Strumień 1/2 cięty co 3–4 nuty | Seria 1/2: 4 wobec 31. Eksperyment: bez trzech reguł i z limitem 6,5 / 7,5 gęstość 0,78, recall 0,71 | Usunąć `maxFastRun` i `quarterMinEnergy`; `maxQuarterShare` zastąpić BPM-zależnym podziałem (≥ 150 BPM: 1/2, < 150 BPM: dopuścić 1/4); cel ~6 nut/s | Tylko Normal (parametry poziomu). Pilnować akordów (spadły do 0,04) i precyzji | wysoki / niski |
| C2 | Easy bez 1/2 powyżej 150 BPM (E) | `difficulty.js` easy `minNoteGapMs 200` (l. 51); `difficultyFilter.js:fits`, `enforceFloors` | 1/2 < 200 ms odrzucane | 1/2 0,00 wobec 0,28, zero w 17/20 utworów | Próg w beatach (1/2) z dolną granicą ~130 ms; ilość 1/2 malejąca z BPM, serie ≤ 5 | Tylko Easy. Działa dopiero razem z B1 (eksperyment: sam próg daje +0,01) | średni / niski |
| C3 | Progi w „odczuwanych” beatach (E, N) | `difficultyFilter.js:feltBeatMs` (l. 21: beat × `foldFactor`) | Przy złożonej siatce każdy próg działa 2× mocniej | 12/19 utworów Normal ma odczuwany beat = 2 beaty ludzkie | Po A1 progi w beatach siatki ludzkiej skali (bez `foldFactor`) | Easy i Normal; Hard nie używa `gapBeats` | średni / niski |
| D1 | Holdy puszczane przed następną nutą (E, N, H) | `holds.js:addGapHolds` (l. 277; puszczenie = `next − gapAfterHold` l. 292; `GAP_MIN_BEATS 1,25`, `GAP_MAX_BEATS 2`) | Hold kończy się 200–350 ms przed następną nutą ręki albo po 2 beatach | Puszczenie na następnej nucie 0,35 / 0,10 / 0,23 wobec 0,99 / 0,96 / 0,97 | Puszczenie = najbliższa następna chwila, przyciągnięte do siatki. Gdy następna nuta jest w tej samej ręce, puścić 1/4 beatu wcześniej albo przenieść nutę do drugiej ręki (gra wymaga przerwy ≥ ~100 ms dla tej samej ręki). Długość domyślnie 1 beat (E, N) lub ½–1 beat (H) | Wspólne. Okno puszczenia ×1,5 zostaje; sprawdzić grywalność puszczenia razem z naciśnięciem | wysoki / średni |
| D2 | Nuty w trakcie holdów (E, N, H) | `difficulty.js` easy `holdOtherHand "spaced"` (l. 58, nagłówek `holds.js` błędnie mówi „blocked”), normal `"spaced"`, hard `"free"`; `holds.js:spacedBlocked`, `planHolds` (l. 145), `addSustainHolds` (l. 211) | Druga ręka gra w trakcie holdów, długość z trackera wysokości | Holdy z nutą w środku 0,73 / 0,90 / 0,96 wobec 0,00 / 0,13 / 0,19; holdy 1-beatowe Normal 0,78 wobec 0,06 | Easy `"blocked"` (jak w nagłówku i RC). Normal i Hard: holdy < 1½ beatu puste, dłuższe z rzadką drugą ręką. Długość kwantowana do siatki | Ustawienia poziomów niezależne, `planHolds` wspólne | wysoki / niski |
| E1 | Za mało akordów, zawsze na obie ręce (E, N, H) | `patterns.js:withChords` (l. 339: tylko na `isBarStart`, lustro = druga ręka); `difficultyFilter.js:thinChords` (l. 261), `capMoments(…, 2)` (l. 363); `hard.chord` działa tylko w `bandPath`; Hard `densityByMoment` brak | Najwyżej 1 akord na takt, zawsze oburęczny, nigdy 3 nuty | Akordy 0,07 / 0,14 / 0,11 wobec 0,16 / 0,32 / 0,50; na obie ręce 0,99 wobec 0,52; ρ akordów z RMS −0,01 wobec 0,33 | Akord na silnych beatach głośnych taktów, z udziałem rosnącym z RMS (cel N ~0,3, H ~0,45 chwil). Połowa akordów jako skok jednej ręki (sąsiednie tory). Hard: do 3 nut na akcentach (RC 4K Hard pozwala ≤ 3). Hard: `densityByMoment` true, żeby akord nie zjadał limitu | Wspólne funkcje. Na Easy ostrożnie: tylko downbeaty i starty sekcji | wysoki / średni |
| E2 | Brak akcentu na starcie sekcji i kiai (E, N, H) | Brak reguły; sekcje tylko z energii (`dsp/Highlight.sections`), frazy stałe 16 beatów (`phrases.js`, `Repetition`) | Nic nie wymusza nuty ani akordu na granicy | Akord na starcie kiai ~0 wobec 0,75 / 1,00 / 1,00; akord na granicy 0–0,13 wobec 0,40–0,88 | Wykrywać starty sekcji z nowości audio (np. jak w `audio_metrics.section_boundaries`), wymuszać nutę i akord na pierwszym downbeacie sekcji głośniejszej | Wspólne, ryzyko niskie | średni / niski |
| F1 | Pauzy w głośnej muzyce, brak przerw w cichej (E, N) | `rests.js:fillRests` (l. 79; jedna nuta w środek pauzy ≥ 2 beaty), `restsOf`; `pulsePowerFloor` | Dziury 2–4 beaty w głośnych miejscach, cisza „zapychana” | Easy: 15 / min wobec 3; pauzy ≥ 4 beaty w głośnej muzyce 1,00 wobec 0; Normal gra w 11/13 ludzkich przerw | W głośnych fragmentach zapełniać beat (z B1), przerwy ≥ 4 beaty tylko przy RMS < ~0,4 p95 lub przy granicy sekcji | Easy i Normal; Hard używa `fillGaps` | średni / niski |
| F2 | Gęstość nie idzie za głośnością na Easy (E) | `intensity.js`, `densityHolds` | Intensywność nie przebija się przez inne progi | ρ 0,05 wobec 0,36; kiai 0,98× wobec 1,23× | Z B1: pokrycie beatów według tercji RMS (ludzie 94% / 62%) | Tylko Easy | średni / niski |
| G1 | Rytm nie powtarza się z muzyką (E, N, H) | `generate.js:copiedRepeat` (l. 71), `repeats.js:copyRepeat` (`EVENT_TOLERANCE_MS 60`), `phrases.js:REPEAT_SIMILARITY 0,85` (frazy 16-beatowe), `barRepeats.js:repeatBarLanes` (kopiuje tory, nie rytm) | Kopiowane tylko frazy uznane przez plugin; reszta od zera | Rytm w powtórzeniach 0,31 / 0,41 / 0,44 wobec ~0,9 (łagodnie 0,57–0,60) | Wykrywanie powtórzeń w oknach 4 taktów przy podobieństwie ~0,75 (kalibracja w `shared/metrics.md`). Kopiowanie rytmu powtórzonego okna (tory albo lustro), a nie tylko torów taktu | Wspólne, ryzyko średnie (fałszywe powtórzenia) | średni / średni |
| H1 | Tor zależny od instrumentu, lokalna nierównowaga rąk (E, N, H) | `patterns.js:hitsOf` (`KICK_LANES [0,3]`, `SNARE_LANES [1,2]`, l. 78), `MIXED_KICK_LANES [0,1]`, `CONTOUR_START_LANE 1`; `seams.js:balanceHands` (odbija całą frazę) | Stopa w lewej ręce we frazach mieszanych | Stopa w lewej 0,74 (H); \|lewa − 0,5\| w 4 taktach p50 0,08 wobec 0,03 (E); środek 0,63 (E) | Tory z wzorca, nie z instrumentu; balans rąk w oknach 4 taktów; równe obciążenie torów | Wspólne, ryzyko niskie | średni / niski |
| H2 | Tryle i powtórzenia toru (H, E) | `patterns.js:tonalLanes` (tryl dla szybko powtórzonego dźwięku), naprzemienność `seen % 2` | Za dużo tryli na H, wolne przeskoki co 2 beaty na E | H 43,7 wobec 4,7 tryli / min; E x-y-x 0,23 wobec 0,08, ale prawdziwych tryli mniej | Limit tryli (≤ 9 nut, RC), urozmaicenie wzorców (schody, skoki) | Wspólne, ryzyko niskie | niski / niski |
| I1 | Niższe poziomy nie są zagnieżdżone (E, N) | `generate.js:chartNotes` (każdy poziom osobno), `leadersOf` (`vocalLeads` Easy), `oneLayer` | 7–9% nowych nut; odwrócona hierarchia N → E | Część 4.2 | Niższy poziom jako podzbiór rytmu wyższego wybrany według hierarchii (część 6), z osobnym ułożeniem torów | Architektura, wszystkie poziomy | wysoki / wysoki |
| J1 | Hi-haty i klasy pluginu (N, H) | `patterns.js:hatsOf` (level 2; tylko Hard), wybór lidera (`phrases.js:chooseLeaders`) | Hat nie trafia na Normal; Hard idzie za melodią | Normal recall hatów 0,00 wobec 0,25; ludzie zachowują klasy równo | W B1 klasa instrumentu nie wyklucza zdarzenia; hat może nieść półbeat | Wspólne | niski / niski (w ramach B1) |
| K1 | Stałe 1,5 s bez nut (E) | `difficulty.js:LEAD_IN_MS 1500` | Pierwsza nuta ≥ 1,5 s | Ludzie p50 0,96 s | Zostawić lub skrócić do ~1 s. Bot może grać upload z innym początkiem, więc część opóźnienia jest uzasadniona | Wspólne | niski / niski |

## 6. Plan zmian

**Kolejność** (każdy krok mierzony tym samym pipeline'em na 20 utworach testowych, a strojenie na 80 treningowych, żeby nie dopasować się do testu):

1. **Szybkie poprawki parametrów i holdów** (C1, C2, C3 po części, D1, D2, E2, K1). Nakład niski.
   - Sukces:
     - Normal: gęstość ≥ 0,75 ludzkiej, półbeaty ≥ 0,4, seria 1/2 ≥ 9 nut w ≥ 50% utworów;
     - holdy: puszczenie na następnej nucie ≥ 0,9, holdy < 1½ beatu z nutą w środku ≤ 0,1;
     - start sekcji lub kiai z akordem ≥ 0,8.
   - Pozostałe poziomy: zmiany w `DIFFICULTIES.normal` i `.easy` nie mogą zmienić chartów Hard. Sprawdza się to porównaniem hashy chartów Hard przed i po.
2. **Siatka** (A1–A4). Nakład średni, w pluginie Java.
   - Sukces:
     - beaty generatora na beatach ludzkich ≥ 0,85 w ≥ 90% utworów;
     - połowa tempa < 5/100;
     - faza taktu ≥ 0,8 w ≥ 60% utworów;
     - siatka w ≥ 97% utworów.
   - Po zmianie trzeba przestroić progi w beatach. Hard dostanie gęstszą siatkę, więc pilnować jego gęstości i min. odstępów.
3. **Wybór momentów według hierarchii i zagnieżdżenie poziomów** (B1, I1, J1, F1, F2). Nakład wysoki; opis w „Architekturze” niżej.
   - Sukces:
     - pokrycie beatów i półbeatów w paśmie p10–p90 ludzi na każdym poziomie;
     - chwile niższego poziomu obecne w wyższym ≥ 0,97;
     - zachowanie downbeat / beat / 1/2 / 1/4 przy N → E w kolejności ludzkiej;
     - recall ≥ 0,7 przy precyzji ≥ 0,8.
4. **Akordy, powtórzenia, ręce** (E1, G1, H1, H2).
   - Sukces:
     - akordy w paśmie ludzi, z połową skoków jednej ręki;
     - ρ akordów z RMS > 0,2;
     - rytm w powtórzeniach ≥ 0,8 przy zysku nad bazą ≥ 0,25;
     - \|lewa − 0,5\| w 4 taktach p90 ≤ 0,10;
     - tryle ≤ 2× ludzkich.

**Sprawdzanie, że pozostałe poziomy się nie pogorszyły:** po każdym kroku `synthesis/level_distance.py` (panel 18 metryk), `cross_levels.py` i `robustness.py` na wszystkich trzech poziomach. Reguła: żadna metryka Hard nie oddala się od ludzi o więcej niż 0,25 IQR, a recall Hard nie spada poniżej 0,7. Liczby nie wystarczą: każdy krok kończy się testem gry na fragmentach z części 7.

**Architektura: obecna nie wystarczy, potrzebna jest przebudowa.**
- **Wybór momentów, tory i trudność są splecione.** Zdarzenie dostaje tor już przy tworzeniu (z instrumentu lub wysokości), a poziom trudności dopiero potem filtruje zdarzenia z gotowymi torami. Łatki (`spreadLanes`, `balanceHands`, `limitJacks`, `orientDrums`) naprawiają skutki.
- **Każdy poziom filtruje osobno**, więc nie ma hierarchii ani zagnieżdżenia. Ludzki wzorzec jest odwrotny: jeden rytm główny, z którego niższe poziomy wycinają według hierarchii metrycznej, a tory i akordy układa się dla każdego poziomu na nowo.

Proponowany podział:
1. **Analiza** (jak dziś, plus poprawki A1–A3): siatka z fazą taktu, sekcje z nowości, salience każdego slotu z onsetów, stemów i warstw.
2. **Rytm główny:** momenty na slotach 1/1–1/4 (1/8 rzadko, triole tylko w trybie video game), wybrane według salience i hierarchii metrycznej, z powtórzeniami kopiowanymi na poziomie rytmu.
3. **Trudność jako cięcie rytmu głównego:** Hard ⊃ Normal ⊃ Easy. Cel gęstości w nutach/s (ok. 3,4 / 6 / 9 dla graczy osu!, do obniżenia dla nowicjuszy), podział zależny od BPM jak w RC.
4. **Holdy:** osobny krok na długich dźwiękach i końcach fraz, puszczenie na następnej chwili, długość na siatce.
5. **Wzorce i akordy dla każdego poziomu osobno:** tory z gramatyki wzorców 4K (schody, skoki, równowaga rąk), akordy według akcentu, głośności i startów sekcji.

Warstwy pluginu (perkusja, bas, lead) zostają jako źródło salience i decyzji „za czym iść” w danym fragmencie, a nie jako przypisanie toru.

## 7. Testy odsłuchowe i gry

Czasy są na osi audio z map (mm:ss). Bot może grać inny upload, więc mogą się różnić o kilka sekund. Najlepiej grać fragment na danym poziomie generatora i porównać z ludzką mapą tego poziomu, np. w osu! na tym samym zestawie. Podgląd nut w oknie: `levels/easy/10_window.py`, `levels/normal/07_window.py`, `levels/hard/a13_candidates.py`.

### Easy
1. **1894317 kessoku band – Seishun Complex (TV Size)**, 00:38–01:12 (połowa tempa). Na czterech wejściach kiai (00:40, 00:50, 01:00, 01:10) człowiek ma akord, generator nic. W 00:52–01:00 człowiek gra 1/1 z 1-beatowymi holdami, generator ok. 9 nut co 2–4 beaty. Zwróć uwagę, czy czujesz puls.
2. **2224035 JINGBURGER – Konton Boogie**, 01:38–01:47. Wejście kiai 01:41: człowiek akord i 1/1 z parami 1/2, generator 3 tapy i 2 holdy w 5 s.
3. **1570640 Lime – 8bit Voyager**, 00:30–00:36 i 01:24–01:34. Nuty generatora na półbeatach człowieka (faza). Czy gra się „pod prąd”?
4. **1277503 Umeboshi Chazuke – Panic! Pop'n! Picnic!**, 01:59–02:06. Generator tylko na „dwa” i „cztery”, bez downbeatów; holdy ok. 1,2 s z nutami w środku.
5. **923488 HyuN – Grin**, 00:42–00:50 (tempo zgodne, sam problem holdów). 2-beatowe holdy z nutami drugiej ręki, puszczenia obok beatu.
6. **1784295 Rokudenashi – Tada Koe Hitotsu**, 02:10–02:18 (130 BPM, wokal). Człowiek 1/1 + 1/2 z akordami i holdami do następnej nuty; generator co ok. 2 beaty.
7. **808872 Kobaryo – Perfect Neglect**, 00:15–00:21 i wejścia kiai 00:56, 01:30, 02:07. Generator co drugi beat i ok. 10 ms za wcześnie, 48 pauz na minutę.

### Normal
1. **2224035 JINGBURGER – Konton Boogie**, 01:44–01:49 (kiai). Człowiek 39 nut z akordami na beatach, generator 10 nut na 1/3, 1/6, 1/8. Czy nuty „pływają”?
2. **1894317 kessoku band – Seishun Complex**, 01:16–01:21 (kiai). Człowiek strumień 1/2 z akordami i holdami ½, generator ćwierćnuty (17 wobec 43 nut).
3. **2200258 Kashii Moimi feat. KAFU – Cat Loving**, 00:19–00:23 (kiai, 220 BPM). Człowiek jump na każdym beacie, generator pojedyncze nuty i 2 długie holdy.
4. **1784295 Rokudenashi – Tada Koe Hitotsu**, 00:45–00:53 (wejście sekcji, tempo zgodne). Człowiek 1/2 z akordem co beat, generator bez akordów, potem nuty poza siatką.
5. **1773164 TUYU – Itsuka Otona ni Nareru to Ii ne.**, 01:06–01:12. Człowiek łańcuch holdów ½ puszczanych na następnej nucie, generator nuty na 1/8 i 1/3, puszczenia poza siatką.
6. **2314654 Laur – PRAGMATISM -RESURRECTION-**, 02:27–02:33. Człowiek długi trzymany akord (breakdown), generator 14 nut na 1/8, 1/3, 1/6.
7. **808872 Kobaryo – Perfect Neglect**, 00:51–00:55. Człowiek 1/2 przy 230 BPM, generator 1 nuta na beat; spadanie liczone ze 115 BPM.
8. Dowolny start kiai utworu testowego: człowiek zawsze akord, generator prawie nigdy.

### Hard
1. **1784295 Rokudenashi – Tada Koe Hitotsu**, 02:18–02:25. Człowiek ciągły jumpstream 1/2 z akordami 2–3-nutowymi (78 nut, 30 akordów), generator 43 pojedyncze nuty z melodii wokalu, odstępy 3/8.
2. **808872 Kobaryo – Perfect Neglect**, 00:59–01:04. Nuty generatora stale przed beatem; człowiek akordy 3-nutowe na beatach, generator 1 akord.
3. **1773164 TUYU – Itsuka Otona ni Nareru to Ii ne.**, 01:50–01:55. Generator tryl prawą ręką przez 4 takty, lewa ręka 9% nut; człowiek akordy na każdym beacie.
4. **2270163 ANGUISH… – Krasavitsa**, 00:36–00:42 (bez siatki). Człowiek jumpstream z akordem na każdym półbeacie, generator 41 nut w surowych czasach, 0 akordów.
5. **2314654 Laur – PRAGMATISM -RESURRECTION-**, 02:05–02:11. 6 holdów z ≥ 2 nutami drugiej ręki, puszczenia w ciszy, lewa ręka 33%.
6. **2224035 JINGBURGER – Konton Boogie**, 02:17–02:22. Człowiek akord na każdym beacie i półbeacie, generator naprzemienność 0-2-0-2.
7. **2515207 TAK – PPPP**, 02:13–02:19. Człowiek 82 nuty i 30 akordów, generator 36 nut i 3 akordy. Czy refren nie jest płaski?
8. **563569 P\*Light – OVERDRIVERS**, 01:28–01:34. 8 nut generatora na 1/8: ozdobnik czy błąd?

Na każdym poziomie oceniaj:
- czy da się wystukać puls bez patrzenia;
- czy refren gra się tak samo przy powtórzeniu;
- czy holdy kończą się „z muzyką”;
- czy wejście refrenu jest odczuwalnie mocniejsze;
- czy któraś ręka się męczy.

## 8. Ograniczenia

**Poziomy i gracze:**
- Poziomy odpowiadają graczom osu!. Docelowy gracz Easy i Normal z Discorda może potrzebować mniejszej gęstości. Dane mówią, jak mapuje człowiek, a nie co jest przyjemne dla nowicjusza.
- Star rating osu!mania nie mierzy czytelności ani związku z muzyką.

**Próba:**
- 20 utworów testowych, po 4–6 na gatunek: porównania generatora według gatunków są opisowe.
- Grupy poza anime, electronic, video game i pop są za małe do wniosków.
- Korpus jest przesunięty w stronę szybkiej muzyki japońskiej i elektronicznej z ostatnich lat (część 2), czyli innej niż typowy repertuar bota.

**Audio i czas:**
- Charty generatora powstały z audio z `.osz`, a w grze plugin analizuje upload odtwarzany przez bota. Analiza tempa może wtedy wyjść inaczej.
- Przesunięcie osi czasu jest dopasowane jednym parametrem na utwór na nutach ludzi. Lekko zawyża to udział ludzkich nut na onsetach, ale nie zmienia metryk siatki.
- 5 utworów ma gorsze dopasowanie (`shared/alignment.md`).

**Detektory i stemy:**
- Stemy pochodzą ze Spleetera (4 stemy). Demucs był niedostępny, bo jego wagi są na zablokowanym hoście.
- Onsety librosa są przybliżeniem.
- Klasy perkusji pluginu oceniłem tylko na sygnale syntetycznym i pośrednio, przez zachowanie ludzi.

**Metryki:**
- W trakcie etapu 2 zmieniłem metryki na v2, bo trzy analizy zgłosiły błędy pomiaru karzące generator za drganie siatki. Raporty poziomów są na v2.
- Pokrycie siatki dla generatora jest liczone z tolerancją 10 ms; przy ±25 ms jest wyższe (część 1, pkt 1, i `synthesis/out/robustness_summary.json`).
- Próg powtórzeń muzyki (0,75) jest skalibrowany na mapach ludzi, więc sprzyja im w porównaniu bezwzględnym.
- `gap_share` w wersji v2.1 (poprawione po pierwszym wydaniu raportu). Wcześniej klasa odstępu nieobecna w charcie dawała pustą komórkę tabeli, a mediany ją pomijały. Teraz każda klasa ma wartość, nieobecna = 0. Zapisane metryki uzupełnił `pipeline/backfill_gap_share.py`; przeliczenie od nowa 352 chartów dało 0 różnic. Zmieniły się tylko liczby Easy: odstępy 1/2 w części 3.1 (generator 0,10 → 0,00), mediana panelu 1,31 → 1,26 oraz porównanie Normal z Easy w części 4.1 (było 13/20, p = 0,017, istotne; jest 11/20, p = 0,105). Hard wobec Normal, część 1 i raporty poziomów się nie zmieniły (raporty poziomów od początku liczyły brak jako 0).

**Eksperymenty i zakres:**
- `synthesis/ablation.py` zmienia tylko parametry poziomów. Skutków zmian w funkcjach wspólnych (siatka, holdy, wybór) nie testowałem, bo wymagałyby zmiany kodu.
- Liczby nie powiedzą, czy chart jest przyjemny w grze, czy wzorzec jest wygodny i czy brak akordu w refrenie słychać. To musi ocenić człowiek (część 7).
- Poziom `hell` nie był analizowany. Jeden zestaw wykluczony (brak zweryfikowanej kopii).

## Co uruchomiono i jak odtworzyć

**Uruchomione:**
- **Dane źródłowe:**
  - osu! API (6103 zestawy, cache w `data/corpus/`);
  - selekcja korpusu (`pipeline/corpus/`);
  - pobranie 100 `.osz` z weryfikacją MD5 (`download_mirror.py`).
- **Analiza audio:**
  - DSP pluginu offline (`pipeline/audio/FeatureDump.java`);
  - librosa, stemy Spleeter;
  - kalibracja onsetów.
- **Charty i metryki:**
  - generator v19 bez zmian dla 20 utworów testowych × 3 poziomy;
  - metryki v2 dla wszystkich map (`pipeline/run_pipeline.py`), `gap_share` uzupełnione do v2.1 (`pipeline/backfill_gap_share.py --verify`).
- **Analizy:**
  - trzy izolowane analizy poziomów (`levels/*/`);
  - etap 3: `synthesis/cross_levels.py`, `level_distance.py`, `robustness.py`, `ablation.py`.

**Przeanalizowane mapy:** Easy 99 map ludzi i 20 chartów generatora, Normal 98 i 20, Hard 95 i 20. Razem 292 mapy ludzi z 100 utworów (93 pełne zestawy).

**Odtworzenie:** kroki 1–7 w `mapping-analysis/README.md`, potem:

```bash
python3 -I mapping-analysis/synthesis/cross_levels.py
```

```bash
python3 -I mapping-analysis/synthesis/level_distance.py
```

```bash
python3 -I mapping-analysis/synthesis/robustness.py
```

```bash
python3 -I mapping-analysis/synthesis/ablation.py
```

Uruchamiaj je Pythonem ze środowiska z `requirements.txt`; skrypty poziomów opisuje część 10 każdego `levels/<poziom>/REPORT.md`.

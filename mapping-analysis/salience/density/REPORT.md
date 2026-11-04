# Co Normal potrzebuje od pluginu

Pomiar przed nowym Normalem. Trzy pytania: czy siłę onsetu z Features v4 można liczyć bez `rel_os` (A), co tłumaczy gęstość frazy u ludzi (B), czy tani detektor przeciąganego dźwięku bije obecny (C). Tylko 80 utworów `train`. 20 testowych nie czytane. Hopes and Dreams służy tylko do pokazania, co robi detektor (C); nie ma ludzkiej mapy.

## Progi zapisane przed pierwszym przebiegiem
Nie zmieniają się po wyniku. Wszystko wypróbowane ponad listę poniżej trafia do raportu z liczbą prób.

### A. Czy siła onsetu z Features v4 zastępuje `rel_os`
- Kandydaci: skupienia onsetów Features v4 w 30 ms (jak w feat/*.pkl). Etykieta: nuta człowieka w 35 ms.
- K: regresja logistyczna (C=1) na rangach w obrębie utworu z `rel_os` albo zastępnika, m_beat, m_half, m_quarter, m_other, m_down, d_grid. Walidacja po utworach, 5 grup, podział jak w stems/measure.py (permutacja, ziarno 0).
- Siatka: cechy metryczne z siatki, którą generator naprawdę ma (ctx.timing). Jeśli w pkl jest inna, porównanie idzie na siatce generatora; oba warianty w raporcie.
- Zastępniki (tylko z bands, drums, bass, lead, energy): siła skupienia względem średniej w oknie ±1 s; ±0,5 s; ±2 s; względem sumy w oknie; względem maksimum w oknie; suma po źródłach względem okna; maksimum po źródłach z osobną średnią każdego źródła; siła surowa; energia wokół onsetu względem ±1 s. Wszystkie w tabeli.
- Wybór: najwyższa średnia AUC (po utworach, potem z trzech poziomów).
- Próg: wybrany zastępnik ma na każdym z poziomów E, N, H AUC K >= AUC K z rel_os - .01, na tej samej siatce, w średniej i w medianie po utworach. Spełniony: rel_os nie wchodzi do pluginu. Niespełniony: plugin musi dawać rel_os.

### B. Co tłumaczy gęstość frazy u ludzi na Normal
- Cel: nuty człowieka na Normal na sekundę, na frazę z analyse() (>= 2 s, w całości między pierwszą a ostatnią nutą mapy). Utwory bez Normal pomijane i policzone.
- Baza: liczba wyrazistych dźwięków na sekundę (kandydaci powyżej kwantyla K w utworze; kwantyl z {.5,.6,.7,.8,.9} wybrany na grupach uczących, K liczony zagnieżdżenie) + głośność frazy względem utworu.
- Model: regresja grzbietowa (alpha 1, cechy standaryzowane). R² z walidacji po utworach, zbiorczo po frazach.
- Części utworu, dwie formy osobno: (1) z Features v4 bez pluginu: ranga energii sekcji, położenie frazy w sekcji i utworze, początek sekcji, fraza powtórzona, fraza ma późniejsze powtórzenie, wzrost głośności sekcji; (2) etykieta struktury z audio: segmentacja z samopodobieństwa beat-synchronicznego MFCC + chroma, klastry; cechy: ile razy klaster wraca, czy najczęstszy, ranga głośności, odległość od reszty, położenie w segmencie; dwie skale segmentu (~15 s, ~30 s), do progu lepsza.
- Próg: forma wchodzi, gdy baza + forma ma R² >= .02 wyższe niż sama baza. Forma 1 przechodzi: bez pluginu. Tylko forma 2: wymaga pluginu. Żadna: części nie wchodzą.
- Do raportu: R² między utworami i wewnątrz utworu; rozkład gęstości utworu u ludzi (mediana, CV, korelacja z głośnością) i u modelu.

### C. Czy tani detektor przeciąganego dźwięku bije obecny
- Wzorzec i miary jak holds/measure.py (start długiego dźwięku ze ścieżek Demucs, >= 1,5 beatu; AUC mediana po utworach; precision@k; walidacja po utworach; pokrycie = ułamek 1748 przeciąganych dźwięków z odcinkiem pokrywającym >= połowę).
- Detektory: D1 dłuższe okno HPSS (~1,4 s, spektrogram uśredniony po 4 ramkach); D2 stabilność chromy z tolerancją wibrata (36 binów, maksimum po sąsiednich); D3 kanał środkowy (L+R)/2 z torem D1.
- Zestawy: każdy detektor + CHEAP, oraz D1+D2+D3 + CHEAP; cztery podejścia liczą się do progu osobno. Każdy sam jako informacja.
- Pokrycie w punkcie pracy: gdy detektor wystawia > 30 odcinków na minutę (mediana), do pokrycia idzie 30 najpewniejszych na minutę.
- Koszt: dodatkowy czas na minutę audio (jeden wątek, bez istniejącego STFT) / czas compute_series na utworach 1127488, 1141872, 1196084, mierzony w tej samej sesji (timing.log: 6,45 s). Limit 20%.
- Próg (Normal; E i H w raporcie): (AUC >= .72 LUB precyzja >= .15) ORAZ pokrycie >= .35 ORAZ koszt <= 20%. Spełniony: potrzebny plugin. Żaden zestaw: lead + bass bez progu pewności, plugin niepotrzebny.

## Wyniki
(do wpisania po przebiegu)

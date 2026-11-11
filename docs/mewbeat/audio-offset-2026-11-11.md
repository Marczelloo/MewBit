# Przesunięcie audio względem mapy (opcja b), 2026-11-11

Wtyczka Lavalinka pobiera każdy utwór dwa razy: raz do analizy (z tego powstają `features`, a z nich mapa), drugi raz do zapisu pliku `.ogg`, który słyszy gracz. Oba pobrania różnią się o całe kawałki po 20 ms na początku, więc mapa i dźwięk rozjeżdżają się o stałe D na utwór (0, ±20, ±40 ms, dwa utwory -65). Przyczynę opisuje `warianty-audio-2026-11-11.md`; tu jest to, co zbudowano.

Funkcja jest domyślnie wyłączona. Żadna mapa, wersja generatora ani wtyczka się nie zmieniły.

## Znak (jedna konwencja wszędzie)

- `offsetMs` = D. D > 0: zapisane features (czyli mapa) leżą później niż te same dźwięki w zapisanym audio. D < 0: audio ma dodatkowy początek.
- Nuta o czasie mapy T jest słyszana w audio w chwili T - D. Czas mapy = pozycja w audio + D.
- Klient: `lagMs = -D` (`activity/src/mewbeat/audioAlignment.js`, `alignmentLagMs`). `soloAudio` gra bufor w czasie `czas mapy + lagMs`.
- Przypięte testami: `tests/activity/mewbeat/audioAlignment.test.js` (znak, w tym D = +20 daje lag -20 i odtwarzanie od 0,98 s przy starcie w 1,0 s), `tests/helpers/mewbeat/audioOffset.test.js` (znak przechodzi przez zapis i odczyt, +20 i -40) i `scripts/mewbeat-melody/decoder/check_offset.py` (opóźnienie audio o d ms przesuwa wynik o -d).

## Pomiar (usługa dekodera, `offset.py`, `POST /offset`)

Port numpy ekstraktora LIGHT wtyczki: mono 24 kHz, FFT 1024, krok 256, `log1p(1000*moduł)`, dodatni przyrost, cztery pasma (20/150/800/4000/12000 Hz). Strumień flux liczony drobno (krok 8 próbek, 0,33 ms) i porównywany z zapisanymi features dla kandydatów D od -120 do +120 ms co 1 ms. Wynik to korelacja Pearsona liczona osobno w pasmach i ważona liczbą onsetów.

- Pewność = min(pik, 4 * margines), gdzie margines to pik minus najlepszy wynik dla D oddalonego o więcej niż 12 ms.
- Okno 40 s; gdy pewność < 0,6, ponowne czytanie 90 s. Mniej niż 60 onsetów (albo mniej niż 8 w paśmie): brak odpowiedzi (null).
- Próg pewności 0,6. Wszystkie 25 zmierzonych zgodnych utworów miało pewność co najmniej 0,847; jedyny nieudany przypadek (e73b05a6, nie ma go w tabeli) 0,414 i dostał null.
- Usługa nie ładuje modelu melodii przy pomiarze offsetu. Pomiar idzie tą samą kolejką i tym samym jednym wątkiem co dekodowanie melodii (FIFO, bez priorytetów po stronie usługi), więc czeka za dekodowaniem w toku; trwa około 2 s.

## Zapis w bocie (`helpers/mewbeat/audioOffset.js`)

- Rekord `<katalog>/offset/<sha1(klucz audio)>.json`: surowy offset, pewność, odcisk audio (rozmiar + sha1 pierwszych i ostatnich 64 KB) i features (rozmiar + mtime). Nowe bajty audio albo nowe features unieważniają rekord. Dotknięcie mtime pliku audio (sklep robi to przy każdym użyciu) nie unieważnia.
- Offset to surowa wartość tylko wtedy, gdy pewność >= 0,6; inaczej null (surowa zostaje w rekordzie).
- Usługa niedostępna: jedno ostrzeżenie w logu, potem brak pomiarów przez 5 minut i wynik "wyłączone". Błąd przejściowy: ponowienia po 10 i 30 minutach, najwyżej 3 próby. Błąd trwały (zły plik) jest ostateczny.
- Utwór nigdy nie jest odrzucany ani zauważalnie opóźniany: odpowiedź na prośbę o mapę czeka na pomiar najwyżej 1200 ms, a pomiar kończy się w tle.
- Nowe audio jest mierzone zaraz po zapisie (niski priorytet). `offsetBackfill.js` mierzy po cichu starsze utwory (start 90 s po uruchomieniu, po 100 na raz).
- `MEWBEAT_AUDIO_OFFSET=off` albo brak `MEWBEAT_DECODER_URL` wyłącza całość.

## Protokół i klient

- Odpowiedź z mapą (solo i pokój) ma na wierzchu pole `audioOffsetMs` (liczba albo null), nigdy w środku `chart`. Live jej nie ma (nie ma zapisanego pliku). Bez zależności albo przy błędzie pola nie ma wcale.
- Ustawienie `audioAlign` (domyślnie `false`, `helpers/mewbeat/userSettings.js`), w panelu ustawień w sekcji Sync: "Per-song audio alignment (experimental)", jedno zdanie wyjaśnienia, a po włączeniu w solo albo pokoju linia "This song: +20 ms" (albo "not measured, the usual alignment is used").
- Włączone i offset znany: lag `-D` ustawiany jawnie w `soloAudio.setLagMs` zamiast skanu (`audioAlign.js`, stały skan heurystyczny). Wyłączone albo offset null: stary skan działa bez zmian (testy).
- Składa się z własnym przesunięciem gracza (`offsetMs` / `soloOffsetMs`): to opóźnienie sprzętu, mierzone kalibracją na kliknięciach, które nigdy nie są przesuwane. Lag przesuwa dźwięk utworu względem jego mapy; kalibracja go nie dotyka, więc nie nakładają się.

## Kalibracja, samouczek, podglądy

- Kalibracja: `alignmentLagMs` zwraca null dla mapy kalibracyjnej, więc kliknięcia nie są przesuwane.
- Samouczek: linki udające serwer nie wysyłają `audioOffsetMs`, a `tour/trap.js` ignoruje to pole.
- Podglądy (preview): nie używają mapy ani wyrównania, nic się nie zmienia.
- Live: nigdy nie stosowane (bot nie wysyła pola, a klient dodatkowo sprawdza tryb).

## Wdrożenie usługi dekodera

Obraz: `docker build -t mewbeat-decoder-svc scripts/mewbeat-melody/decoder` (albo `docker compose build mewbeat-decoder`). Kontener bez montowań, tak jak działa teraz:

```
docker run -d --name mewbeat-decoder-dev -p 127.0.0.1:8090:8090 \
  -e MEWBEAT_DECODER_THREADS=2 -e MEWBEAT_DECODER_IDLE_MIN=5 \
  --memory 2g --cpus 2 --read-only --cap-drop ALL --security-opt no-new-privileges:true \
  --restart unless-stopped mewbeat-decoder-svc:latest
```

(albo `docker compose up -d mewbeat-decoder`). Bot musi mieć `MEWBEAT_DECODER_URL` (compose ustawia). Starsza usługa bez `/offset` odpowiada 404 na ten adres; bot traktuje to jak "niedostępne" (ponowna próba po 5 minutach), a nie jak wyrok na utworze, więc kolejność wdrożenia usługi i bota nie ma znaczenia.

## Wyniki sprawdzenia

Patrz sprawozdanie przy commicie; narzędzie jednorazowe: `node scripts/mewbeat-melody/measure-offsets.js --url http://127.0.0.1:8090 --dir <katalog z audio i features> [--expect tabela.txt]` (domyślnie tylko do odczytu, drukuje id, offsetMs, pewność).

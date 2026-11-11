# Test całego stosu z docker-compose na PC (2026-11-11)

Pierwsze uruchomienie stosu z głównego `docker-compose.yml` razem z mewbeat: yt-cipher, Lavalink z wtyczką, usługa dekodera i bot w kontenerze. Kod: `feat/mewbeat-game-night` (78f53f2). Komputer deweloperski, x86, Docker Desktop. Pi nie było ruszane.

## Jak uruchomione

Plik compose z repo bez zmian, plus nakładki ze scratchpada (`scratchpad\stack\`), które zmieniają tylko to, czego wymaga ten komputer:

- `.env.dev` zamiast `.env` (tu nie ma pliku produkcyjnego);
- `LAVALINK_HOST=lavalink`, `ACTIVITY_HOST=0.0.0.0`, czyli to, co `docs/deployment.md` każe wpisać do `.env` na Pi;
- montowane pliki Lavalinka (`application.yml` z repo, cztery wtyczki) z osobnego folderu, żeby nie ruszać worktree;
- własne nazwy obrazów (`mewbit-stacktest-bot:local`, `mewbeat-decoder-svc:stacktest`), żeby nie nadpisać istniejących;
- Lavalink wystawiony na 2334, bo 2333 trzyma Lavalink deweloperski, który został włączony;
- bot wystawiony na 127.0.0.1:8787, tam gdzie patrzy podgląd vite i tunel.

Trzy przebiegi: (1) kopia danych i logowanie deweloperskie, żeby przejść grę bez Discorda; (2) tryb produkcyjny z pliku compose na kopii; (3) tryb produkcyjny na prawdziwym `helpers/data`, z dozwolonym originem Activity, zostawiony do gry z Discorda.

## Co działa

- **Budowanie.** Oba obrazy budują się z repo (`docker compose build`, 28 s z ciepłą pamięcią warstw): bot 448 MB, dekoder 347 MB. `pnpm install --frozen-lockfile --prod` przechodzi, czyli lockfile zgadza się z `package.json`.
- **Start.** Lavalink zdrowy po 16 s, znalazł i załadował cztery wtyczki (lavalyrics, lavasrc, mewbeat 57 klas, youtube). Bot zalogowany w Discordzie i połączony z Lavalinkiem po nazwie usługi w około 2 s. Dekoder zdrowy.
- **Dane przez wolumen.** Bot w kontenerze czyta istniejącą bibliotekę (ponowne liczenie historii: 31 z 31 już policzone) i zapisuje nowe pliki: mapy, features, melodię, audio, rekordy przesunięcia, okładki.
- **Nowy utwór od zera** („Chaoz Impact” z zakładki Popular, 1:56): mapa gotowa po 14 s. Analiza we wtyczce 4,7 s, render audio 7,9 s, dekoder melodii 2,8 s (312 nut). Cztery poziomy: ★2,6 / 4,6 / 6,3 / 9,4. Linia oczekiwania pokazała po kolei „Getting the charts ready”, „Listening to the song”, „Following the melody”.
- **Wyszukiwarka** przez Lavalink ze stosu: „rush e” w 2 s, dwie sekcje.
- **Start solo:** mapa Normal wczytana (767 nut), audio pobrane (200).
- **AtlasHub z kontenera:** profil i statystyki gracza wczytane.
- **Pomiar przesunięcia audio** przez usługę w sieci compose: 21 utworów zmierzonych przy starcie na kopii, 1,3–1,6 s każdy.
- **Tryb produkcyjny:** bot wstaje, bez logowania 401, logowanie deweloperskie odrzucone, websocket przyjmuje tylko origin Activity. Przez tunel: strona `index-BuvsHapM.js`, API 401.
- **Prawdziwe dane:** 23 rekordy przesunięcia rozpoznane jako ważne (czas modyfikacji plików przechodzi przez wolumen bez zmian), nic nie liczone od nowa.
- **Pamięć w spoczynku po jednej analizie i renderze:** Lavalink 651 MB, yt-cipher 248 MB, dekoder 177 MB, bot 113 MB.

## Co znalazłem

1. **W repo leżała wtyczka z 31 października.** `helpers/lavalink/plugins/mewbeat-plugin-0.1.0.jar` na wszystkich gałęziach to był build sprzed dwóch tygodni (52 KB, sama analiza). Lavalink na tym komputerze od 04:26 chodzi na pliku zbudowanym z obecnego źródła (111 KB), który nie był zacommitowany. Wdrożenie z repo dałoby wtyczkę bez renderu audio. Poprawione: 78f53f2 commituje właściwy plik. Nie ma skryptu, który buduje tę wtyczkę, więc po każdej zmianie źródła trzeba pamiętać o pliku.
2. **Tryb produkcyjny wymaga `ACTIVITY_ALLOWED_ORIGINS`.** Bez niej bramka odrzuca websocket Activity (sprawdzone: połączenie zamykane bez odpowiedzi). `docs/discord-setup.md` o tym mówi, ale `.env-example` jej nie ma, a `docs/configuration.md` podaje domyślną wartość `*`, co jest prawdą tylko poza produkcją.
3. **Każdy nowy kontener bota pobiera pnpm z sieci przy starcie** („Corepack is about to download … pnpm-10.15.0.tgz”), bo obraz startuje przez `pnpm start`, a użytkownik `node` nie ma pnpm w pamięci podręcznej. Bez dostępu do rejestru npm nowy kontener nie wstanie. `CMD ["node", "index.js"]` usunęłoby tę zależność. Nie zmieniałem, to plik wspólny z botem muzycznym.
4. **`docs/deployment.md` nie wspomina o mewbeat:** usługa dekodera, wtyczka, build Activity z nadpisanymi zmiennymi VITE.
5. **Brak `helpers/lavalink/youtube-cookies.txt` kończy się katalogiem o tej nazwie** (Docker tworzy go przy montowaniu). W głównym checkoucie tak już jest. Lavalink z tym działa.
6. **Rekordy przesunięcia audio są przypięte do czasu modyfikacji plików features.** Zwykłe skopiowanie danych (bez zachowania dat) unieważnia je i bot mierzy wszystko od nowa przy starcie. Przy przenoszeniu biblioteki na Pi oznacza to jednorazowy pomiar każdego utworu.
7. **Zegar w kontenerze to UTC** (log bota pokazuje 15:35 przy 16:35 czasu lokalnego). Nie sprawdzałem, czy coś w bocie zależy od czasu lokalnego.
8. Przesunięcie świeżo policzonego utworu wyszło niepewnie (24 ms, pewność 0,43), więc ten utwór gra starym dopasowaniem. Jeden przypadek, bez wniosku.

## Co z tym zrobione (wieczór 2026-11-11)

| Nr | Stan |
| --- | --- |
| 1 | Poprawione. Właściwy plik w repo (78f53f2), `pnpm lavalink:mewbeat:build` buduje wtyczkę w Dockerze (z testami) i zapisuje obok znacznik źródła; test `tests/scripts/mewbeatPluginJar.test.js` pada, gdy źródło wtyczki zmieniło się bez nowego pliku. Sprawdzone: build z obecnego źródła daje te same 57 klas o tych samych rozmiarach. |
| 2 | Poprawione: zmienna jest w `.env-example` (672548d), `docs/configuration.md` i `docs/deployment.md` opisują ją zgodnie z kodem. |
| 3 | Poprawione: obraz startuje przez `node index.js` (672548d). Sprawdzone po przebudowie: w logu nowego kontenera nie ma pobierania pnpm. |
| 4 | Poprawione: `docs/deployment.md` ma kroki dla mewbeat, jest też przewodnik `docs/mewbeat.md`. |
| 5 | Opisane w `docs/deployment.md` (pusty plik przed pierwszym startem). Compose bez zmian. |
| 6 | Poprawione (7a325a7): odcisk pliku analizy to rozmiar i skrót treści, bez daty. Stare rekordy mierzą się jeszcze raz, jednorazowo. |
| 7 | Poprawione: compose przekazuje `TZ` (672548d). Node ją respektuje (log pokazuje czas lokalny); systemowe `date` w obrazie alpine dalej pokazuje UTC, bo obraz nie ma danych stref. |
| 8 | Bez zmian, jeden przypadek. |

## Czego ten test nie sprawdził

- Zagrania utworu do końca i zapisu wyniku: panel podglądu był ukryty, więc zegar gry stał. Mapa i audio doszły, reszta to kod klienta, ten sam co przy bocie uruchamianym ręcznie.
- Logowania przez Discorda w trybie produkcyjnym, pokoju i trybu Live (głos z Lavalinka w tym stosie do Discorda).
- Obciążenia: analiza i render w trakcie odtwarzania muzyki przy limicie sterty Lavalinka 1 GB.
- arm64 i Pi: budowanie obrazu dekodera, czasy, pamięć.
- Świeżego checkoutu bez gotowego pliku wtyczki youtube (tu skopiowany, na Pi buduje go `pnpm lavalink:youtube:patch`).

## Stan po teście

Stos działa w trybie produkcyjnym na prawdziwych danych (projekt compose `mewbit-stacktest`), bot testowy uruchamiany ręcznie jest zatrzymany. Kopia danych z 16:35 leży w `scratchpad\stack\data`.

Powrót do bota uruchamianego ręcznie: `bash scratchpad/stack/dc.sh --real down`, potem start bota z `melody-run` jak zwykle.

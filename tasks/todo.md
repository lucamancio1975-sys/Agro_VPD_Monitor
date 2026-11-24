# Piano Operativo Task — Nuova Web App B2B Agro-VPD Monitor

- [x] Esplorazione repository locali e remoti (`Archiviazione_Dati_Meteo_-11_Centraline-`, `verifica_dati_open_meteo`, `NUOVA APP/vpd_config.json`, `VECCHIA APP ORIGINALE`)
- [x] Creazione e consolidamento skill dedicata `webapp-vpd-aziende` (`C:\Users\User\.gemini\config\skills\webapp-vpd-aziende\SKILL.md`)
- [x] Allineamento di entrambe le repository meteo a **13 centraline speculari** (su PC e su GitHub)
- [x] Aggiornamento cronjob Open-Meteo a 2 esecuzioni giornaliere (`07:00` e `20:00` `Europe/Rome`, Job ID `8644694`)
- [x] Sviluppo motore deterministico `execution/build_vpd_dataset.py` (cucitura `-7gg` CFR + `+2gg` Open-Meteo, formula FAO-56 `0.6108`, fallback >3.5h)
- [x] Sviluppo Frontend PWA Mobile-First in `site/` (3 selettori Centralina/Coltura/Terreno con reset alla riapertura, semaforo 5 fasce, grafico Chart.js con bande dinamiche, icone PWA *L.M. Technical Assistance*)
- [x] Sviluppo Pannello Desktop & CLI `GESTISCI_CLIENTI.bat` (`execution/gestisci_clienti.py`) per creazione, sospensione, riattivazione e cancellazione link univoci
- [x] Pubblicazione su `https://github.com/lucamancio1975-sys/Agro_VPD_Monitor`, configurazione GitHub Pages, permessi Actions, secret `DATA_HUB_TOKEN` e attivazione cronjob orario `:35` (`Job ID 8937816`)

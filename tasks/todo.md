# Piano Operativo Task — Nuova Web App B2B Agro-VPD Monitor

- [x] Esplorazione repository locali e remoti (`Archiviazione_Dati_Meteo_-11_Centraline-`, `verifica_dati_open_meteo`, `NUOVA APP/vpd_config.json`, `VECCHIA APP ORIGINALE`)
- [x] Creazione skill dedicata `webapp-vpd-aziende` (`C:\Users\User\.gemini\config\skills\webapp-vpd-aziende\SKILL.md`)
- [x] Stesura piano architetturale completo, analisi criticità e domande di allineamento
- [ ] Allineamento decisioni progettuali con l'utente (infrastruttura hosting/gatekeeper, elenco centraline, calibrazione bias, selettore stazione)
- [ ] Fase 1: Eventuale allineamento stazioni e schedulazione 2x/giorno su `verifica_dati_open_meteo`
- [ ] Fase 2: Sviluppo Gatekeeper / Data Layer (validazione link univoci, revoca, cucitura temporale `-7gg` CFR + `+2gg` Open-Meteo)
- [ ] Fase 3: Sviluppo Frontend PWA Mobile-First guidato da `vpd_config.json` (semaforo 5 fasce, grafico interattivo, 2 menu a tendina con reset alla riapertura)
- [ ] Fase 4: Sviluppo Pannello/Strumento Amministratore per generazione e revoca link clienti
- [ ] Fase 5: Test completi (cucitura oraria, fallback, revoca token, PWA su smartphone) e messa online


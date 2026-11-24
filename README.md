# 🌱 Agro-VPD Monitor — Piattaforma B2B Supporto Irriguo (PWA Serverless)

Web App progressiva (PWA) ad apertura istantanea per il monitoraggio del **Deficit di Pressione di Vapore (VPD)** sulle **13 centraline agrometeorologiche CFR Toscana** (storico `-7 giorni` + rilevamento orario attuale) integrata con **previsioni orarie ensemble a `+2 giorni`** (`ECMWF IFS 0.25° + DWD ICON-EU`).

---

## 🛠️ Uso Rapido per l'Amministratore (Creazione e Revoca Link Clienti)

Fai doppio click su:
👉 **`GESTISCI_CLIENTI.bat`**

Dal pannello desktop puoi:
1. **Creare un nuovo link personale univoco** scegliendo *Nome Azienda*, *Centralina*, *Coltura* e *Terreno* predefiniti (copia automaticamente negli appunti il messaggio pronto per WhatsApp con le istruzioni di salvataggio su Home Android e iPhone).
2. **Sospendere / Riattivare** qualsiasi cliente in 1 click (il link viene immediatamente disabilitato anche se il cliente aveva già salvato l'icona sulla schermata Home del telefono).
3. **Cancellare definitivamente** un link cliente.

*(Il registro clienti completo resta salvato esclusivamente sul tuo PC in `admin_registry/clients.json`, protetto da `.gitignore` e mai esposto online).*

---

## ⚙️ Automazione Continua (24/7)
- **Minuto `:30` di ogni ora:** `Archiviazione_Dati_Meteo_-11_Centraline-` consolida i rilievi reali CFR delle 13 stazioni.
- **Ore `07:00` e `20:00`:** `verifica_dati_open_meteo` aggiorna le previsioni orarie ensemble `D+0`, `D+1` e `D+2` delle 13 stazioni.
- **Minuto `:35` di ogni ora:** `Agro_VPD_Monitor` (`sync_vpd.yml`) cuce serie reale e previsioni e aggiorna `vpd_dataset.json` su GitHub Pages.


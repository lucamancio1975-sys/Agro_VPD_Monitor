"""
Gestore Clienti e Generatore Link Personali Univoci — Agro-VPD Monitor B2B.

Funzionalità:
- Interfaccia Grafica Desktop (Tkinter) avviabile con doppio click su GESTISCI_CLIENTI.bat
- Interfaccia CLI per automazione rapida (create, suspend, activate, delete, list)
- Genera per ogni cliente una micro-cartella univoca in site/k/<token>/ con:
  * index.html (con configurazione preimpostata Centralina + Terreno + Coltura)
  * manifest.json dedicato (per salvataggio perfetto su schermata Home iOS e Android)
  * sw.js dedicato (Network-First su HTML e no-store sui dati per recepire subito revoche e sync)
- Registro clienti privato salvato SOLO in locale (admin_registry/clients.json, escluso da git!)
  con backup automatico ad ogni modifica.
- Sincronizzazione immediata su GitHub Pages (git add + commit + push).
"""

import argparse
import html
import json
import os
import secrets
import shutil
import string
import subprocess
import sys
import webbrowser
from datetime import datetime
from typing import Dict, List, Optional

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CONFIG_PATH = os.path.join(BASE_DIR, "vpd_config.json")
SITE_DIR = os.path.join(BASE_DIR, "site")
CLIENTS_WEB_DIR = os.path.join(SITE_DIR, "k")
REGISTRY_DIR = os.path.join(BASE_DIR, "admin_registry")
REGISTRY_FILE = os.path.join(REGISTRY_DIR, "clients.json")
BACKUP_DIR = os.path.join(BASE_DIR, ".tmp", "backups")

GITHUB_PAGES_BASE = "https://lucamancio1975-sys.github.io/Agro_VPD_Monitor"

# Elenco centraline ufficiali
STATIONS_LIST = [
    ("TOS11000008", "Braccagni"),
    ("TOS11000006", "Capalbio"),
    ("TOS11000013", "Casotto dei Pescatori"),
    ("TOS11000037", "Cesa"),
    ("TOS03002459", "Follonica"),
    ("TOS03003079", "Manciano"),
    ("TOS11000041", "Massa Marittima Valpiana"),
    ("TOS11000051", "Montenero"),
    ("TOS11000038", "Ottavo (Castiglion Fiorentino)"),
    ("TOS11000014", "Pitigliano"),
    ("TOS11000005", "Rispescia"),
    ("TOS03003099", "San Donato (Albinia)"),
    ("TOS11000042", "Stiacciole"),
]


def load_vpd_config() -> Dict:
    with open(CONFIG_PATH, encoding="utf-8") as f:
        return json.load(f)


def generate_token(length: int = 10) -> str:
    alphabet = string.ascii_lowercase + string.digits
    # Evita caratteri ambigui (0, o, l, 1)
    clean_alpha = "".join(c for c in alphabet if c not in "0ol1")
    return "".join(secrets.choice(clean_alpha) for _ in range(length))


def load_registry() -> List[Dict]:
    os.makedirs(REGISTRY_DIR, exist_ok=True)
    if not os.path.exists(REGISTRY_FILE):
        return []
    with open(REGISTRY_FILE, encoding="utf-8") as f:
        return json.load(f)


def save_registry(clients: List[Dict]) -> None:
    os.makedirs(REGISTRY_DIR, exist_ok=True)
    os.makedirs(BACKUP_DIR, exist_ok=True)
    if os.path.exists(REGISTRY_FILE):
        ts = datetime.now().strftime("%Y%m%d_%H%M%S")
        shutil.copy2(REGISTRY_FILE, os.path.join(BACKUP_DIR, f"clients_{ts}.json.bak"))
    with open(REGISTRY_FILE, "w", encoding="utf-8") as f:
        json.dump(clients, f, ensure_ascii=False, indent=2)


def render_active_html(client: Dict) -> str:
    safe_name = html.escape(client["company_name"])
    cfg_js = json.dumps(
        {
            "active": True,
            "companyName": client["company_name"],
            "defaultStation": client["station_id"],
            "defaultSoil": client["soil_key"],
            "defaultCrop": client["crop_key"],
            "rootPath": "../..",
        },
        ensure_ascii=False,
    )
    return f"""<!DOCTYPE html>
<html lang="it">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">
  <title>Agro-VPD Monitor — {safe_name}</title>
  <meta name="robots" content="noindex, nofollow">

  <!-- PWA Mobile Capabilities -->
  <link rel="manifest" href="./manifest.json">
  <meta name="theme-color" content="#0f172a">
  <meta name="background-color" content="#f1f5f9">
  <meta name="mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="default">
  <meta name="apple-mobile-web-app-title" content="Agro-VPD">

  <!-- Icons -->
  <link rel="icon" type="image/png" href="../../icons/favicon.png">
  <link rel="apple-touch-icon" sizes="180x180" href="../../icons/icon-180.png">
  <link rel="icon" type="image/png" sizes="192x192" href="../../icons/icon-192.png">
  <link rel="icon" type="image/png" sizes="512x512" href="../../icons/icon-512.png">

  <!-- Fonts & Styles -->
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@600;700;800&family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="../../css/style.css?v=1.0">

  <!-- Chart.js -->
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.3/dist/chart.umd.min.js"></script>
  <script>
    window.CLIENT_CONFIG = {cfg_js};
  </script>
</head>
<body>
  <div class="app-shell">
    <!-- Top Header -->
    <header class="top-header">
      <div class="brand-wrap">
        <img src="../../icons/logo.png" alt="Logo" class="brand-logo" onerror="this.style.display='none'">
        <div class="brand-titles">
          <div class="brand-name">Agro-VPD Monitor</div>
          <div class="client-badge" id="client-badge">{safe_name}</div>
        </div>
      </div>
      <button class="btn-refresh" id="btn-refresh" title="Aggiorna dati meteo">
        <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/>
        </svg>
      </button>
    </header>

    <!-- Banner Installazione PWA -->
    <div class="pwa-banner" id="pwa-banner">
      <div class="pwa-banner-text" id="pwa-banner-text">
        <strong>Salva l'App sulla schermata Home</strong>
        Accesso rapido in campo con un tocco
      </div>
      <div style="display:flex;align-items:center;gap:6px;">
        <button class="pwa-btn" id="pwa-install-btn">Installa</button>
        <button class="pwa-close" id="pwa-close-btn" aria-label="Chiudi">&times;</button>
      </div>
    </div>

    <main id="app-main">
      <!-- 3 Selettori Interattivi (Centralina, Coltura, Terreno) -->
      <section class="controls-card">
        <div class="controls-grid">
          <div class="control-field">
            <label for="sel-station">📍 Centralina Meteo</label>
            <select id="sel-station"></select>
          </div>
          <div class="control-field">
            <label for="sel-crop">🌱 Coltura</label>
            <select id="sel-crop"></select>
          </div>
          <div class="control-field">
            <label for="sel-soil">🪨 Tipo di Terreno</label>
            <select id="sel-soil"></select>
          </div>
        </div>
        <div class="sim-reset-bar" id="sim-reset-bar">
          <span class="sim-badge">🔎 Vista esplorativa attiva (alla riapertura tornerà ai tuoi parametri)</span>
          <button type="button" class="btn-reset-defaults" id="btn-reset-defaults">↩️ Torna ai parametri aziendali</button>
        </div>
      </section>

      <!-- Hero Card Semaforo Istantaneo -->
      <section class="hero-card">
        <div class="hero-banner" id="hero-banner" style="background-color:#16a34a;">
          <div class="hero-top-row">
            <span class="hero-source-tag" id="hero-source-tag">Caricamento centralina...</span>
            <span class="hero-band-pill" id="hero-band-pill">...</span>
          </div>
          <div class="hero-main-row">
            <div>
              <span class="hero-vpd-value" id="hero-vpd-num">--</span>
              <span class="hero-vpd-unit">kPa (VPD)</span>
            </div>
          </div>
          <div class="hero-action-title" id="hero-action-title">Elaborazione consiglio irriguo...</div>
          <div class="hero-action-detail" id="hero-action-detail"></div>
        </div>
        <div class="fallback-notice" id="fallback-notice"></div>
        <div class="metrics-strip">
          <div class="metric-cell">
            <div class="metric-lbl">Temperatura</div>
            <div class="metric-val" id="val-temp">-- °C</div>
            <div class="metric-sub">Aria 2m</div>
          </div>
          <div class="metric-cell">
            <div class="metric-lbl">Umidità Rel.</div>
            <div class="metric-val" id="val-rh">-- %</div>
            <div class="metric-sub">Igrometria</div>
          </div>
          <div class="metric-cell">
            <div class="metric-lbl" id="lbl-kpi">KPI Coltura</div>
            <div class="metric-val" id="val-kpi">--</div>
            <div class="metric-sub" id="sub-kpi">Oggi</div>
          </div>
        </div>
      </section>

      <!-- Grafico Interattivo Continuo (-7gg Reali CFR + Previsioni +2gg Open-Meteo) -->
      <section class="section-card">
        <div class="section-head">
          <div>
            <div class="section-title">📈 Andamento VPD: Storico & Previsioni (+2 Giorni)</div>
            <div class="section-subtitle">Tocca la curva per leggere ora, VPD, temperatura e consiglio</div>
          </div>
          <div class="timeframe-pills">
            <button type="button" class="tf-pill active" data-tf="full">-7gg + Prev.</button>
            <button type="button" class="tf-pill" data-tf="5d">-3gg + Prev.</button>
            <button type="button" class="tf-pill" data-tf="today">Oggi + Prev.</button>
          </div>
        </div>

        <div class="chart-legend-strip">
          <span><span class="line-sample-solid"></span>Rilevato Centralina CFR</span>
          <span><span class="line-sample-dashed"></span>Previsione Open-Meteo (+2gg)</span>
        </div>

        <div class="chart-wrapper">
          <canvas id="vpd-chart"></canvas>
        </div>

        <div class="bands-legend" id="bands-legend"></div>
      </section>

      <!-- Sintesi Previsionale Diurna (10:00 - 17:00) Oggi / D+1 / D+2 -->
      <section class="section-card">
        <div class="section-head">
          <div>
            <div class="section-title">🌤️ Previsione Fabbisogno Diurno (Fascia 10:00 – 17:00)</div>
            <div class="section-subtitle">Stima ensemble ECMWF + ICON-EU per pianificare i prossimi turni</div>
          </div>
        </div>
        <div class="forecast-grid" id="forecast-grid"></div>
      </section>

      <!-- Nota Agronomica Suolo & Coltura -->
      <div class="agro-note-box" id="agro-note-box"></div>
    </main>

    <footer class="app-footer">
      <div id="footer-sync">Agro-VPD Monitor • Supporto Decisionale Irriguo</div>
    </footer>
  </div>

  <script src="../../js/app.js?v=1.0"></script>
</body>
</html>
"""


def render_suspended_html(client: Dict) -> str:
    return """<!DOCTYPE html>
<html lang="it">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>Agro-VPD Monitor — Servizio Non Attivo</title>
  <meta name="robots" content="noindex, nofollow">
  <link rel="icon" type="image/png" href="../../icons/favicon.png">
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@500;700;800&display=swap" rel="stylesheet">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Plus Jakarta Sans', -apple-system, sans-serif;
      background: #f1f5f9;
      color: #0f172a;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
    }
    .box {
      background: #ffffff;
      border-radius: 18px;
      max-width: 420px;
      width: 100%;
      padding: 34px 26px;
      text-align: center;
      box-shadow: 0 15px 35px rgba(15, 23, 42, 0.08);
      border-top: 5px solid #dc2626;
    }
    .icon { font-size: 2.4rem; margin-bottom: 10px; }
    h1 { font-size: 1.25rem; font-weight: 800; margin-bottom: 10px; color: #991b1b; }
    p { font-size: 0.9rem; line-height: 1.55; color: #475569; }
  </style>
</head>
<body>
  <div class="box">
    <div class="icon">🔒</div>
    <h1>Link Non Attivo o Scaduto</h1>
    <p>Questo collegamento ad <strong>Agro-VPD Monitor</strong> non risulta attualmente attivo. Per il rinnovo o l'assistenza tecnica contatta il tuo consulente agronomico di riferimento.</p>
  </div>
  <script>
    if ('caches' in window) {
      caches.keys().then(keys => keys.forEach(k => caches.delete(k)));
    }
  </script>
</body>
</html>
"""


def render_client_manifest(client: Dict) -> str:
    manifest = {
        "name": f"Agro-VPD Monitor — {client['company_name']}",
        "short_name": "Agro-VPD",
        "description": "Supporto Decisionale Irriguo e Monitoraggio VPD in Tempo Reale",
        "start_url": "./index.html",
        "scope": "./",
        "display": "standalone",
        "background_color": "#f1f5f9",
        "theme_color": "#0f172a",
        "orientation": "portrait-primary",
        "icons": [
            {"src": "../../icons/icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any"},
            {"src": "../../icons/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any"},
        ],
    }
    return json.dumps(manifest, ensure_ascii=False, indent=2)


def render_client_sw(token: str) -> str:
    return f"""const CACHE_NAME = 'agro-vpd-{token}-v1';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {{
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(names.map((n) => (n !== CACHE_NAME ? caches.delete(n) : null)))
    ).then(() => self.clients.claim())
  );
}});

self.addEventListener('fetch', (event) => {{
  if (event.request.method !== 'GET' || !event.request.url.startsWith('http')) return;
  const url = event.request.url;

  // Dati JSON e pagina HTML del cliente: SEMPRE live da rete (no-store) per recepire sync e revoche all'istante
  if (url.includes('/data/') || url.includes('raw.githubusercontent.com') || url.endsWith('/') || url.endsWith('.html')) {{
    event.respondWith(
      fetch(event.request, {{ cache: 'no-store' }}).catch(() => caches.match(event.request))
    );
    return;
  }}

  event.respondWith(
    fetch(event.request)
      .then((res) => {{
        if (res && res.status === 200) {{
          const clone = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put(event.request, clone));
        }}
        return res;
      }})
      .catch(() => caches.match(event.request))
  );
}});
"""


def write_client_web_files(client: Dict) -> str:
    c_dir = os.path.join(CLIENTS_WEB_DIR, client["token"])
    os.makedirs(c_dir, exist_ok=True)

    html_content = render_active_html(client) if client.get("active", True) else render_suspended_html(client)
    with open(os.path.join(c_dir, "index.html"), "w", encoding="utf-8") as f:
        f.write(html_content)
    with open(os.path.join(c_dir, "manifest.json"), "w", encoding="utf-8") as f:
        f.write(render_client_manifest(client))
    with open(os.path.join(c_dir, "sw.js"), "w", encoding="utf-8") as f:
        f.write(render_client_sw(client["token"]))

    return f"{GITHUB_PAGES_BASE}/k/{client['token']}/"


def build_whatsapp_message(client: Dict) -> str:
    cfg = load_vpd_config()
    st_name = dict(STATIONS_LIST).get(client["station_id"], client["station_id"])
    soil_name = cfg["suoli"].get(client["soil_key"], {}).get("nome_visualizzato", client["soil_key"])
    crop_name = cfg["colture"].get(client["crop_key"], {}).get("nome_visualizzato", client["crop_key"])
    url = f"{GITHUB_PAGES_BASE}/k/{client['token']}/"

    return (
        f"🌱 *AGRO-VPD MONITOR — SUPPORTO IRRIGUO AZIENDALE* 💧\n\n"
        f"Gentile *{client['company_name']}*,\n"
        f"ecco il vostro collegamento personale per consultare in tempo reale il VPD (Deficit di Pressione di Vapore), "
        f"lo storico degli ultimi 7 giorni e le previsioni per i prossimi 2 giorni.\n\n"
        f"⚙️ *Parametri preimpostati per la vostra azienda:*\n"
        f"• Centralina: *{st_name}*\n"
        f"• Coltura: *{crop_name}*\n"
        f"• Terreno: *{soil_name}*\n\n"
        f"🔗 *Link personale di accesso:*\n{url}\n\n"
        f"Per averla sempre pronta come una vera App sul telefono:\n\n"
        f"📱 *ANDROID (Google Chrome)*\n"
        f"1. Apri il link qui sopra in *Chrome*.\n"
        f"2. Tocca *Installa* (o i *3 puntini ⋮* in alto a destra ➔ *Aggiungi a schermata Home*).\n\n"
        f"🍎 *IPHONE / IPAD (Apple Safari)*\n"
        f"1. Apri il link con *Safari*.\n"
        f"2. Tocca *Condividi* in basso (quadrato con freccia verso l'alto ⎋).\n"
        f"3. Scorri e tocca *\"Aggiungi alla schermata Home\"* ➔ *Aggiungi*.\n\n"
        f"Buon lavoro!"
    )


def git_publish_changes(commit_msg: str) -> tuple[bool, str]:
    try:
        subprocess.run(["git", "add", "site/k"], cwd=BASE_DIR, check=True, capture_output=True, text=True)
        diff = subprocess.run(["git", "diff", "--staged", "--quiet"], cwd=BASE_DIR)
        if diff.returncode == 0:
            return True, "Nessuna modifica da pubblicare."
        subprocess.run(["git", "commit", "-m", commit_msg], cwd=BASE_DIR, check=True, capture_output=True, text=True)
        subprocess.run(["git", "pull", "--rebase", "--autostash", "origin", "main"], cwd=BASE_DIR, check=False, capture_output=True, text=True)
        push = subprocess.run(["git", "push", "origin", "main"], cwd=BASE_DIR, check=True, capture_output=True, text=True)
        return True, "Pubblicato su GitHub Pages con successo!"
    except subprocess.CalledProcessError as e:
        return False, f"Errore Git: {e.stderr or e.stdout or str(e)}"


# =====================================================================
# OPERAZIONI CRUD CLIENTI
# =====================================================================
def create_client(
    company_name: str,
    station_id: str,
    soil_key: str,
    crop_key: str,
    notes: str = "",
    custom_token: Optional[str] = None,
    push_git: bool = True,
) -> tuple[Dict, str]:
    clients = load_registry()
    existing_tokens = {c["token"] for c in clients}

    tok = custom_token.strip().lower() if custom_token else generate_token(10)
    while not custom_token and tok in existing_tokens:
        tok = generate_token(10)

    now_str = datetime.now().strftime("%Y-%m-%d %H:%M")
    client = {
        "token": tok,
        "company_name": company_name.strip(),
        "station_id": station_id,
        "soil_key": soil_key,
        "crop_key": crop_key,
        "active": True,
        "notes": notes.strip(),
        "created_at": now_str,
        "updated_at": now_str,
        "url": f"{GITHUB_PAGES_BASE}/k/{tok}/",
    }

    clients = [c for c in clients if c["token"] != tok]
    clients.append(client)
    save_registry(clients)
    write_client_web_files(client)

    git_msg = "Locale aggiornato."
    if push_git:
        _, git_msg = git_publish_changes(f"Attivazione link cliente {tok}")
    return client, git_msg


def set_client_status(token: str, active: bool, push_git: bool = True) -> tuple[Optional[Dict], str]:
    clients = load_registry()
    target = None
    for c in clients:
        if c["token"] == token:
            c["active"] = active
            c["updated_at"] = datetime.now().strftime("%Y-%m-%d %H:%M")
            target = c
            break
    if not target:
        return None, "Token cliente non trovato."
    save_registry(clients)
    write_client_web_files(target)
    git_msg = "Locale aggiornato."
    if push_git:
        st_lbl = "Riattivazione" if active else "Sospensione"
        _, git_msg = git_publish_changes(f"{st_lbl} link cliente {token}")
    return target, git_msg


def delete_client(token: str, push_git: bool = True) -> tuple[bool, str]:
    clients = load_registry()
    new_clients = [c for c in clients if c["token"] != token]
    save_registry(new_clients)

    c_dir = os.path.join(CLIENTS_WEB_DIR, token)
    if os.path.exists(c_dir):
        shutil.rmtree(c_dir)

    git_msg = "Rimosso localmente."
    if push_git:
        _, git_msg = git_publish_changes(f"Rimozione definitiva link {token}")
    return True, git_msg


# =====================================================================
# INTERFACCIA GRAFICA DESKTOP (TKINTER) PER L'UFFICIO
# =====================================================================
def launch_gui():
    import tkinter as tk
    from tkinter import messagebox, ttk

    cfg = load_vpd_config()
    soil_items = [(k, v["nome_visualizzato"]) for k, v in cfg["suoli"].items()]
    crop_items = [(k, v["nome_visualizzato"]) for k, v in cfg["colture"].items()]

    root = tk.Tk()
    root.title("Agro-VPD Monitor — Gestione Link Univoci Aziende")
    root.geometry("1040x680")
    root.configure(bg="#f1f5f9")

    style = ttk.Style()
    style.theme_use("clam")
    style.configure("Treeview", rowheight=28, font=("Segoe UI", 9))
    style.configure("Treeview.Heading", font=("Segoe UI", 9, "bold"))

    # --- FRAME CREAZIONE NUOVO CLIENTE ---
    frm_top = tk.LabelFrame(
        root,
        text=" ➕ Attiva Nuovo Link Personale Cliente ",
        font=("Segoe UI", 10, "bold"),
        bg="#ffffff",
        fg="#0f172a",
        padx=14,
        pady=12,
    )
    frm_top.pack(fill="x", padx=14, pady=(12, 8))

    tk.Label(frm_top, text="Nome Azienda Agricola:", bg="#ffffff", font=("Segoe UI", 9, "bold")).grid(row=0, column=0, sticky="w")
    ent_name = ttk.Entry(frm_top, width=32, font=("Segoe UI", 10))
    ent_name.grid(row=1, column=0, padx=(0, 10), pady=4, sticky="we")

    tk.Label(frm_top, text="Centralina Predefinita:", bg="#ffffff", font=("Segoe UI", 9, "bold")).grid(row=0, column=1, sticky="w")
    cmb_station = ttk.Combobox(frm_top, values=[f"{n} ({i})" for i, n in STATIONS_LIST], state="readonly", width=28)
    cmb_station.current(1)  # Default Capalbio
    cmb_station.grid(row=1, column=1, padx=(0, 10), pady=4, sticky="we")

    tk.Label(frm_top, text="Coltura Predefinita:", bg="#ffffff", font=("Segoe UI", 9, "bold")).grid(row=0, column=2, sticky="w")
    cmb_crop = ttk.Combobox(frm_top, values=[n for _, n in crop_items], state="readonly", width=30)
    cmb_crop.current(0)
    cmb_crop.grid(row=1, column=2, padx=(0, 10), pady=4, sticky="we")

    tk.Label(frm_top, text="Terreno Predefinito:", bg="#ffffff", font=("Segoe UI", 9, "bold")).grid(row=0, column=3, sticky="w")
    cmb_soil = ttk.Combobox(frm_top, values=[n for _, n in soil_items], state="readonly", width=26)
    cmb_soil.current(0)
    cmb_soil.grid(row=1, column=3, pady=4, sticky="we")

    tk.Label(frm_top, text="Note interne (non visibili al cliente):", bg="#ffffff", font=("Segoe UI", 9)).grid(row=2, column=0, sticky="w", pady=(6, 0))
    ent_notes = ttk.Entry(frm_top, width=60, font=("Segoe UI", 9))
    ent_notes.grid(row=3, column=0, columnspan=2, padx=(0, 10), pady=4, sticky="we")

    lbl_status = tk.Label(root, text="Pronto.", bg="#f1f5f9", fg="#334155", font=("Segoe UI", 9, "italic"), anchor="w")

    # --- TABELLA CLIENTI ---
    frm_mid = tk.LabelFrame(
        root,
        text=" 📋 Registro Link Clienti (Salvato privatamente sul tuo PC) ",
        font=("Segoe UI", 10, "bold"),
        bg="#ffffff",
        fg="#0f172a",
        padx=12,
        pady=10,
    )
    frm_mid.pack(fill="both", expand=True, padx=14, pady=6)

    cols = ("stato", "azienda", "stazione", "coltura", "suolo", "token", "data", "note")
    tree = ttk.Treeview(frm_mid, columns=cols, show="headings", selectmode="browse")
    headers = [
        ("stato", "Stato", 90),
        ("azienda", "Azienda Cliente", 180),
        ("stazione", "Centralina", 150),
        ("coltura", "Coltura Default", 170),
        ("suolo", "Terreno Default", 150),
        ("token", "Codice Link", 95),
        ("data", "Aggiornato il", 115),
        ("note", "Note", 140),
    ]
    for cid, text, w in headers:
        tree.heading(cid, text=text)
        tree.column(cid, width=w, anchor="w")
    tree.pack(side="left", fill="both", expand=True)

    sb = ttk.Scrollbar(frm_mid, orient="vertical", command=tree.yview)
    tree.configure(yscrollcommand=sb.set)
    sb.pack(side="right", fill="y")

    st_dict = dict(STATIONS_LIST)
    soil_dict = dict(soil_items)
    crop_dict = dict(crop_items)

    def refresh_table():
        for item in tree.get_children():
            tree.delete(item)
        for c in reversed(load_registry()):
            st_lbl = "🟢 ATTIVO" if c.get("active", True) else "🔴 SOSPESO"
            tree.insert(
                "",
                "end",
                iid=c["token"],
                values=(
                    st_lbl,
                    c["company_name"],
                    st_dict.get(c["station_id"], c["station_id"]),
                    crop_dict.get(c["crop_key"], c["crop_key"]),
                    soil_dict.get(c["soil_key"], c["soil_key"]),
                    c["token"],
                    c.get("updated_at", ""),
                    c.get("notes", ""),
                ),
            )

    def on_create():
        name = ent_name.get().strip()
        if not name:
            messagebox.showwarning("Attenzione", "Inserisci il nome dell'azienda cliente.")
            return
        st_id = STATIONS_LIST[cmb_station.current()][0]
        cr_key = crop_items[cmb_crop.current()][0]
        so_key = soil_items[cmb_soil.current()][0]
        notes = ent_notes.get().strip()

        lbl_status.config(text="Creazione link e pubblicazione su GitHub Pages in corso...")
        root.update_idletasks()
        client, git_msg = create_client(name, st_id, so_key, cr_key, notes=notes, push_git=True)
        wa_msg = build_whatsapp_message(client)
        root.clipboard_clear()
        root.clipboard_append(wa_msg)

        ent_name.delete(0, "end")
        ent_notes.delete(0, "end")
        refresh_table()
        lbl_status.config(text=f"Link creato per {client['company_name']}: {client['url']} ({git_msg})")
        messagebox.showinfo(
            "Link Creato e Messaggio Copiato!",
            f"Link univoco attivo:\n{client['url']}\n\n"
            f"Esito GitHub: {git_msg}\n\n"
            f"✅ Il messaggio completo per WhatsApp è già stato copiato negli appunti (fai Incolla su WhatsApp!).",
        )

    btn_create = tk.Button(
        frm_top,
        text="🚀 CREA LINK UNIVOCO, PUBBLICA E COPIA WHATSAPP",
        command=on_create,
        bg="#16a34a",
        fg="#ffffff",
        font=("Segoe UI", 9, "bold"),
        padx=14,
        pady=7,
        relief="flat",
        cursor="hand2",
    )
    btn_create.grid(row=3, column=2, columnspan=2, pady=4, sticky="we")

    def get_selected_client() -> Optional[Dict]:
        sel = tree.selection()
        if not sel:
            messagebox.showinfo("Seleziona riga", "Seleziona prima un cliente dalla tabella.")
            return None
        tok = sel[0]
        for c in load_registry():
            if c["token"] == tok:
                return c
        return None

    def on_copy_wa():
        c = get_selected_client()
        if not c:
            return
        msg = build_whatsapp_message(c)
        root.clipboard_clear()
        root.clipboard_append(msg)
        lbl_status.config(text=f"Messaggio WhatsApp per {c['company_name']} copiato negli appunti!")

    def on_copy_link():
        c = get_selected_client()
        if not c:
            return
        root.clipboard_clear()
        root.clipboard_append(c["url"])
        lbl_status.config(text=f"Link copiato: {c['url']}")

    def on_open_web():
        c = get_selected_client()
        if c:
            webbrowser.open(c["url"])

    def on_toggle_status():
        c = get_selected_client()
        if not c:
            return
        new_active = not c.get("active", True)
        verb = "RIATTIVARE" if new_active else "SOSPENDERE (bloccare)"
        if not messagebox.askyesno("Conferma", f"Vuoi davvero {verb} il link di '{c['company_name']}'?"):
            return
        lbl_status.config(text="Aggiornamento stato su GitHub Pages in corso...")
        root.update_idletasks()
        _, git_msg = set_client_status(c["token"], new_active, push_git=True)
        refresh_table()
        lbl_status.config(text=f"Stato aggiornato per {c['company_name']} ({git_msg})")

    def on_delete():
        c = get_selected_client()
        if not c:
            return
        if not messagebox.askyesno(
            "Eliminazione Definitiva",
            f"Vuoi CANCELLARE definitivamente il link di '{c['company_name']}'?\nIl link darà pagina non trovata (404).",
        ):
            return
        lbl_status.config(text="Cancellazione link da GitHub Pages in corso...")
        root.update_idletasks()
        _, git_msg = delete_client(c["token"], push_git=True)
        refresh_table()
        lbl_status.config(text=f"Cliente {c['company_name']} eliminato ({git_msg})")

    # --- BARRA PULSANTI AZIONE ---
    frm_bot = tk.Frame(root, bg="#f1f5f9")
    frm_bot.pack(fill="x", padx=14, pady=(4, 6))

    buttons = [
        ("📋 Copia Messaggio WhatsApp", on_copy_wa, "#0284c7"),
        ("🔗 Copia Solo Link", on_copy_link, "#334155"),
        ("🌐 Apri nel Browser", on_open_web, "#475569"),
        ("⏸️ Sospendi / ▶️ Riattiva Cliente", on_toggle_status, "#d97706"),
        ("🗑️ Cancella Definitivamente", on_delete, "#dc2626"),
    ]
    for txt, cmd, col in buttons:
        tk.Button(
            frm_bot,
            text=txt,
            command=cmd,
            bg=col,
            fg="#ffffff",
            font=("Segoe UI", 9, "bold"),
            padx=12,
            pady=6,
            relief="flat",
            cursor="hand2",
        ).pack(side="left", padx=(0, 8))

    lbl_status.pack(fill="x", padx=16, pady=(0, 10))
    refresh_table()
    root.mainloop()


def main_cli():
    parser = argparse.ArgumentParser(description="Gestore Clienti Agro-VPD Monitor")
    sub = parser.add_subparsers(dest="cmd")

    p_create = sub.add_parser("create")
    p_create.add_argument("--name", required=True)
    p_create.add_argument("--station", default="TOS11000006")
    p_create.add_argument("--soil", default="medio_leggero")
    p_create.add_argument("--crop", default="pomodoro_industria")
    p_create.add_argument("--notes", default="")
    p_create.add_argument("--token", default=None)
    p_create.add_argument("--no-push", action="store_true")

    p_susp = sub.add_parser("suspend")
    p_susp.add_argument("--token", required=True)
    p_susp.add_argument("--no-push", action="store_true")

    p_act = sub.add_parser("activate")
    p_act.add_argument("--token", required=True)
    p_act.add_argument("--no-push", action="store_true")

    p_del = sub.add_parser("delete")
    p_del.add_argument("--token", required=True)
    p_del.add_argument("--no-push", action="store_true")

    sub.add_parser("list")

    args = parser.parse_args()
    if not args.cmd:
        launch_gui()
        return

    if args.cmd == "create":
        c, msg = create_client(
            args.name,
            args.station,
            args.soil,
            args.crop,
            notes=args.notes,
            custom_token=args.token,
            push_git=not args.no_push,
        )
        print(f"Creato: {c['company_name']} -> {c['url']} ({msg})")
    elif args.cmd == "suspend":
        c, msg = set_client_status(args.token, False, push_git=not args.no_push)
        print(f"Sospeso: {args.token} ({msg})")
    elif args.cmd == "activate":
        c, msg = set_client_status(args.token, True, push_git=not args.no_push)
        print(f"Riattivato: {args.token} ({msg})")
    elif args.cmd == "delete":
        _, msg = delete_client(args.token, push_git=not args.no_push)
        print(f"Eliminato: {args.token} ({msg})")
    elif args.cmd == "list":
        for c in load_registry():
            print(f"{'ATTIVO' if c.get('active', True) else 'SOSPESO'} | {c['token']} | {c['company_name']} | {c['url']}")


if __name__ == "__main__":
    main_cli()


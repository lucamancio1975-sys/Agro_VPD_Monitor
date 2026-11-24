"""
Motore deterministico di acquisizione e cucitura temporale Dual-Repository per Agro-VPD Monitor.

Fonti:
1. Repo 1 (Privata): lucamancio1975-sys/Archiviazione_Dati_Meteo_-11_Centraline-
   - Storico e rilevamento attuale CFR Toscana (13 centraline, cadenza oraria :30).
   - Finestra estratta: ultimi GIORNI_STORICO_DEFAULT giorni (default: 7) fino a T_last_reale.
2. Repo 2 (Pubblica): lucamancio1975-sys/verifica_dati_open_meteo
   - Previsioni ensemble orarie ECMWF IFS 0.25° + DWD ICON-EU (D+0, D+1, D+2, run 07:00 e 20:00).
   - Finestra estratta: da T_last_reale + 1h fino alle 23:00 di D+2 (rispetto alla data corrente Europe/Rome).

Calcolo VPD:
   Formula ufficiale FAO-56 Tetens (da vpd_config.json):
   es(T) = 0.6108 * exp((17.27 * T) / (T + 237.3))
   VPD   = max(0.0, es(T) * (1 - RH / 100))
"""

import csv
import io
import json
import math
import os
import shutil
import sys
from datetime import datetime, timedelta
from typing import Dict, List, Optional

import pytz
import requests

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CONFIG_SRC = os.path.join(BASE_DIR, "vpd_config.json")
SITE_DATA_DIR = os.path.join(BASE_DIR, "site", "data")
CONFIG_DST = os.path.join(SITE_DATA_DIR, "vpd_config.json")
DATASET_OUT = os.path.join(SITE_DATA_DIR, "vpd_dataset.json")

GIORNI_STORICO_DEFAULT = 7
GIORNI_FUTURO_DEFAULT = 2
MAX_CFR_LAG_HOURS_BEFORE_FALLBACK = 3.5

REPO_CFR = "lucamancio1975-sys/Archiviazione_Dati_Meteo_-11_Centraline-"
REPO_OPENMETEO = "lucamancio1975-sys/verifica_dati_open_meteo"

# Anagrafica unificata delle 13 centraline (allineata su entrambe le repository)
STATIONS = [
    {
        "id": "TOS11000008",
        "name": "Braccagni",
        "area": "Grosseto Nord / Maremma",
        "cfr_csv": "TOS11000008_Braccagni.csv",
        "om_csv": "TOS11000008_braccagni.csv",
        "lat": 42.931,
        "lon": 11.080,
    },
    {
        "id": "TOS11000006",
        "name": "Capalbio",
        "area": "Maremma Sud / Bassa Toscana",
        "cfr_csv": "TOS11000006_Capalbio.csv",
        "om_csv": "TOS11000006_capalbio.csv",
        "lat": 42.405,
        "lon": 11.392,
    },
    {
        "id": "TOS11000013",
        "name": "Casotto dei Pescatori",
        "area": "Marina di Grosseto / Costa",
        "cfr_csv": "TOS11000013_Casotto_dei_Pescatori.csv",
        "om_csv": "TOS11000013_casotto_dei_pescatori.csv",
        "lat": 42.769,
        "lon": 11.016,
    },
    {
        "id": "TOS11000037",
        "name": "Cesa",
        "area": "Valdichiana / Arezzo",
        "cfr_csv": "TOS11000037_Cesa.csv",
        "om_csv": "TOS11000037_cesa.csv",
        "lat": 43.308,
        "lon": 11.825,
    },
    {
        "id": "TOS03002459",
        "name": "Follonica",
        "area": "Maremma Nord / Costa",
        "cfr_csv": "TOS03002459_Follonica.csv",
        "om_csv": "TOS03002459_follonica.csv",
        "lat": 42.933,
        "lon": 10.765,
    },
    {
        "id": "TOS03003079",
        "name": "Manciano",
        "area": "Colline del Fiora / Maremma",
        "cfr_csv": "TOS03003079_Manciano.csv",
        "om_csv": "TOS03003079_manciano.csv",
        "lat": 42.600,
        "lon": 11.518,
    },
    {
        "id": "TOS11000041",
        "name": "Massa Marittima Valpiana",
        "area": "Colline Metallifere / Maremma",
        "cfr_csv": "TOS11000041_Massa_Marittima_Valpiana.csv",
        "om_csv": "TOS11000041_massa_marittima_valpiana.csv",
        "lat": 43.021,
        "lon": 10.865,
    },
    {
        "id": "TOS11000051",
        "name": "Montenero",
        "area": "Amiata / Val d'Orcia",
        "cfr_csv": "TOS11000051_Montenero.csv",
        "om_csv": "TOS11000051_montenero.csv",
        "lat": 42.951,
        "lon": 11.439,
    },
    {
        "id": "TOS11000038",
        "name": "Ottavo (Castiglion Fiorentino)",
        "area": "Valdichiana / Arezzo",
        "cfr_csv": "TOS11000038_Ottavo_Castiglion_Fiorentino.csv",
        "om_csv": "TOS11000038_ottavo_castiglion_fiorentino.csv",
        "lat": 43.373,
        "lon": 11.890,
    },
    {
        "id": "TOS11000014",
        "name": "Pitigliano",
        "area": "Area del Tufo / Maremma",
        "cfr_csv": "TOS11000014_Pitigliano.csv",
        "om_csv": "TOS11000014_pitigliano.csv",
        "lat": 42.635,
        "lon": 11.654,
    },
    {
        "id": "TOS11000005",
        "name": "Rispescia",
        "area": "Grosseto Sud / Parco Maremma",
        "cfr_csv": "TOS11000005_Rispescia.csv",
        "om_csv": "TOS11000005_rispescia.csv",
        "lat": 42.706,
        "lon": 11.145,
    },
    {
        "id": "TOS03003099",
        "name": "San Donato (Albinia)",
        "area": "Orbetello / Costa d'Argento",
        "cfr_csv": "TOS03003099_S_Donato.csv",
        "om_csv": "TOS03003099_san_donato.csv",
        "lat": 42.554,
        "lon": 11.237,
    },
    {
        "id": "TOS11000042",
        "name": "Stiacciole",
        "area": "Grosseto Est",
        "cfr_csv": "TOS11000042_Stiacciole.csv",
        "om_csv": "TOS11000042_stiacciole.csv",
        "lat": 42.789,
        "lon": 11.176,
    },
]


def calc_vpd_fao56(temp_c: float, rh_pct: float) -> float:
    """Calcola il VPD (kPa) secondo FAO-56 Tetens definita in vpd_config.json (0.6108)."""
    es = 0.6108 * math.exp((17.27 * temp_c) / (temp_c + 237.3))
    vpd = es * (1.0 - (rh_pct / 100.0))
    return round(max(0.0, vpd), 3)


def resolve_github_token() -> Optional[str]:
    """Recupera il token per la repo privata CFR da variabile d'ambiente o file locale."""
    tok = os.environ.get("DATA_HUB_TOKEN", "").strip()
    if tok:
        return tok

    # Fallback locale per esecuzione da PC dell'amministratore (mai committato su git)
    local_candidates = [
        os.path.join(BASE_DIR, ".env"),
        os.path.join(
            os.path.dirname(BASE_DIR),
            "..",
            "1BIS_DSS OCCHIO DI PAVONE",
            "app dss occhio di pavone",
            "token.txt",
        ),
    ]
    for p in local_candidates:
        norm_p = os.path.normpath(p)
        if os.path.exists(norm_p):
            content = open(norm_p, encoding="utf-8", errors="ignore").read().strip()
            if norm_p.endswith(".env"):
                for line in content.splitlines():
                    if line.startswith("DATA_HUB_TOKEN="):
                        return line.split("=", 1)[1].strip().strip('"').strip("'")
            elif content:
                return content
    return None


def fetch_text_url(url: str, token: Optional[str] = None, retries: int = 3) -> str:
    headers = {"User-Agent": "Agro-VPD-Monitor-Sync/1.0"}
    if token:
        headers["Authorization"] = f"token {token}"
    last_err = None
    for _ in range(retries):
        try:
            resp = requests.get(url, headers=headers, timeout=20)
            resp.raise_for_status()
            # Gestione eventuale BOM UTF-8
            return resp.content.decode("utf-8-sig", errors="replace")
        except Exception as e:
            last_err = e
    raise RuntimeError(f"Errore download {url}: {last_err}")


def parse_cfr_csv(csv_text: str) -> Dict[str, Dict]:
    """Parsa il CSV storico di Repo 1 (; separatore, virgola decimale)."""
    out: Dict[str, Dict] = {}
    reader = csv.DictReader(io.StringIO(csv_text), delimiter=";")
    for row in reader:
        ts = (row.get("Data_Ora") or "").strip()
        if not ts:
            continue
        t_raw = (row.get("Temperatura_C") or "").strip().replace(",", ".")
        rh_raw = (row.get("Umidita_Relativa_%") or "").strip().replace(",", ".")
        rain_raw = (row.get("Pioggia_Oraria_mm") or "0").strip().replace(",", ".")
        if not t_raw or not rh_raw:
            continue
        try:
            t_val = round(float(t_raw), 2)
            rh_val = round(float(rh_raw), 1)
            rain_val = round(float(rain_raw) if rain_raw else 0.0, 2)
        except ValueError:
            continue
        out[ts] = {
            "ts": ts,
            "t": t_val,
            "rh": rh_val,
            "rain": rain_val,
            "vpd": calc_vpd_fao56(t_val, rh_val),
            "s": "R",
        }
    return out


def parse_openmeteo_csv(csv_text: str) -> Dict[str, Dict]:
    """Parsa il CSV orario di Repo 2 (, separatore, punto decimale)."""
    out: Dict[str, Dict] = {}
    reader = csv.DictReader(io.StringIO(csv_text), delimiter=",")
    for row in reader:
        ts = (row.get("data_ora") or "").strip()
        if not ts:
            continue
        t_raw = (row.get("temp_c") or "").strip()
        rh_raw = (row.get("rh_pct") or "").strip()
        run_str = (row.get("data_run") or "").strip()
        if not t_raw or not rh_raw:
            continue
        try:
            t_val = round(float(t_raw), 2)
            rh_val = round(float(rh_raw), 1)
        except ValueError:
            continue
        out[ts] = {
            "ts": ts,
            "t": t_val,
            "rh": rh_val,
            "rain": None,
            "vpd": calc_vpd_fao56(t_val, rh_val),
            "s": "F",
            "run": run_str,
        }
    return out


def build_station_payload(
    st_meta: Dict,
    cfr_records: Dict[str, Dict],
    om_records: Dict[str, Dict],
    now_rome: datetime,
) -> Dict:
    today_date = now_rome.date()
    min_hist_str = (today_date - timedelta(days=GIORNI_STORICO_DEFAULT)).strftime("%Y-%m-%d 00:00")
    max_fore_str = (today_date + timedelta(days=GIORNI_FUTURO_DEFAULT)).strftime("%Y-%m-%d 23:00")
    now_hour_str = now_rome.strftime("%Y-%m-%d %H:00")

    sorted_cfr_ts = sorted(cfr_records.keys())
    last_real_ts = sorted_cfr_ts[-1] if sorted_cfr_ts else None

    # 1. Serie storica reale fino a T_last_reale
    real_series: List[Dict] = []
    if last_real_ts:
        for ts in sorted_cfr_ts:
            if min_hist_str <= ts <= last_real_ts:
                real_series.append(cfr_records[ts])

    # 2. Serie previsionale da > T_last_reale fino a fine D+2
    cutover_ts = last_real_ts if last_real_ts else min_hist_str
    forecast_series: List[Dict] = []
    last_om_run = None
    for ts in sorted(om_records.keys()):
        if cutover_ts < ts <= max_fore_str:
            rec = om_records[ts]
            if rec.get("run"):
                last_om_run = rec["run"]
            forecast_series.append(
                {
                    "ts": rec["ts"],
                    "t": rec["t"],
                    "rh": rec["rh"],
                    "vpd": rec["vpd"],
                    "s": "F",
                }
            )

    combined_series = real_series + forecast_series

    # 3. Determinazione Stato Attuale (Semaforo Principale) con regola fallback > 3.5h
    current_obj = None
    lag_hours = None
    is_fallback = False

    if last_real_ts:
        dt_last_real = datetime.strptime(last_real_ts, "%Y-%m-%d %H:%M")
        dt_now_naive = now_rome.replace(tzinfo=None)
        lag_hours = round((dt_now_naive - dt_last_real).total_seconds() / 3600.0, 2)

        if lag_hours <= MAX_CFR_LAG_HOURS_BEFORE_FALLBACK:
            r = cfr_records[last_real_ts]
            current_obj = {
                "ts": r["ts"],
                "t": r["t"],
                "rh": r["rh"],
                "vpd": r["vpd"],
                "rain": r.get("rain", 0.0),
                "source": "CFR_REALE",
                "is_fallback": False,
                "last_cfr_ts": last_real_ts,
                "lag_hours": lag_hours,
            }
        else:
            is_fallback = True

    if current_obj is None:
        # Fallback su dato orario Open-Meteo più vicino all'ora attuale
        cand_ts = [ts for ts in sorted(om_records.keys()) if ts <= now_hour_str]
        chosen_ts = cand_ts[-1] if cand_ts else (sorted(om_records.keys())[0] if om_records else None)
        if chosen_ts:
            f = om_records[chosen_ts]
            current_obj = {
                "ts": f["ts"],
                "t": f["t"],
                "rh": f["rh"],
                "vpd": f["vpd"],
                "rain": None,
                "source": "OPEN_METEO_FALLBACK",
                "is_fallback": True,
                "last_cfr_ts": last_real_ts,
                "lag_hours": lag_hours,
            }

    return {
        "id": st_meta["id"],
        "name": st_meta["name"],
        "area": st_meta["area"],
        "last_real_ts": last_real_ts,
        "forecast_run": last_om_run,
        "current": current_obj,
        "hourly": combined_series,
    }


def main():
    os.makedirs(SITE_DATA_DIR, exist_ok=True)

    # Sincronizza vpd_config.json dentro site/data/vpd_config.json
    if os.path.exists(CONFIG_SRC):
        shutil.copy2(CONFIG_SRC, CONFIG_DST)

    rome_tz = pytz.timezone("Europe/Rome")
    now_rome = datetime.now(rome_tz)
    print(f"[{now_rome.strftime('%Y-%m-%d %H:%M:%S %Z')}] Avvio generazione dataset Agro-VPD (13 centraline)...")

    gh_token = resolve_github_token()
    if not gh_token:
        print("ERRORE: Token GitHub (DATA_HUB_TOKEN) non trovato per leggere la repo privata CFR.", file=sys.stderr)
        sys.exit(1)

    stations_out = {}
    stations_meta_list = []
    ok_count = 0

    for st in STATIONS:
        sid = st["id"]
        sname = st["name"]
        cfr_url = f"https://raw.githubusercontent.com/{REPO_CFR}/main/data/history/{st['cfr_csv']}"
        om_url = f"https://raw.githubusercontent.com/{REPO_OPENMETEO}/main/data/{st['om_csv']}"

        print(f"  -> Elaborazione {sname} ({sid})...", end=" ")
        try:
            cfr_txt = fetch_text_url(cfr_url, token=gh_token)
            om_txt = fetch_text_url(om_url, token=None)

            cfr_map = parse_cfr_csv(cfr_txt)
            om_map = parse_openmeteo_csv(om_txt)

            payload = build_station_payload(st, cfr_map, om_map, now_rome)
            stations_out[sid] = payload
            stations_meta_list.append(
                {
                    "id": sid,
                    "name": sname,
                    "area": st["area"],
                    "lat": st["lat"],
                    "lon": st["lon"],
                }
            )
            n_r = sum(1 for x in payload["hourly"] if x["s"] == "R")
            n_f = sum(1 for x in payload["hourly"] if x["s"] == "F")
            print(f"OK (Reali: {n_r}h fino a {payload['last_real_ts']} | Prev: {n_f}h)")
            ok_count += 1
        except Exception as e:
            print(f"ERRORE: {e}", file=sys.stderr)

    if ok_count == 0:
        print("ERRORE CRITICO: Nessuna centralina elaborata correttamente.", file=sys.stderr)
        sys.exit(1)

    dataset = {
        "generated_at": now_rome.strftime("%Y-%m-%d %H:%M:%S"),
        "timezone": "Europe/Rome",
        "history_days": GIORNI_STORICO_DEFAULT,
        "forecast_days": GIORNI_FUTURO_DEFAULT,
        "stations_count": len(stations_meta_list),
        "stations_list": stations_meta_list,
        "stations": stations_out,
    }

    with open(DATASET_OUT, "w", encoding="utf-8") as f:
        json.dump(dataset, f, ensure_ascii=False, separators=(",", ":"))

    size_kb = os.path.getsize(DATASET_OUT) / 1024.0
    print(f"\nCompletato: {ok_count}/{len(STATIONS)} centraline salvate in {DATASET_OUT} ({size_kb:.1f} KB).")


if __name__ == "__main__":
    main()

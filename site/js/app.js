/**
 * AGRO-VPD MONITOR B2B — MOTORE FRONTEND SERVERLESS PWA
 * Guidato da vpd_config.json e dal dataset cucito (-7gg CFR + 2gg Open-Meteo).
 * Regola chiave: i 3 menu (Centralina, Coltura, Terreno) NON salvano mai su localStorage;
 * ad ogni riapertura dell'app si riposizionano sui parametri predefiniti del cliente.
 */

(function () {
  const CLIENT = window.CLIENT_CONFIG || {
    active: true,
    companyName: 'Azienda Agricola Demo',
    defaultStation: 'TOS11000006',
    defaultSoil: 'medio_leggero',
    defaultCrop: 'pomodoro_industria',
    rootPath: '../..'
  };

  const ROOT = CLIENT.rootPath || '../..';
  const REMOTE_RAW_BASE = 'https://raw.githubusercontent.com/lucamancio1975-sys/Agro_VPD_Monitor/main/site/data';
  const BG_RESET_MS = 5 * 60 * 1000; // 5 minuti in background -> ripristina default aziendali

  function isMobileViewport() {
    return window.innerWidth < 680;
  }

  function getDefaultTimeframe() {
    return isMobileViewport() ? '5d' : 'full';
  }

  const STATE = {
    vpdConfig: null,
    dataset: null,
    station: CLIENT.defaultStation,
    soil: CLIENT.defaultSoil,
    crop: CLIENT.defaultCrop,
    timeframe: getDefaultTimeframe(), // '5d' (-3gg/+2gg) di default su smartphone, 'full' (-7gg/+2gg) su desktop
    selectedPointIdx: null,
    chart: null,
    hiddenSince: null,
    deferredInstallPrompt: null,
    lastIsMobile: isMobileViewport()
  };

  const GIORNI_BREVE = ['Dom', 'Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab'];
  const MESI_BREVE = ['Gen', 'Feb', 'Mar', 'Apr', 'Mag', 'Giu', 'Lug', 'Ago', 'Set', 'Ott', 'Nov', 'Dic'];

  function showToast(msg) {
    let el = document.getElementById('toast-msg');
    if (!el) {
      el = document.createElement('div');
      el.id = 'toast-msg';
      el.className = 'toast-msg';
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.remove('show'), 2800);
  }

  function parseTs(tsStr) {
    // "YYYY-MM-DD HH:MM"
    const [dPart, hPart] = tsStr.split(' ');
    const [y, m, d] = dPart.split('-').map(Number);
    const [hh, mm] = (hPart || '00:00').split(':').map(Number);
    return new Date(y, m - 1, d, hh, mm || 0);
  }

  function formatTsShort(tsStr) {
    if (!tsStr) return 'N.D.';
    const dt = parseTs(tsStr);
    const wd = GIORNI_BREVE[dt.getDay()];
    const dd = String(dt.getDate()).padStart(2, '0');
    const mo = MESI_BREVE[dt.getMonth()];
    const hh = String(dt.getHours()).padStart(2, '0');
    return `${wd} ${dd} ${mo} ${hh}:00`;
  }

  function formatDateHuman(dateStr) {
    const [y, m, d] = dateStr.split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    return `${GIORNI_BREVE[dt.getDay()]} ${d} ${MESI_BREVE[m - 1]}`;
  }

  function getBandForVpd(cropCfg, vpdVal) {
    if (!cropCfg || !cropCfg.fasce) return null;
    for (const f of cropCfg.fasce) {
      const minOk = vpdVal >= f.vpd_min;
      const maxOk = f.vpd_max === null || vpdVal < f.vpd_max;
      if (minOk && maxOk) return f;
    }
    return cropCfg.fasce[cropCfg.fasce.length - 1];
  }

  async function fetchJsonResilient(localRelPath, remoteFilename) {
    const bust = Date.now();
    let localData = null;
    let remoteData = null;

    try {
      const r1 = await fetch(`${ROOT}/data/${localRelPath}?_t=${bust}`, { cache: 'no-store' });
      if (r1.ok) localData = await r1.json();
    } catch (_) {}

    try {
      const r2 = await fetch(`${REMOTE_RAW_BASE}/${remoteFilename}?_t=${bust}`, { cache: 'no-store' });
      if (r2.ok) remoteData = await r2.json();
    } catch (_) {}

    if (localData && remoteData && localData.generated_at && remoteData.generated_at) {
      return remoteData.generated_at >= localData.generated_at ? remoteData : localData;
    }
    return remoteData || localData;
  }

  async function loadAllData(showNotification = false) {
    const btn = document.getElementById('btn-refresh');
    if (btn) btn.classList.add('spinning');

    try {
      const [cfg, ds] = await Promise.all([
        STATE.vpdConfig ? Promise.resolve(STATE.vpdConfig) : fetchJsonResilient('vpd_config.json', 'vpd_config.json'),
        fetchJsonResilient('vpd_dataset.json', 'vpd_dataset.json')
      ]);

      if (!cfg || !ds) {
        throw new Error('Impossibile scaricare i dati aggiornati. Verifica la connessione internet.');
      }

      STATE.vpdConfig = cfg;
      STATE.dataset = ds;

      populateDropdowns();
      renderAll();

      if (showNotification) {
        showToast('Dati meteo e VPD aggiornati!');
      }
    } catch (err) {
      console.error(err);
      const main = document.getElementById('app-main');
      if (main && !STATE.dataset) {
        main.innerHTML = `<div class="section-card" style="text-align:center;padding:28px;">
          <h3 style="color:#dc2626;margin-bottom:8px;">Errore di connessione</h3>
          <p style="color:#475569;font-size:0.9rem;">${err.message}</p>
        </div>`;
      } else {
        showToast('Connessione assente: visualizzati ultimi dati in memoria.');
      }
    } finally {
      if (btn) btn.classList.remove('spinning');
    }
  }

  function populateDropdowns() {
    const selStation = document.getElementById('sel-station');
    const selCrop = document.getElementById('sel-crop');
    const selSoil = document.getElementById('sel-soil');

    if (selStation && selStation.options.length === 0 && STATE.dataset) {
      STATE.dataset.stations_list.forEach((st) => {
        const opt = document.createElement('option');
        opt.value = st.id;
        opt.textContent = `${st.name}`;
        selStation.appendChild(opt);
      });
    }

    if (selCrop && selCrop.options.length === 0 && STATE.vpdConfig) {
      Object.entries(STATE.vpdConfig.colture).forEach(([key, val]) => {
        const opt = document.createElement('option');
        opt.value = key;
        opt.textContent = val.nome_visualizzato;
        selCrop.appendChild(opt);
      });
    }

    if (selSoil && selSoil.options.length === 0 && STATE.vpdConfig) {
      Object.entries(STATE.vpdConfig.suoli).forEach(([key, val]) => {
        const opt = document.createElement('option');
        opt.value = key;
        opt.textContent = val.nome_visualizzato;
        selSoil.appendChild(opt);
      });
    }

    // Verifica esistenza chiavi valide
    if (STATE.dataset && !STATE.dataset.stations[STATE.station]) {
      STATE.station = STATE.dataset.stations_list[0].id;
    }
    if (STATE.vpdConfig && !STATE.vpdConfig.colture[STATE.crop]) {
      STATE.crop = Object.keys(STATE.vpdConfig.colture)[0];
    }
    if (STATE.vpdConfig && !STATE.vpdConfig.suoli[STATE.soil]) {
      STATE.soil = Object.keys(STATE.vpdConfig.suoli)[0];
    }

    if (selStation) selStation.value = STATE.station;
    if (selCrop) selCrop.value = STATE.crop;
    if (selSoil) selSoil.value = STATE.soil;
  }

  function syncTimeframePills() {
    document.querySelectorAll('.tf-pill').forEach((p) => {
      p.classList.toggle('active', p.dataset.tf === STATE.timeframe);
    });
  }

  function resetToClientDefaults(notify = false) {
    STATE.station = CLIENT.defaultStation;
    STATE.soil = CLIENT.defaultSoil;
    STATE.crop = CLIENT.defaultCrop;
    STATE.timeframe = getDefaultTimeframe();
    STATE.selectedPointIdx = null;
    syncTimeframePills();
    populateDropdowns();
    renderAll();
    if (notify) {
      showToast('Ripristinati i parametri della tua azienda');
    }
  }

  function getRomeClock() {
    const now = new Date();
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Rome',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    }).formatToParts(now);
    const map = {};
    parts.forEach((p) => {
      map[p.type] = p.value;
    });
    const hh = parseInt(map.hour, 10) % 24;
    const mm = parseInt(map.minute, 10);
    return {
      year: parseInt(map.year, 10),
      month: parseInt(map.month, 10),
      day: parseInt(map.day, 10),
      totalMinutes: hh * 60 + mm
    };
  }

  function addDaysYmd(y, m, d, deltaDays) {
    const dt = new Date(y, m - 1, d + deltaDays);
    const yy = dt.getFullYear();
    const mm = String(dt.getMonth() + 1).padStart(2, '0');
    const dd = String(dt.getDate()).padStart(2, '0');
    return `${yy}-${mm}-${dd}`;
  }

  function computeDaytimeAvgVpd(hourly, ymdStr) {
    const dayRows = hourly.filter((r) => r.ts.startsWith(ymdStr));
    if (!dayRows.length) return null;
    const daytime = dayRows.filter((r) => {
      const hh = parseInt(r.ts.slice(11, 13), 10);
      return hh >= 10 && hh <= 17;
    });
    const sample = daytime.length > 0 ? daytime : dayRows;
    const sum = sample.reduce((acc, r) => acc + r.vpd, 0);
    return sum / sample.length;
  }

  function computeThreeDayTrend(hourly) {
    const clk = getRomeClock();
    // Finestra 1: 00:00 - 19:00 -> Ieri, Oggi (focus), Domani
    // Finestra 2: 19:01 - 00:00 -> Oggi, Domani (focus), Dopodomani
    const isNightShift = clk.totalMinutes >= 19 * 60 + 1;

    const days = isNightShift
      ? [
          { date: addDaysYmd(clk.year, clk.month, clk.day, 0), label: 'Oggi', isFocus: false },
          { date: addDaysYmd(clk.year, clk.month, clk.day, 1), label: 'Domani', isFocus: true },
          { date: addDaysYmd(clk.year, clk.month, clk.day, 2), label: 'Dopodom.', isFocus: false }
        ]
      : [
          { date: addDaysYmd(clk.year, clk.month, clk.day, -1), label: 'Ieri', isFocus: false },
          { date: addDaysYmd(clk.year, clk.month, clk.day, 0), label: 'Oggi', isFocus: true },
          { date: addDaysYmd(clk.year, clk.month, clk.day, 1), label: 'Domani', isFocus: false }
        ];

    days.forEach((dObj) => {
      dObj.avgVpd = computeDaytimeAvgVpd(hourly, dObj.date);
    });

    const v0 = days[0].avgVpd;
    const v1 = days[1].avgVpd;
    const v2 = days[2].avgVpd;

    let slope = 0;
    if (v0 !== null && v1 !== null && v2 !== null) {
      slope = 0.45 * (v1 - v0) + 0.55 * (v2 - v1);
    } else if (v1 !== null && v2 !== null) {
      slope = v2 - v1;
    } else if (v0 !== null && v1 !== null) {
      slope = v1 - v0;
    }

    let trendBadge = '➡️ TENDENZA VPD: STABILE';
    if (slope >= 0.15) {
      trendBadge = '📈 TENDENZA VPD: IN AUMENTO';
    } else if (slope <= -0.15) {
      trendBadge = '📉 TENDENZA VPD: IN CALO';
    }

    return {
      isNightShift,
      days,
      focusDay: days[1],
      trendBadge,
      adviceKicker: isNightShift
        ? 'INDICAZIONE IRRIGUA PER DOMANI (DIURNO)'
        : 'INDICAZIONE IRRIGUA PER OGGI (DIURNO)'
    };
  }

  function computeTargetDayKpi(cropKey, cropCfg, hourly, targetDateStr, targetLabel) {
    const dayRows = hourly.filter((r) => r.ts.startsWith(targetDateStr));
    if (dayRows.length === 0) {
      return { label: 'KPI Coltura', val: '-', sub: targetLabel };
    }

    const kpiCfg = cropCfg.kpi_consigliato || {};
    if (cropKey === 'pomodoro_industria') {
      const thr = kpiCfg.soglia_vpd_kpa || 0.6;
      const activeHours = dayRows.filter((r) => r.vpd > thr).length;
      return {
        label: `Ore VPD > ${thr} kPa`,
        val: `${activeHours} h`,
        sub: `${targetLabel} (reali + prev.)`
      };
    } else {
      const daytime = dayRows.filter((r) => {
        const hh = parseInt(r.ts.slice(11, 13), 10);
        return hh >= 10 && hh <= 17;
      });
      const target = daytime.length > 0 ? daytime : dayRows;
      const avg = target.reduce((acc, r) => acc + r.vpd, 0) / target.length;
      return {
        label: 'Media 10:00-17:00',
        val: `${avg.toFixed(2)} kPa`,
        sub: `${targetLabel} (soglia ${kpiCfg.soglia_vpd_kpa || '-'})`
      };
    }
  }

  function renderForecastCards(cropCfg, soilKey, hourly, refDateStr) {
    const container = document.getElementById('forecast-grid');
    if (!container) return;

    // Raggruppa per data YYYY-MM-DD
    const byDate = {};
    hourly.forEach((r) => {
      const d = r.ts.slice(0, 10);
      if (!byDate[d]) byDate[d] = [];
      byDate[d].push(r);
    });

    const allDates = Object.keys(byDate).sort();
    // Prendi Oggi (refDateStr) e i 2 giorni successivi
    const targetDates = allDates.filter((d) => d >= refDateStr).slice(0, 3);
    const labelsMap = ['OGGI (10-17)', 'DOMANI (D+1)', 'DOPODOMANI (D+2)'];

    container.innerHTML = '';
    targetDates.forEach((dStr, idx) => {
      const rows = byDate[dStr] || [];
      // Finestra agronomica diurna 10:00 - 17:00 (da vpd_config.json)
      const daytime = rows.filter((r) => {
        const hh = parseInt(r.ts.slice(11, 13), 10);
        return hh >= 10 && hh <= 17;
      });
      const sample = daytime.length > 0 ? daytime : rows;
      if (sample.length === 0) return;

      const avgDiurno = sample.reduce((a, b) => a + b.vpd, 0) / sample.length;
      let peakRow = rows[0];
      rows.forEach((r) => {
        if (r.vpd > peakRow.vpd) peakRow = r;
      });

      const band = getBandForVpd(cropCfg, avgDiurno);
      const soilAction = (band && band.azioni_suolo && band.azioni_suolo[soilKey]) || {
        titolo: '-',
        dettaglio: ''
      };

      const card = document.createElement('div');
      card.className = 'fcast-box';
      card.style.borderLeftColor = band ? band.colore_hex : '#64748b';

      const tagTitle = labelsMap[idx] || formatDateHuman(dStr);
      card.innerHTML = `
        <div class="fcast-day">
          <span>${tagTitle}</span>
          <span>${formatDateHuman(dStr)}</span>
        </div>
        <div class="fcast-vpd" style="color:${band.colore_hex};">
          ${avgDiurno.toFixed(2)} kPa <span style="font-size:0.72rem;font-weight:600;color:#64748b;">media diurna</span>
        </div>
        <div class="fcast-peak">
          Picco max: <strong>${peakRow.vpd.toFixed(2)} kPa</strong> alle ${peakRow.ts.slice(11, 16)} (${peakRow.t.toFixed(1)}°C • ${peakRow.rh.toFixed(0)}%)
        </div>
        <div class="fcast-action" style="color:${band.colore_hex};">${soilAction.titolo}</div>
        <div class="fcast-detail">${soilAction.dettaglio}</div>
      `;
      container.appendChild(card);
    });
  }

  function computeAutoZoomY(series, cropCfg) {
    const maxScaleCfg = (cropCfg.scala_grafico_kpa && cropCfg.scala_grafico_kpa.max) || 3.5;
    const maxDataVpd = Math.max(0, ...series.map((r) => r.vpd || 0));
    const fasce = cropCfg.fasce || [];
    const azzurroBand = fasce[1];
    const minFloor = azzurroBand && azzurroBand.vpd_max ? azzurroBand.vpd_max + 0.2 : 1.0;
    const rawTarget = Math.max(minFloor, maxDataVpd * 1.18 + 0.22);

    const cleanCeilings = [1.0, 1.2, 1.5, 1.8, 2.0, 2.5, 3.0, 3.5, 4.0, 4.5, 5.0, 5.5, 6.0];
    let yMax = cleanCeilings.find((c) => c >= rawTarget);
    if (!yMax) {
      yMax = Math.ceil((rawTarget + 0.25) * 2) / 2;
    }
    if (yMax > maxScaleCfg && maxDataVpd + 0.2 <= maxScaleCfg) {
      yMax = maxScaleCfg;
    }

    let stepSize = 0.5;
    if (yMax <= 1.0) stepSize = 0.2;
    else if (yMax <= 1.8) stepSize = 0.3;
    else if (yMax <= 4.0) stepSize = 0.5;
    else stepSize = 1.0;

    return { yMax, stepSize, isZoomed: yMax < maxScaleCfg, maxScaleCfg };
  }

  function ensureChartDomContainers() {
    const canvas = document.getElementById('vpd-chart');
    if (!canvas) return null;

    let wrapper = canvas.closest('.chart-wrapper');
    if (!wrapper) return null;

    let outer = wrapper.closest('.chart-scroll-outer');
    if (!outer) {
      outer = document.createElement('div');
      outer.className = 'chart-scroll-outer';
      outer.id = 'chart-scroll-outer';
      wrapper.parentNode.insertBefore(outer, wrapper);
      outer.appendChild(wrapper);
    }

    let scrollHint = document.getElementById('chart-scroll-hint');
    if (!scrollHint) {
      scrollHint = document.createElement('div');
      scrollHint.className = 'chart-scroll-hint';
      scrollHint.id = 'chart-scroll-hint';
      scrollHint.innerHTML = '<span>↔️ Scorri col dito a sinistra per esplorare tutti i 7 giorni</span><span>Tocca la curva per i dettagli</span>';
      outer.parentNode.insertBefore(scrollHint, outer);
    }

    let touchBar = document.getElementById('chart-touch-bar');
    if (!touchBar) {
      touchBar = document.createElement('div');
      touchBar.className = 'chart-touch-bar';
      touchBar.id = 'chart-touch-bar';
      outer.parentNode.insertBefore(touchBar, scrollHint);
    }

    const legendStrip = outer.parentNode.querySelector('.chart-legend-strip');
    if (legendStrip && !document.getElementById('chart-scale-badge')) {
      const badge = document.createElement('span');
      badge.className = 'chart-scale-badge';
      badge.id = 'chart-scale-badge';
      legendStrip.appendChild(badge);
    }

    return { canvas, wrapper, outer, scrollHint, touchBar };
  }

  function updateTouchBar(rec, cropCfg, soilKey, isPinnedSelection) {
    const touchBar = document.getElementById('chart-touch-bar');
    if (!touchBar || !rec) return;

    const band = getBandForVpd(cropCfg, rec.vpd);
    const act = (band && band.azioni_suolo && band.azioni_suolo[soilKey]) || {
      titolo: band ? band.stato_traspirativo : '-'
    };
    const hex = band ? band.colore_hex : '#475569';
    const isReal = rec.s === 'R';
    const srcBadge = isReal
      ? '<span class="touch-src-pill is-real">📡 Reale CFR</span>'
      : '<span class="touch-src-pill is-fore">🌤️ Previsione</span>';
    const hintSuffix = isPinnedSelection
      ? ''
      : '<span class="touch-tap-hint">👆 Tocca il grafico per cambiare ora</span>';

    touchBar.style.borderLeftColor = hex;
    touchBar.innerHTML = `
      <div class="touch-row-top">
        <div class="touch-ts-wrap">
          <span class="touch-ts">${formatTsShort(rec.ts)}</span>
          ${srcBadge}
        </div>
        <span class="touch-vpd" style="color:${hex};">${rec.vpd.toFixed(2).replace('.', ',')} <small>kPa</small></span>
      </div>
      <div class="touch-row-bot">
        <span class="touch-meteo">🌡️ ${rec.t.toFixed(1).replace('.', ',')}°C &nbsp;•&nbsp; 💧 UR ${rec.rh.toFixed(0)}%</span>
        <span class="touch-action" style="color:${hex};">${act.titolo}</span>
      </div>
      ${hintSuffix}
    `;
  }

  function renderChart(stData, cropCfg, soilKey) {
    const dom = ensureChartDomContainers();
    if (!dom) return;
    const { canvas, wrapper, outer, scrollHint } = dom;

    let series = stData.hourly || [];
    if (series.length === 0) return;

    const isMobile = isMobileViewport();

    // Filtro timeframe scelto dall'utente
    const lastRealTs = stData.last_real_ts || series[0].ts;
    const todayPrefix = lastRealTs.slice(0, 10);

    if (STATE.timeframe === 'today') {
      series = series.filter((r) => r.ts.slice(0, 10) >= todayPrefix);
    } else if (STATE.timeframe === '5d') {
      const dtCut = parseTs(lastRealTs);
      dtCut.setDate(dtCut.getDate() - 3);
      const y = dtCut.getFullYear();
      const m = String(dtCut.getMonth() + 1).padStart(2, '0');
      const d = String(dtCut.getDate()).padStart(2, '0');
      const minStr = `${y}-${m}-${d} 00:00`;
      series = series.filter((r) => r.ts >= minStr);
    }

    const labels = series.map((r) => r.ts);

    // Trova l'indice di giunzione (ultimo dato reale CFR)
    let lastRealIdx = -1;
    series.forEach((r, idx) => {
      if (r.s === 'R') lastRealIdx = idx;
    });

    const defaultIdx = lastRealIdx >= 0 ? lastRealIdx : 0;
    STATE.selectedPointIdx = defaultIdx;
    updateTouchBar(series[defaultIdx], cropCfg, soilKey, false);

    const realValues = series.map((r) => (r.s === 'R' ? r.vpd : null));
    const forecastValues = series.map((r, idx) => {
      if (r.s === 'F') return r.vpd;
      // Aggancia l'inizio della linea tratteggiata all'ultimo punto reale per continuità visiva (zero buchi)
      if (idx === lastRealIdx) return r.vpd;
      return null;
    });

    // Auto-Zoom intelligente asse Y
    const { yMax, stepSize, isZoomed } = computeAutoZoomY(series, cropCfg);
    const scaleBadge = document.getElementById('chart-scale-badge');
    if (scaleBadge) {
      const yMaxTxt = yMax.toFixed(1).replace('.', ',');
      scaleBadge.textContent = isZoomed ? `🔍 Scala auto 0–${yMaxTxt} kPa` : `Scala 0–${yMaxTxt} kPa`;
    }

    if (STATE.chart) {
      STATE.chart.destroy();
      STATE.chart = null;
    }

    // Gestione scorrimento orizzontale su smartphone quando si sceglie -7gg + Prev.
    const isMobileScrollable = isMobile && STATE.timeframe === 'full';
    if (isMobileScrollable) {
      const approxDays = Math.max(8, Math.ceil(series.length / 24));
      const targetPx = Math.max(660, approxDays * 74);
      outer.classList.add('is-scrollable');
      wrapper.style.width = `${targetPx}px`;
      scrollHint.classList.add('visible');
    } else {
      outer.classList.remove('is-scrollable');
      wrapper.style.width = '100%';
      outer.scrollLeft = 0;
      scrollHint.classList.remove('visible');
    }

    // Precalcola gli indici esatti dei tick sull'asse X centrati a mezzogiorno (zero tagli ai bordi, zero sovrapposizioni)
    const allowedTickIndices = new Set();
    labels.forEach((ts, idx) => {
      const hhmm = ts.slice(11, 16);
      if (hhmm === '12:00') {
        allowedTickIndices.add(idx);
      } else if (STATE.timeframe === 'today' && !isMobile && (hhmm === '06:00' || hhmm === '18:00')) {
        allowedTickIndices.add(idx);
      }
    });

    // Plugin sfondo fasce vpd_config.json + separatori mezzanotte + linea ORA + mirino punto attivo
    const vpdBandsPlugin = {
      id: 'vpdBandsBackground',
      beforeDraw(chart) {
        const { ctx, chartArea, scales } = chart;
        if (!chartArea || !scales.y) return;
        const yScale = scales.y;
        const xScale = scales.x;

        ctx.save();
        (cropCfg.fasce || []).forEach((f) => {
          const yBottomVal = Math.max(0, f.vpd_min);
          const yTopVal = f.vpd_max !== null ? Math.min(yMax, f.vpd_max) : yMax;
          if (yTopVal <= yBottomVal) return;

          const topPx = yScale.getPixelForValue(yTopVal);
          const botPx = yScale.getPixelForValue(yBottomVal);

          ctx.fillStyle = f.colore_rgba_sfondo || 'rgba(0,0,0,0.04)';
          ctx.fillRect(chartArea.left, topPx, chartArea.right - chartArea.left, botPx - topPx);

          // Linea orizzontale tratteggiata di soglia
          if (f.vpd_max !== null && f.vpd_max < yMax) {
            ctx.beginPath();
            ctx.setLineDash([4, 4]);
            ctx.strokeStyle = 'rgba(71, 85, 105, 0.34)';
            ctx.lineWidth = 1;
            ctx.moveTo(chartArea.left, topPx);
            ctx.lineTo(chartArea.right, topPx);
            ctx.stroke();
          }
        });

        // Linee verticali di separazione giorno a mezzanotte (00:00)
        ctx.setLineDash([2, 3]);
        ctx.strokeStyle = 'rgba(71, 85, 105, 0.24)';
        ctx.lineWidth = 1;
        labels.forEach((ts, idx) => {
          if (idx > 0 && ts.slice(11, 16) === '00:00') {
            const xMidnight = xScale.getPixelForValue(idx);
            if (xMidnight >= chartArea.left && xMidnight <= chartArea.right) {
              ctx.beginPath();
              ctx.moveTo(xMidnight, chartArea.top);
              ctx.lineTo(xMidnight, chartArea.bottom);
              ctx.stroke();
            }
          }
        });

        // Linea verticale di separazione Passato Reale -> Previsione
        if (lastRealIdx >= 0 && lastRealIdx < labels.length - 1) {
          const xNow = xScale.getPixelForValue(lastRealIdx);
          if (xNow >= chartArea.left && xNow <= chartArea.right) {
            ctx.beginPath();
            ctx.setLineDash([3, 3]);
            ctx.strokeStyle = '#4f46e5';
            ctx.lineWidth = 1.6;
            ctx.moveTo(xNow, chartArea.top);
            ctx.lineTo(xNow, chartArea.bottom);
            ctx.stroke();

            ctx.setLineDash([]);
            ctx.fillStyle = '#4f46e5';
            ctx.font = '700 9.5px "Plus Jakarta Sans", sans-serif';
            const tagTxt = isMobile ? 'ORA → PREV' : 'ORA → PREV.';
            const tw = ctx.measureText(tagTxt).width + 10;
            const bx = Math.min(Math.max(chartArea.left + 2, xNow - tw / 2), chartArea.right - tw - 2);
            ctx.beginPath();
            if (ctx.roundRect) {
              ctx.roundRect(bx, chartArea.top + 4, tw, 16, 4);
            } else {
              ctx.rect(bx, chartArea.top + 4, tw, 16);
            }
            ctx.fill();
            ctx.fillStyle = '#ffffff';
            ctx.fillText(tagTxt, bx + 5, chartArea.top + 15);
          }
        }
        ctx.restore();
      },
      afterDatasetsDraw(chart) {
        const selIdx = STATE.selectedPointIdx;
        if (selIdx === null || selIdx < 0 || selIdx >= series.length) return;
        const { ctx, chartArea, scales } = chart;
        if (!chartArea || !scales.x || !scales.y) return;

        const rec = series[selIdx];
        const xPx = scales.x.getPixelForValue(selIdx);
        const yPx = scales.y.getPixelForValue(rec.vpd);
        if (xPx < chartArea.left || xPx > chartArea.right) return;

        const band = getBandForVpd(cropCfg, rec.vpd);
        const accentHex = band ? band.colore_hex : '#0284c7';

        ctx.save();
        if (selIdx !== lastRealIdx) {
          ctx.beginPath();
          ctx.setLineDash([2, 2]);
          ctx.strokeStyle = 'rgba(15, 23, 42, 0.42)';
          ctx.lineWidth = 1.2;
          ctx.moveTo(xPx, chartArea.top + 22);
          ctx.lineTo(xPx, chartArea.bottom);
          ctx.stroke();
        }

        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.arc(xPx, yPx, 6.5, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
        ctx.fill();
        ctx.lineWidth = 2.6;
        ctx.strokeStyle = accentHex;
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(xPx, yPx, 2.8, 0, Math.PI * 2);
        ctx.fillStyle = accentHex;
        ctx.fill();
        ctx.restore();
      }
    };

    const formatYTick = (val) => {
      if (Math.abs(val) < 0.001) return '0';
      return Number(val).toFixed(1).replace('.', ',');
    };

    const yAxisCommon = {
      min: 0,
      max: yMax,
      grid: { display: false },
      border: { display: false },
      ticks: {
        stepSize,
        padding: 4,
        font: { family: 'JetBrains Mono', size: isMobile ? 9.5 : 10, weight: '700' },
        color: '#334155',
        callback: formatYTick
      }
    };

    const scalesCfg = {
      x: {
        grid: { display: false },
        border: { color: '#cbd5e1' },
        afterBuildTicks(axis) {
          if (allowedTickIndices.size > 0) {
            axis.ticks = Array.from(allowedTickIndices).map((idx) => ({ value: idx }));
          }
        },
        ticks: {
          maxRotation: 0,
          minRotation: 0,
          autoSkip: false,
          padding: 5,
          font: { family: 'Plus Jakarta Sans', size: isMobile ? 9.5 : 10.5, weight: '700' },
          color: '#334155',
          callback(val) {
            const ts = labels[val];
            if (!ts) return '';
            const hhmm = ts.slice(11, 16);
            const ymd = ts.slice(0, 10);
            const dt = parseTs(ts);
            const dd = String(dt.getDate()).padStart(2, '0');
            const mo = String(dt.getMonth() + 1).padStart(2, '0');
            const dayLbl = ymd === todayPrefix ? 'OGGI' : GIORNI_BREVE[dt.getDay()];

            if (STATE.timeframe === 'today') {
              if (hhmm === '12:00') {
                return [`${dayLbl} 12h`, `${dd}/${mo}`];
              }
              return hhmm;
            }
            return [dayLbl, `${dd}/${mo}`];
          }
        }
      },
      y: {
        ...yAxisCommon,
        position: 'left',
        title: {
          display: !isMobile,
          text: 'VPD (kPa)',
          font: { family: 'Plus Jakarta Sans', size: 11, weight: '700' },
          color: '#475569'
        }
      }
    };

    // Nella vista -7gg scorrevole su smartphone mostriamo la scala Y anche a destra (lato ORA + Previsioni)
    if (isMobileScrollable) {
      scalesCfg.yRight = {
        ...yAxisCommon,
        position: 'right'
      };
    }

    const handlePointSelect = (_evt, activeEls, chart) => {
      if (!activeEls || !activeEls.length) return;
      const idx = activeEls[0].index;
      if (idx !== STATE.selectedPointIdx && series[idx]) {
        STATE.selectedPointIdx = idx;
        updateTouchBar(series[idx], cropCfg, soilKey, true);
        chart.draw();
      }
    };

    const chartEvents = isMobileScrollable
      ? ['click', 'mousemove', 'mouseout']
      : ['mousemove', 'mouseout', 'click', 'touchstart', 'touchmove'];

    const pointRadiusBase = series.length > 96 ? 0 : 2.2;

    STATE.chart = new Chart(canvas.getContext('2d'), {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'Rilevato Centralina CFR',
            data: realValues,
            borderColor: '#0f172a',
            backgroundColor: '#0f172a',
            borderWidth: isMobile ? 2.2 : 2.4,
            pointRadius: (ctx) => (ctx.dataIndex === lastRealIdx ? 4.5 : pointRadiusBase),
            pointHoverRadius: isMobile ? 0 : 5,
            pointBackgroundColor: (ctx) => (ctx.dataIndex === lastRealIdx ? '#ffffff' : '#0f172a'),
            pointBorderColor: '#0f172a',
            pointBorderWidth: 2,
            tension: 0.24,
            spanGaps: true
          },
          {
            label: 'Previsione Open-Meteo (+2gg)',
            data: forecastValues,
            borderColor: '#4f46e5',
            backgroundColor: '#4f46e5',
            borderWidth: isMobile ? 2.2 : 2.3,
            borderDash: [6, 4],
            pointRadius: pointRadiusBase,
            pointHoverRadius: isMobile ? 0 : 5,
            tension: 0.24,
            spanGaps: true
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 220 },
        events: chartEvents,
        onHover: handlePointSelect,
        onClick: handlePointSelect,
        interaction: {
          mode: 'index',
          intersect: false
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            enabled: !isMobile,
            backgroundColor: 'rgba(15, 23, 42, 0.94)',
            titleFont: { family: 'Plus Jakarta Sans', size: 12, weight: '700' },
            bodyFont: { family: 'Plus Jakarta Sans', size: 12 },
            padding: 11,
            displayColors: false,
            callbacks: {
              title(items) {
                if (!items.length) return '';
                const idx = items[0].dataIndex;
                const rec = series[idx];
                const src = rec.s === 'R' ? '📡 Rilevato CFR' : '🌤️ Previsione Open-Meteo';
                return `${formatTsShort(rec.ts)}  •  ${src}`;
              },
              label(item) {
                if (item.datasetIndex === 1 && item.dataIndex === lastRealIdx) return null;
                const rec = series[item.dataIndex];
                const band = getBandForVpd(cropCfg, rec.vpd);
                const act = (band && band.azioni_suolo && band.azioni_suolo[soilKey]) || { titolo: '' };
                return [
                  `VPD: ${rec.vpd.toFixed(2)} kPa (${band ? band.stato_traspirativo : ''})`,
                  `Temp: ${rec.t.toFixed(1)} °C   |   UR: ${rec.rh.toFixed(0)} %`,
                  `Indicazione: ${act.titolo}`
                ];
              }
            }
          }
        },
        scales: scalesCfg
      },
      plugins: [vpdBandsPlugin]
    });

    // Consente lo scroll nativo fluido: orizzontale+verticale su -7gg mobile, verticale + scrub orizzontale sulle altre viste
    canvas.style.touchAction = isMobileScrollable ? 'pan-x pan-y' : 'pan-y';

    if (isMobileScrollable) {
      requestAnimationFrame(() => {
        outer.scrollLeft = outer.scrollWidth;
      });
    }

    // Render legenda fasce dinamica sotto il grafico
    const bandsEl = document.getElementById('bands-legend');
    if (bandsEl) {
      bandsEl.innerHTML = '';
      (cropCfg.fasce || []).forEach((f) => {
        const rangeTxt =
          f.vpd_max !== null
            ? `${f.vpd_min.toFixed(1).replace('.', ',')}–${f.vpd_max.toFixed(1).replace('.', ',')} kPa`
            : `> ${f.vpd_min.toFixed(1).replace('.', ',')} kPa`;
        const act = (f.azioni_suolo && f.azioni_suolo[soilKey]) || { titolo: f.stato_traspirativo };
        const isOutOfZoom = f.vpd_min >= yMax;
        const div = document.createElement('div');
        div.className = `band-chip${isOutOfZoom ? ' is-above-zoom' : ''}`;
        div.innerHTML = `
          <span class="band-dot" style="background:${f.colore_hex};"></span>
          <div class="band-chip-body">
            <span class="band-chip-title">${act.titolo}</span>
            <span class="band-chip-range">${rangeTxt} • ${f.stato_traspirativo}</span>
          </div>
        `;
        bandsEl.appendChild(div);
      });
    }
  }

  function renderAll() {
    if (!STATE.vpdConfig || !STATE.dataset) return;

    const stData = STATE.dataset.stations[STATE.station];
    const cropCfg = STATE.vpdConfig.colture[STATE.crop];
    const soilCfg = STATE.vpdConfig.suoli[STATE.soil];
    if (!stData || !cropCfg || !soilCfg) return;

    // Header cliente e stazione predefinita
    const defStObj = STATE.dataset.stations[CLIENT.defaultStation];
    const defStName = defStObj ? defStObj.name : CLIENT.defaultStation;
    const badgeEl = document.getElementById('client-badge');
    if (badgeEl) {
      badgeEl.textContent = `${CLIENT.companyName} • Zona: ${defStName}`;
    }

    // Controllo se l'utente sta simulando una combinazione diversa dai suoi default
    const isModified =
      STATE.station !== CLIENT.defaultStation ||
      STATE.soil !== CLIENT.defaultSoil ||
      STATE.crop !== CLIENT.defaultCrop;
    const resetBar = document.getElementById('sim-reset-bar');
    if (resetBar) {
      resetBar.classList.toggle('active', isModified);
    }

    // Riquadro Principale Neutro (VPD Istantaneo + Tendenza 3 Giorni + Consiglio Diurno)
    const cur = stData.current;
    if (cur) {
      const srcTag = document.getElementById('hero-source-tag');
      if (srcTag) {
        srcTag.textContent = cur.is_fallback
          ? `🌤️ Stima oraria • ${formatTsShort(cur.ts)}`
          : `${formatTsShort(cur.ts)}`;
      }

      const vpdValEl = document.getElementById('hero-vpd-num');
      if (vpdValEl) vpdValEl.textContent = cur.vpd.toFixed(2);

      // Calcolo Tendenza 3 Giorni (00:00-19:00 -> Ieri/Oggi/Domani | 19:01-00:00 -> Oggi/Domani/Dopodomani)
      const trend = computeThreeDayTrend(stData.hourly);
      const trendBadgeEl = document.getElementById('trend-main-badge');
      if (trendBadgeEl) trendBadgeEl.textContent = trend.trendBadge;

      const stripEl = document.getElementById('trend-days-strip');
      if (stripEl) {
        stripEl.innerHTML = '';
        trend.days.forEach((dObj) => {
          const dBand = dObj.avgVpd !== null ? getBandForVpd(cropCfg, dObj.avgVpd) : null;
          const dotColor = dBand ? dBand.colore_hex : '#64748b';
          const valStr = dObj.avgVpd !== null ? `${dObj.avgVpd.toFixed(2)}` : 'N.D.';
          const pill = document.createElement('div');
          pill.className = `trend-day-pill${dObj.isFocus ? ' is-focus' : ''}`;
          pill.innerHTML = `
            <span class="trend-day-lbl">${dObj.label}</span>
            <div class="trend-day-val-row">
              <span class="trend-band-dot" style="background:${dotColor};"></span>
              <span class="trend-day-val">${valStr} <small style="font-size:0.68rem;font-weight:600;color:#cbd5e1;">kPa</small></span>
            </div>
          `;
          stripEl.appendChild(pill);
        });
      }

      // Il consiglio irriguo si basa SEMPRE sul fabbisogno diurno (10:00-17:00) del giorno focus, mai sul buio notturno
      const focusVpd = trend.focusDay.avgVpd !== null ? trend.focusDay.avgVpd : cur.vpd;
      const focusBand = getBandForVpd(cropCfg, focusVpd);
      const action = (focusBand && focusBand.azioni_suolo && focusBand.azioni_suolo[STATE.soil]) || {
        titolo: 'N.D.',
        dettaglio: ''
      };

      const adviceBox = document.getElementById('hero-advice-box');
      if (adviceBox && focusBand) {
        adviceBox.style.borderLeftColor = focusBand.colore_hex;
      }
      const adviceKicker = document.getElementById('hero-advice-kicker');
      if (adviceKicker) adviceKicker.textContent = trend.adviceKicker;

      const actTitleEl = document.getElementById('hero-action-title');
      if (actTitleEl) actTitleEl.textContent = action.titolo;

      const actDetEl = document.getElementById('hero-action-detail');
      if (actDetEl) actDetEl.textContent = action.dettaglio;

      const fbNotice = document.getElementById('fallback-notice');
      if (fbNotice) {
        if (cur.is_fallback) {
          fbNotice.textContent = `⚠️ Centralina CFR ${stData.name} in ritardo di trasmissione (ultimo dato reale: ${formatTsShort(cur.last_cfr_ts)}). Visualizzata temporaneamente la stima modellistica oraria.`;
          fbNotice.classList.add('visible');
        } else {
          fbNotice.classList.remove('visible');
        }
      }

      document.getElementById('val-temp').textContent = `${cur.t.toFixed(1)} °C`;
      document.getElementById('val-rh').textContent = `${cur.rh.toFixed(0)} %`;

      const kpi = computeTargetDayKpi(
        STATE.crop,
        cropCfg,
        stData.hourly,
        trend.focusDay.date,
        trend.focusDay.label
      );
      document.getElementById('lbl-kpi').textContent = kpi.label;
      document.getElementById('val-kpi').textContent = kpi.val;
      document.getElementById('sub-kpi').textContent = kpi.sub;
    }

    renderChart(stData, cropCfg, STATE.soil);

    // Box nota agronomica suolo + coltura
    const noteBox = document.getElementById('agro-note-box');
    if (noteBox) {
      noteBox.innerHTML = `
        <div><strong>🪨 Comportamento Terreno (${soilCfg.nome_visualizzato}):</strong> ${soilCfg.caratteristica}</div>
        <div style="margin-top:5px;"><strong>🌱 Indicatore Chiave Coltura:</strong> ${cropCfg.kpi_consigliato ? cropCfg.kpi_consigliato.descrizione : ''}</div>
      `;
    }

    const footerSync = document.getElementById('footer-sync');
    if (footerSync) {
      footerSync.textContent = `Ultimo sync database: ${STATE.dataset.generated_at} • Rete CFR Toscana & Ensemble ECMWF/ICON-EU`;
    }
  }

  function setupPwaInstall() {
    const isStandalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      window.navigator.standalone === true;
    if (isStandalone) return;

    const banner = document.getElementById('pwa-banner');
    const txt = document.getElementById('pwa-banner-text');
    const btn = document.getElementById('pwa-install-btn');
    const closeBtn = document.getElementById('pwa-close-btn');
    if (!banner) return;

    const isIos = /iphone|ipad|ipod/i.test(window.navigator.userAgent);

    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      STATE.deferredInstallPrompt = e;
      banner.classList.add('visible');
    });

    if (isIos) {
      if (txt) {
        txt.innerHTML = `<strong>Salva l'App sulla schermata Home</strong>Tocca <b>Condividi (⎋)</b> in basso e scegli <b>"Aggiungi alla schermata Home"</b>.`;
      }
      if (btn) btn.style.display = 'none';
      banner.classList.add('visible');
    }

    if (btn) {
      btn.addEventListener('click', async () => {
        if (!STATE.deferredInstallPrompt) return;
        STATE.deferredInstallPrompt.prompt();
        await STATE.deferredInstallPrompt.userChoice;
        STATE.deferredInstallPrompt = null;
        banner.classList.remove('visible');
      });
    }

    if (closeBtn) {
      closeBtn.addEventListener('click', () => banner.classList.remove('visible'));
    }
  }

  function bindEvents() {
    document.getElementById('sel-station')?.addEventListener('change', (e) => {
      STATE.station = e.target.value;
      renderAll();
    });
    document.getElementById('sel-crop')?.addEventListener('change', (e) => {
      STATE.crop = e.target.value;
      renderAll();
    });
    document.getElementById('sel-soil')?.addEventListener('change', (e) => {
      STATE.soil = e.target.value;
      renderAll();
    });
    document.getElementById('btn-reset-defaults')?.addEventListener('click', () => {
      resetToClientDefaults(true);
    });
    document.getElementById('btn-refresh')?.addEventListener('click', () => {
      loadAllData(true);
    });

    syncTimeframePills();
    document.querySelectorAll('.tf-pill').forEach((pill) => {
      pill.addEventListener('click', () => {
        STATE.timeframe = pill.dataset.tf;
        syncTimeframePills();
        if (STATE.dataset && STATE.vpdConfig) {
          renderChart(
            STATE.dataset.stations[STATE.station],
            STATE.vpdConfig.colture[STATE.crop],
            STATE.soil
          );
        }
      });
    });

    let resizeTimer = null;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        const nowMobile = isMobileViewport();
        if (nowMobile !== STATE.lastIsMobile) {
          STATE.lastIsMobile = nowMobile;
          if (STATE.dataset && STATE.vpdConfig) {
            renderChart(
              STATE.dataset.stations[STATE.station],
              STATE.vpdConfig.colture[STATE.crop],
              STATE.soil
            );
          }
        }
      }, 180);
    });

    // Ripristino automatico ai default del cliente quando l'app viene riaperta dal background
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        STATE.hiddenSince = Date.now();
      } else if (document.visibilityState === 'visible') {
        if (STATE.hiddenSince && Date.now() - STATE.hiddenSince >= BG_RESET_MS) {
          resetToClientDefaults(false);
          loadAllData(false);
        }
        STATE.hiddenSince = null;
      }
    });

    window.addEventListener('pageshow', (e) => {
      if (e.persisted) {
        resetToClientDefaults(false);
        loadAllData(false);
      }
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('./sw.js').catch(() => {});
    }
    bindEvents();
    setupPwaInstall();
    loadAllData(false);
  });
})();


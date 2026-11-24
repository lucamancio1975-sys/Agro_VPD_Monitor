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

  const STATE = {
    vpdConfig: null,
    dataset: null,
    station: CLIENT.defaultStation,
    soil: CLIENT.defaultSoil,
    crop: CLIENT.defaultCrop,
    timeframe: 'full', // 'full' (-7gg/+2gg), '5d' (-3gg/+2gg), 'today' (Oggi/+2gg)
    chart: null,
    hiddenSince: null,
    deferredInstallPrompt: null
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

  function resetToClientDefaults(notify = false) {
    STATE.station = CLIENT.defaultStation;
    STATE.soil = CLIENT.defaultSoil;
    STATE.crop = CLIENT.defaultCrop;
    populateDropdowns();
    renderAll();
    if (notify) {
      showToast('Ripristinati i parametri della tua azienda');
    }
  }

  function computeTodayKpi(cropKey, cropCfg, hourly, todayStr) {
    const todayRows = hourly.filter((r) => r.ts.startsWith(todayStr));
    if (todayRows.length === 0) {
      return { label: 'KPI Oggi', val: '-', sub: 'Dati non disp.' };
    }

    const kpiCfg = cropCfg.kpi_consigliato || {};
    if (cropKey === 'pomodoro_industria') {
      const thr = kpiCfg.soglia_vpd_kpa || 0.6;
      const activeHours = todayRows.filter((r) => r.vpd > thr).length;
      return {
        label: `Ore VPD > ${thr} kPa`,
        val: `${activeHours} h`,
        sub: 'Oggi (reali + prev.)'
      };
    } else {
      const daytime = todayRows.filter((r) => {
        const hh = parseInt(r.ts.slice(11, 13), 10);
        return hh >= 10 && hh <= 17;
      });
      const target = daytime.length > 0 ? daytime : todayRows;
      const avg = target.reduce((acc, r) => acc + r.vpd, 0) / target.length;
      return {
        label: 'Media 10:00-17:00',
        val: `${avg.toFixed(2)} kPa`,
        sub: `Soglia att.: ${kpiCfg.soglia_vpd_kpa || '-'} kPa`
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

  function renderChart(stData, cropCfg, soilKey) {
    const canvas = document.getElementById('vpd-chart');
    if (!canvas) return;

    let series = stData.hourly || [];
    if (series.length === 0) return;

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

    const realValues = series.map((r, idx) => (r.s === 'R' ? r.vpd : null));
    const forecastValues = series.map((r, idx) => {
      if (r.s === 'F') return r.vpd;
      // Aggancia l'inizio della linea tratteggiata all'ultimo punto reale per continuità visiva (zero buchi)
      if (idx === lastRealIdx) return r.vpd;
      return null;
    });

    const maxScaleCfg = (cropCfg.scala_grafico_kpa && cropCfg.scala_grafico_kpa.max) || 3.5;
    const maxDataVpd = Math.max(...series.map((r) => r.vpd || 0));
    const yMax = Math.max(maxScaleCfg, Math.ceil((maxDataVpd + 0.25) * 2) / 2);

    // Plugin sfondo fasce vpd_config.json + linea verticale ORA
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
            ctx.strokeStyle = 'rgba(71, 85, 105, 0.35)';
            ctx.lineWidth = 1;
            ctx.moveTo(chartArea.left, topPx);
            ctx.lineTo(chartArea.right, topPx);
            ctx.stroke();
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
            ctx.font = '700 10px "Plus Jakarta Sans", sans-serif';
            const tagTxt = 'ORA → PREV.';
            const tw = ctx.measureText(tagTxt).width + 10;
            const bx = Math.min(Math.max(chartArea.left + 2, xNow - tw / 2), chartArea.right - tw - 2);
            ctx.fillRect(bx, chartArea.top + 4, tw, 16);
            ctx.fillStyle = '#ffffff';
            ctx.fillText(tagTxt, bx + 5, chartArea.top + 15);
          }
        }
        ctx.restore();
      }
    };

    if (STATE.chart) {
      STATE.chart.destroy();
    }

    const pointRadiusReal = series.length > 96 ? 0 : 2.5;
    const pointRadiusFore = series.length > 96 ? 0 : 2.5;

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
            borderWidth: 2.4,
            pointRadius: (ctx) => (ctx.dataIndex === lastRealIdx ? 5 : pointRadiusReal),
            pointBackgroundColor: (ctx) => (ctx.dataIndex === lastRealIdx ? '#ffffff' : '#0f172a'),
            pointBorderColor: '#0f172a',
            pointBorderWidth: 2,
            tension: 0.22,
            spanGaps: true
          },
          {
            label: 'Previsione Open-Meteo (+2gg)',
            data: forecastValues,
            borderColor: '#4f46e5',
            backgroundColor: '#4f46e5',
            borderWidth: 2.3,
            borderDash: [6, 4],
            pointRadius: pointRadiusFore,
            tension: 0.22,
            spanGaps: true
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: {
          mode: 'index',
          intersect: false
        },
        plugins: {
          legend: { display: false },
          tooltip: {
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
                // Evita doppio tooltip sul punto di giunzione
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
        scales: {
          x: {
            grid: { color: 'rgba(148, 163, 184, 0.18)' },
            ticks: {
              maxRotation: 0,
              autoSkip: true,
              maxTicksLimit: window.innerWidth < 600 ? 6 : 10,
              font: { family: 'Plus Jakarta Sans', size: 10, weight: '600' },
              color: '#475569',
              callback(val, idx) {
                const ts = labels[idx];
                if (!ts) return '';
                const hh = ts.slice(11, 16);
                const dt = parseTs(ts);
                const dd = String(dt.getDate()).padStart(2, '0');
                const mo = String(dt.getMonth() + 1).padStart(2, '0');
                if (STATE.timeframe === 'today') {
                  return `${dd}/${mo} ${hh}`;
                }
                return `${dd}/${mo} ${hh}`;
              }
            }
          },
          y: {
            min: 0,
            max: yMax,
            grid: { display: false },
            title: {
              display: true,
              text: 'VPD (kPa)',
              font: { family: 'Plus Jakarta Sans', size: 11, weight: '700' },
              color: '#475569'
            },
            ticks: {
              stepSize: yMax > 3.6 ? 1.0 : 0.5,
              font: { family: 'JetBrains Mono', size: 10, weight: '700' },
              color: '#334155'
            }
          }
        }
      },
      plugins: [vpdBandsPlugin]
    });

    // Render legenda fasce dinamica sotto il grafico
    const bandsEl = document.getElementById('bands-legend');
    if (bandsEl) {
      bandsEl.innerHTML = '';
      (cropCfg.fasce || []).forEach((f) => {
        const rangeTxt = f.vpd_max !== null ? `${f.vpd_min.toFixed(1)}–${f.vpd_max.toFixed(1)} kPa` : `> ${f.vpd_min.toFixed(1)} kPa`;
        const act = (f.azioni_suolo && f.azioni_suolo[soilKey]) || { titolo: f.stato_traspirativo };
        const div = document.createElement('div');
        div.className = 'band-chip';
        div.innerHTML = `
          <span class="band-dot" style="background:${f.colore_hex};"></span>
          <div>
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

    // Semaforo attuale
    const cur = stData.current;
    if (cur) {
      const band = getBandForVpd(cropCfg, cur.vpd);
      const action = (band && band.azioni_suolo && band.azioni_suolo[STATE.soil]) || {
        titolo: 'N.D.',
        dettaglio: ''
      };

      const banner = document.getElementById('hero-banner');
      if (banner && band) {
        banner.style.backgroundColor = band.colore_hex;
      }

      const srcTag = document.getElementById('hero-source-tag');
      if (srcTag) {
        srcTag.textContent = cur.is_fallback
          ? `🌤️ Stima oraria (${formatTsShort(cur.ts)})`
          : `📡 Centralina ${stData.name} • ${formatTsShort(cur.ts)}`;
      }

      const bandPill = document.getElementById('hero-band-pill');
      if (bandPill && band) {
        bandPill.textContent = `Traspirazione: ${band.stato_traspirativo}`;
      }

      const vpdValEl = document.getElementById('hero-vpd-num');
      if (vpdValEl) vpdValEl.textContent = cur.vpd.toFixed(2);

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

      const todayStr = cur.ts.slice(0, 10);
      const kpi = computeTodayKpi(STATE.crop, cropCfg, stData.hourly, todayStr);
      document.getElementById('lbl-kpi').textContent = kpi.label;
      document.getElementById('val-kpi').textContent = kpi.val;
      document.getElementById('sub-kpi').textContent = kpi.sub;

      renderForecastCards(cropCfg, STATE.soil, stData.hourly, todayStr);
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

    document.querySelectorAll('.tf-pill').forEach((pill) => {
      pill.addEventListener('click', () => {
        document.querySelectorAll('.tf-pill').forEach((p) => p.classList.remove('active'));
        pill.classList.add('active');
        STATE.timeframe = pill.dataset.tf;
        if (STATE.dataset && STATE.vpdConfig) {
          renderChart(
            STATE.dataset.stations[STATE.station],
            STATE.vpdConfig.colture[STATE.crop],
            STATE.soil
          );
        }
      });
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


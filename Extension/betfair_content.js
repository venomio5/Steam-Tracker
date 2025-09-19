(() => {
  document.documentElement.style.overflowX = "hidden";
  document.body.style.marginRight ="300px";

  /* ----- Panel ------------------------------------------------------------ */
  const panel = document.createElement("div");
  panel.id = "BuhoTrader-panel";
  panel.innerHTML = `
    <div class="hdr">
      <img id="bt-logo" src="${chrome.runtime.getURL('logo.png')}" alt="Logo" />
      <span class="hdr-title">Asistente BúhoTrader</span>
    </div>

    <div class="row full-width">
      <button id="scrape-btn">Cargar</button>
      <div id="info" class="info">Esperando Pinnacle...</div>
    </div>

    <div id="odds" class="odds"></div>

    <div id="calc" class="calc">
      <div class="row">
        <label>Tipo
          <select id="bet-type">
            <option>A Favor</option>
            <option>En Contra</option>
          </select>
        </label>
      </div>
      <div class="row">
        <label>Pinnacle
          <input type="number" id="my-odds"   step="0.001" min="1.01" value="2.000">
        </label>
      </div>
      <div class="row">
        <label>Intercambio
          <input type="number" id="ex-odds"   step="0.01"  min="1.01" value="2.500">
        </label>
      </div>
      <div class="row">
        <label>Banca
          <input type="number" id="bankroll"  step="1"     min="0"    value="">
        </label>
      </div>
      <pre id="calc-out" class="out">Margen: 0 %  Apuesta: $0.00</pre>
    </div>`;
  document.body.appendChild(panel);

  /** Logic  ****************************************************************/
  const scrapeBtn     = panel.querySelector("#scrape-btn");
  const info    = panel.querySelector("#info");
  const oddsBox = panel.querySelector("#odds");

  const STORAGE_KEY = "buho_latest_odds";

  // fetch latest stored scrape on demand
  function fetchLatestOdds() {
    chrome.storage.local.get(STORAGE_KEY, res => {
      const entry = res?.[STORAGE_KEY];
      if (!entry || !Array.isArray(entry.data)) {
        info.textContent = "Esperando Pinnacle (haz click en la burbuja Pinnacle)";
        oddsBox.innerHTML = "";
        return;
      }
      info.textContent = `Último: ${new Date(entry.ts).toLocaleTimeString()}`;
      draw(entry.data);
    });
  }

  scrapeBtn.onclick = () => {
    info.textContent = "Solicitando datos…";
    fetchLatestOdds();
  };

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[ch]);
  }

  function draw(items) {
    if (!Array.isArray(items) || items.length === 0) {
      oddsBox.innerHTML = '<div class="empty">Sin datos</div>';
      return;
    }

    const groups = {};
    for (const it of items) {
      if (!it) continue;
      const [title, label, odd] = it;
      if (!title) continue;
      (groups[title] = groups[title] || []).push({ label: label || '', odd: odd != null ? Number(odd) : null });
    }

    let html = '';
    for (const [title, rows] of Object.entries(groups)) {
      html += `<div class="market"><div class="market-title">${escapeHtml(title)}</div>`;
      for (const r of rows) {
        const oddText = (r.odd == null || isNaN(r.odd)) ? '—' : r.odd.toFixed(3);
        html += `<div class="market-row"><span class="label">${escapeHtml(r.label)}</span><span class="odd">${escapeHtml(oddText)}</span></div>`;
      }
      html += `</div>`;
    }

    oddsBox.innerHTML = html;
  }

  // react to Pinnacle content-script storing a fresh scrape
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (!changes[STORAGE_KEY]) return;
    const entry = changes[STORAGE_KEY].newValue;
    if (!entry) return;
    info.textContent = `Último: ${new Date(entry.ts).toLocaleTimeString()}`;
    draw(entry.data);
  });

  // on load, try to display any existing scrape
  chrome.storage.local.get(STORAGE_KEY, (res) => {
    const entry = res?.[STORAGE_KEY];
    if (entry && Array.isArray(entry.data)) {
      info.textContent = `Último: ${new Date(entry.ts).toLocaleTimeString()}`;
      draw(entry.data);
    } else {
      info.textContent = "Esperando Pinnacle (haz click en la burbuja Pinnacle)";
    }
  });

  /* ===== trade-amount calculator ======================================== */
  const betType = panel.querySelector("#bet-type");
  const myOdds  = panel.querySelector("#my-odds");
  const exOdds  = panel.querySelector("#ex-odds");
  const bankroll = panel.querySelector("#bankroll");
  const out     = panel.querySelector("#calc-out");

  const fields = [betType, myOdds, exOdds, bankroll].filter(Boolean);
  fields.forEach(el => el.addEventListener("input", calc));
  if (betType) betType.addEventListener("change", calc);

  calc();                                                       

  function calc() {
    const backing = betType.value === "A Favor";
    const my      = +myOdds.value;
    const ex      = +exOdds.value;
    const roll    = +bankroll.value;

    if (my < 1.01 || ex < 1.01 || roll <= 0) { out.textContent = "—"; return; }

    const p    = 1 / my;
    const edge = backing ? (ex * p - 1) : (1 - ex * p);
    const kf   = Math.max(edge / (ex - 1), 0);
    const frac = kf / 2;                               

    if (backing) {
      const stake = roll * frac;
      out.textContent =
        `Edge:  ${(edge * 100).toFixed(2)} %\n` +
        `Kelly: ${(frac   * 100).toFixed(2)} %\n` +
        `Monto:  $${stake.toFixed(2)}`;
    } else {
      const liability = roll * frac;
      const stake  = liability * (ex - 1);
      out.textContent =
        `Edge:  ${(edge * 100).toFixed(2)} %\n` +
        `Kelly: ${(frac     * 100).toFixed(2)} %\n` +
        `Monto: $${stake.toFixed(2)}\n` +
        `Riesgo:  $${liability.toFixed(2)}`;
    }
  }

  /* ===== storage safety helpers ========================================= */
  function safeGetStorage(key, cb) {
    try {
      chrome.storage.local.get(key, res => {
        if (chrome.runtime && chrome.runtime.lastError) {
          console.warn("storage.get error", chrome.runtime.lastError);
          cb({});
        } else {
          cb(res || {});
        }
      });
    } catch (err) {
      console.warn("safeGetStorage failed", err);
      cb({});
    }
  }

  /* ===== fetch latest odds (uses safeGetStorage) ======================== */
  function fetchLatestOdds() {
    safeGetStorage(STORAGE_KEY, res => {
      const entry = res?.[STORAGE_KEY];
      if (!entry || !Array.isArray(entry.data)) {
        info.textContent = "Esperando Pinnacle (haz click en la burbuja Pinnacle)";
        oddsBox.innerHTML = "";
        return;
      }
      info.textContent = `Último: ${new Date(entry.ts).toLocaleTimeString()}`;
      draw(entry.data);
    });
  }

  /* ===== onChanged listener (guarded) ================================== */
  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local") return;
      if (!changes[STORAGE_KEY]) return;
      const entry = changes[STORAGE_KEY].newValue;
      if (!entry) return;
      info.textContent = `Último: ${new Date(entry.ts).toLocaleTimeString()}`;
      draw(entry.data);
    });
  } catch (err) {
    console.warn("storage.onChanged unavailable", err);
  }

  /* ===== initial load using safeGetStorage ============================== */
  safeGetStorage(STORAGE_KEY, (res) => {
    const entry = res?.[STORAGE_KEY];
    if (entry && Array.isArray(entry.data)) {
      info.textContent = `Último: ${new Date(entry.ts).toLocaleTimeString()}`;
      draw(entry.data);
    } else {
      info.textContent = "Esperando Pinnacle (haz click en la burbuja Pinnacle)";
    }
  });

})();
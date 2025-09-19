(() => {
  const STORAGE_KEY = "buho_latest_odds";

  const SPORT_CFG = {
    soccer: {
      markets: [
        "Money Line – Match",
        "Total – Match"
      ]
    },
    Basketball: { markets: [] } // placeholder; scraping logic for other sports removed for now
  };

  // add floating bubble button
  const bubble = document.createElement("button");
  bubble.id = "buho-scrape-bubble";
  bubble.className = "buho-scrape-bubble";
  bubble.title = "BúhoTrader — Scrape odds (click)";
  bubble.innerHTML = "🔑";
  document.body.appendChild(bubble);

  // small helper to update state visuals
  function flash(state) {
    bubble.classList.remove("busy", "done", "error");
    bubble.classList.add(state);
    setTimeout(() => bubble.classList.remove(state), 1600);
  }

  // promise wrapper for storage.set
  function setStorage(obj) {
    return new Promise((resolve, reject) => {
      chrome.storage.local.set(obj, () => {
        if (chrome.runtime.lastError) return reject(chrome.runtime.lastError);
        resolve();
      });
    });
  }

  bubble.addEventListener("click", async () => {
    if (bubble.disabled) return;
    bubble.disabled = true;
    bubble.classList.add("busy");

    try {
      const sport = sportFromUrl(window.location.href);
      const odds = scrapePinnacle(sport, SPORT_CFG);
      await setStorage({ [STORAGE_KEY]: { data: odds, ts: Date.now(), url: location.href } });
      flash("done");
    } catch (err) {
      console.error("BuhoTrader: scrape failed", err);
      flash("error");
    } finally {
      bubble.classList.remove("busy");
      bubble.disabled = false;
    }
  });

  // --- detect sport helper -----------------------------------
  function sportFromUrl (url) {
    const m = url.match(/\/en\/([^/]+)/i);
    if (!m) throw new Error("Can't detect sport in URL");
    const sportKey = m[1].toLowerCase();
    if (sportKey === 'soccer') return 'soccer';
    if (sportKey === 'basketball') return 'basketball';
    throw new Error("Unsupported sport: " + sportKey);
  }

  // --- pinnacle scraping ------
  function scrapePinnacle(sport, SPORT_CFG) {
    const mgroups = [...document.querySelectorAll("[class*='marketGroup-']")];
    const odds = [];

    const showAllBtn = document.querySelector("button[class*='showAllButton']");
    if (showAllBtn && showAllBtn.textContent.trim() === "Show All") {
      showAllBtn.click();
    }

    if (sport.toLowerCase() !== 'soccer') {
      throw new Error("scrapePinnacle currently supports only soccer");
    }

    const teamEls = [...document.querySelectorAll("[class*='participantName-']")];
    const [homeName, awayName] = teamEls.map(el => el.textContent.trim());

    function getScore(xpath) {
      try {
        const result = document.evaluate(
          xpath,
          document,
          null,
          XPathResult.FIRST_ORDERED_NODE_TYPE,
          null
        ).singleNodeValue;
        return parseInt(result.textContent.trim(), 10) || 0;
      } catch {
        return 0;
      }
    }

    const homeScore = getScore('//*[@id="root"]/div[1]/div[2]/main/div[2]/div[2]/div[2]/div[6]/span');
    const awayScore = getScore('//*[@id="root"]/div[1]/div[2]/main/div[2]/div[2]/div[3]/div[6]/span');

    const scoreDict = {
      [homeName]: homeScore,
      [awayName]: awayScore
    };

    // temporary holders for the visible markets we need
    let mlMarket = null;   // { labels:[], prices:[] }
    let ouMarkets = [];    // [{ line, overPrice, underPrice }]
    let goalBucket = {};   // { [teamName]: [ { label, pRaw } ] }

    // small DOM helper
    function text(el, sel) {
      const t = el.querySelector(sel);
      return t ? t.textContent.trim() : "";
    }

    // scan the market groups and collect the visible Moneyline and first visible OU pair (no "See more")
    for (const g of mgroups) {
      const title = text(g, "[class^='titleText-']") || text(g, "[class^='title-']");

      if (title === "Money Line – Match") {
        const labels = [], prices = [];
        for (const b of g.querySelectorAll("button.market-btn")) {
          const l = text(b, "[class*='label']"), p = parseFloat(text(b, "[class*='price']"));
          if (l && p) { labels.push(l); prices.push(p); }
        }
        if (labels.length >= 2) {
          mlMarket = { labels, prices };
        }
        continue;
      }
      
      if (title === "Total – Match") {
        // expand "See more" so we collect ALL visible total lines (not just the first pair)
        const toggle = g.querySelector('span[class^="toggleMarketsText"]');
        if (toggle && toggle.textContent.trim() === "See more") {
          toggle.click();
        }

        const pairs = {};
        for (const b of g.querySelectorAll("button.market-btn")) {
          const l = text(b, "[class*='label']"), p = parseFloat(text(b, "[class*='price']"));
          if (!l || !p || isNaN(p)) continue;
          const mOver = l.match(/^Over\s*([\d.]+)/i);
          const mUnder = l.match(/^Under\s*([\d.]+)/i);
          if (mOver) {
            const line = parseFloat(mOver[1]);
            pairs[line] = pairs[line] || {};
            pairs[line].over = p;
            pairs[line].line = line;
          } else if (mUnder) {
            const line = parseFloat(mUnder[1]);
            pairs[line] = pairs[line] || {};
            pairs[line].under = p;
            pairs[line].line = line;
          }
        }

        const lines = Object.keys(pairs).map(k => parseFloat(k)).sort((a,b) => a - b);
        for (const line of lines) {
          const obj = pairs[line];
          if (obj.over && obj.under) {
            ouMarkets.push({ line: obj.line, overPrice: obj.over, underPrice: obj.under });
          }
        }
        continue;
      }

      const mGoals = title && title.match(/^(.+?)\s+Goals$/i);
      if (mGoals) {
        const team = mGoals[1].trim();
        for (const b of g.querySelectorAll("button.market-btn")) {
          const label = text(b, "[class*='label']");
          const price = parseFloat(text(b, "[class*='price']"));
          if (!label || !price || isNaN(price)) continue;
          const pRaw = 1 / price;
          (goalBucket[team] = goalBucket[team] || []).push({ label, pRaw });
        }
        continue;
      }
    } 

    // small numeric & probability helpers
    function oddsToProbs(prices) {
      const raw = prices.map(v => 1 / v);
      const sum = raw.reduce((s, x) => s + x, 0);
      return raw.map(r => r / sum);
    }

    // factorial with cache
    const factCache = [1, 1];
    function factorial(n) {
      if (factCache[n] !== undefined) return factCache[n];
      let last = factCache.length - 1;
      let val = factCache[last];
      for (let i = last + 1; i <= n; i++) {
        val *= i;
        factCache[i] = val;
      }
      return factCache[n];
    }

    function poisson(k, lambda) {
      if (lambda === 0) return k === 0 ? 1 : 0;
      return Math.exp(-lambda) * Math.pow(lambda, k) / factorial(k);
    }

    function probOverLine(line, mu, maxK = 60) {
      const start = Math.max(0, Math.floor(line) + 1);
      let sum = 0;
      for (let k = start; k <= maxK; k++) sum += poisson(k, mu);
      return sum;
    }

    function match_probs(lam_home, lam_away, max_goals = 20, currH = 0, currA = 0) {
      let pHome = 0, pDraw = 0, pAway = 0;
      for (let i = 0; i <= max_goals; i++) {
        const p_i = poisson(i, lam_home);
        for (let j = 0; j <= max_goals; j++) {
          const p_j = poisson(j, lam_away);
          const p = p_i * p_j;
          const finalH = currH + i;
          const finalA = currA + j;
          if (finalH > finalA) pHome += p;
          else if (finalH === finalA) pDraw += p;
          else pAway += p;
        }
      }
      return [pHome, pDraw, pAway];
    }

    // bisection solver to find mu such that P(total > line | mu) = pOver
    function findMuFromOU(line, pOverMarket) {
      if (pOverMarket <= 0) return 1e-9;
      if (pOverMarket >= 1) return 100.0;
      let low = 1e-8, high = 8.0;
      let fLow = probOverLine(line, low) - pOverMarket;
      let fHigh = probOverLine(line, high) - pOverMarket;
      let tries = 0;
      while (fLow * fHigh > 0 && tries < 50) {
        high *= 2;
        fHigh = probOverLine(line, high) - pOverMarket;
        tries++;
        if (high > 1000) break;
      }
      if (fLow * fHigh > 0) return high; // fallback
      for (let it = 0; it < 60; it++) {
        const mid = 0.5 * (low + high);
        const fMid = probOverLine(line, mid) - pOverMarket;
        if (Math.abs(fMid) < 1e-9) return mid;
        if (fMid * fLow <= 0) {
          high = mid;
          fHigh = fMid;
        } else {
          low = mid;
          fLow = fMid;
        }
      }
      return 0.5 * (low + high);
    }

    // solve lam_home such that P_home_model(lam_h, mu - lam_h) == p_home_market
    function solveLambdas(p_home_market, p_away_market, mu_total, currH = 0, currA = 0) {
      const eps = 1e-9;
      if (mu_total <= eps) return { lam_home: 0, lam_away: 0 };

      let low = eps, high = Math.max(mu_total - eps, eps);
      let fLow = match_probs(low, mu_total - low, 40, currH, currA)[0] - p_home_market;
      let fHigh = match_probs(high, mu_total - high, 40, currH, currA)[0] - p_home_market;

      if (fLow * fHigh > 0) {
        const strengthHome = Math.max(p_home_market, eps);
        const strengthAway = Math.max(p_away_market, eps);
        const share = strengthHome / (strengthHome + strengthAway);
        return { lam_home: mu_total * share, lam_away: mu_total * (1 - share) };
      }

      for (let it = 0; it < 60; it++) {
        const mid = 0.5 * (low + high);
        const pMid = match_probs(mid, mu_total - mid, 40, currH, currA)[0];
        const fMid = pMid - p_home_market;
        if (Math.abs(fMid) < 1e-9) return { lam_home: mid, lam_away: mu_total - mid };
        if (fMid * fLow <= 0) {
          high = mid;
          fHigh = fMid;
        } else {
          low = mid;
          fLow = fMid;
        }
      }
      const lam_home = 0.5 * (low + high);
      return { lam_home, lam_away: mu_total - lam_home };
    }

    // Build final probability matrix for additional goals (i,j)
    function buildProbabilityMatrix(proj, scoreDict, maxGoals) {
      const home     = proj.home.name;
      const away     = proj.away.name;
      const lambdaH  = proj.home.lambda;
      const lambdaA  = proj.away.lambda;
      const currH    = scoreDict[home];
      const currA    = scoreDict[away];
      const matrix   = {};

      for (let i = 0; i <= maxGoals; i++) {
        for (let j = 0; j <= maxGoals; j++) {
          const finalH = currH + i;
          const finalA = currA + j;
          matrix[`${finalH}-${finalA}`] =
            poisson(i, lambdaH) * poisson(j, lambdaA);
        }
      }
      return matrix;
    }

    // Compute Correct Score markets from matrix
    function computeMarkets(proj, matrix, scoreDict) {
      const home = proj.home.name;
      const away = proj.away.name;
      const out = [];

      const entries = Object.entries(matrix).map(([score, p]) => {
        const [h, a] = score.split('-').map(Number);
        return { score, p, h, a };
      });

      entries.forEach(({ score, p, h, a }) => {
        if (h <= 3 && a <= 3 && p > 0) {
          out.push(['Correct Score', score, +(1 / p).toFixed(3)]);
        }
      });

      let home4p = 0, draw4p = 0, away4p = 0;
      entries.forEach(({ h, a, p }) => {
        if (h >= 4 && h > a) home4p += p;
        else if (a >= 4 && a > h) away4p += p;
        else if (h === a && h >= 4) draw4p += p;
      });

      if (home4p > 0) out.push(['Correct Score', `${home} 4+`, +(1 / home4p).toFixed(3)]);
      if (draw4p > 0) out.push(['Correct Score', 'Draw 4+', +(1 / draw4p).toFixed(3)]);
      if (away4p > 0) out.push(['Correct Score', `${away} 4+`, +(1 / away4p).toFixed(3)]);

      return out;
    }

    function processOddsFromProjection(proj, scoreDict) {
      const matrix  = buildProbabilityMatrix(proj, scoreDict, 10);
      const allOdds = computeMarkets(proj, matrix, scoreDict);
      return allOdds;
    }

    // Now: if we have both ML and OU visible, infer lambdas and push model-derived markets
    if (mlMarket && ouMarkets.length > 0) {
      // Moneyline: assume order is [home, draw, away]
      const mlPrices = mlMarket.prices.slice(0, 3);
      const mlProbs = oddsToProbs(mlPrices);
      const [p_home_market, p_draw_market, p_away_market] = mlProbs;
      const currTotal = homeScore + awayScore;

      // derive mu for each available OU line, then use median for robustness
      const muCandidates = [];
      for (const ou of ouMarkets) {
        const ouProbs = oddsToProbs([ou.overPrice, ou.underPrice]);
        const p_over_market = ouProbs[0];
        const remLine = ou.line - currTotal;
        if (p_over_market > 0 && p_over_market < 1) {
          muCandidates.push(findMuFromOU(remLine, p_over_market));
        }
      }

      // fallback if something went wrong
      let mu_total;
      if (muCandidates.length === 0) {
        const first = ouMarkets[0];
        const firstProbs = oddsToProbs([first.overPrice, first.underPrice]);
        mu_total = findMuFromOU(first.line - currTotal, firstProbs[0]);
      } else {
        muCandidates.sort((a,b) => a - b);
        const mid = Math.floor(muCandidates.length / 2);
        mu_total = (muCandidates.length % 2 === 1) ? muCandidates[mid] : 0.5 * (muCandidates[mid-1] + muCandidates[mid]);
      }

      // solve for lambdas using the inferred total mu
      const { lam_home, lam_away } = solveLambdas(p_home_market, p_away_market, mu_total, homeScore, awayScore);

      // push model-derived Moneyline (using team names)
      const [p_h_model, p_draw_model, p_a_model] = match_probs(lam_home, lam_away, 30, homeScore, awayScore);
      if (p_h_model > 0) odds.push(['Money Line – Match', homeName, +(1 / p_h_model).toFixed(3)]);
      if (p_draw_model > 0) odds.push(['Money Line – Match', 'Draw', +(1 / p_draw_model).toFixed(3)]);
      if (p_a_model > 0) odds.push(['Money Line – Match', awayName, +(1 / p_a_model).toFixed(3)]);

      // push model-derived Totals for ALL available lines (so "all the lines go to totals")
      for (const ou of ouMarkets) {
        const remLine = ou.line - currTotal;
        const p_over_model = probOverLine(remLine, mu_total, 80);
        const p_under_model = Math.max(0, 1 - p_over_model);
        if (p_over_model > 0) odds.push(['Total – Match', `Over ${ou.line}`, +(1 / p_over_model).toFixed(3)]);
        if (p_under_model > 0) odds.push(['Total – Match', `Under ${ou.line}`, +(1 / p_under_model).toFixed(3)]);
      }

      // correct score markets derived from lambdas
      const proj = {
        home: { name: homeName, lambda: lam_home },
        away: { name: awayName, lambda: lam_away }
      };
      odds.push(...processOddsFromProjection(proj, scoreDict));

      return odds;
    }

    // fallback when ML is NOT present — derive lambdas from Team Goals ---
    if (!mlMarket && goalBucket[homeName] && goalBucket[awayName]) {
      const teamProj = {};

      for (const team of [homeName, awayName]) {
        const rows = goalBucket[team];
        const sumRaw = rows.reduce((sum, r) => sum + r.pRaw, 0);
        let expAdd = 0;

        for (const { label, pRaw } of rows) {
          const pNoVig = pRaw / sumRaw;
          const m = /^(\d+)(\+?)$/.exec(label);
          if (!m) continue;
          const num = m[1], plus = m[2];
          const line = parseInt(num, 10) + (plus ? 0.5 : 0);
          const remaining = Math.max(line - scoreDict[team], 0);
          expAdd += pNoVig * remaining;
        }

        teamProj[team] = +expAdd.toFixed(3);
      }

      const proj = {
        home: { name: homeName, lambda: teamProj[homeName] },
        away: { name: awayName, lambda: teamProj[awayName] }
      };

      // use the same projection -> markets function your script already uses
      odds.push(...processOddsFromProjection(proj, scoreDict));
      return odds;
    }
  }
})();
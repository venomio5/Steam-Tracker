from datetime import datetime, timedelta
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from queue import PriorityQueue, Empty
from itertools import count
from queue import SimpleQueue
import numpy as np, pandas as pd, re
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.chrome.service import Service
from selenium.common.exceptions import NoSuchElementException, TimeoutException
import DatabaseManager


SPORT_CFG = {
    "Soccer": {
        "markets": [
            "Money Line – Match", "Handicap – Match", "Total – Match",
            "Team Total – Match", "Money Line – 1st Half",
            "Handicap – 1st Half", "Total – 1st Half",
            "Team Total – 1st Half", "Handicap (Corners) – Match",
            "Total (Corners) – Match", "Both Teams To Score?",
            "Both Teams To Score? 1st Half", "Correct Score",
            "Correct Score 1st Half", "Total (Bookings) – Match",
        ],
        "prob_mode": "variable",
        "table": "pinnacle_soccer",
    },
    "Baseball": {
        "markets": [
            "Money Line – Game", "Handicap – Game",
            "Total – Game", "Team Total – Game",
        ],
        "prob_mode": "most",
        "table": "pinnacle_baseball",
    },
    "Basketball": {
        "markets": [
            "Money Line – Game", "Handicap – Game",
            "Total – Game", "Team Total – Game",
        ],
        "prob_mode": "most",
        "table": "pinnacle_basketball",
    },
}

THREADS = 3
HEADLESS = False
CHROME_BINARY = "chromedriver.exe"

def _probabilities(labels: list[str], prices: list[str], mode: str) -> dict[str, float]:
    """Calcula probabilidades verdaderas (normalizadas)"""
    price = np.asarray(prices, dtype=float)
    implied = 1.0 / price
    if mode == "money":
        probs = implied / implied.sum()
        return dict(zip(labels, probs))
    # modo "most": cada par de precios se normaliza
    if len(price) % 2:
        raise ValueError("Longitud de precios impar para modo 'most'")
    probs = np.empty_like(price)
    for i in range(0, len(price), 2):
        segment = implied[i:i + 2]
        probs[i:i + 2] = segment / segment.sum()
    return dict(zip(labels, probs))

def normalize_team_name(name: str) -> str:
    name = re.sub(r"\b\d+\b", "", name)              # Elimina números
    name = re.sub(r"\(.*?\)", "", name)              # Elimina paréntesis (Match)
    name = re.sub(r"\s+", " ", name)                 # Espacios dobles
    return name.strip().lower()                      # Limpieza final

class _DriverPool:
    def __init__(self, size: int):
        self._drivers = SimpleQueue()
        for _ in range(size):
            opts = webdriver.ChromeOptions()
            if HEADLESS:
                opts.add_argument("--headless=new")
            self._drivers.put(webdriver.Chrome(
                service=Service(CHROME_BINARY), options=opts
            ))

    def acquire(self):
        return self._drivers.get(block=True)

    def release(self, driver):
        self._drivers.put(driver)

    def shutdown(self):
        while not self._drivers.empty():
            self._drivers.get_nowait().quit()
        
DRIVER_POOL = _DriverPool(size=THREADS)

class UpdatePinnacle:
    def __init__(self): 
        self.db = DatabaseManager.DatabaseManager(host="localhost", user="root", password="venomio", database="vodds")
        self.delete_old_matches()

    def run(self):
        leagues = self.db.select("SELECT * FROM pinnacle_leagues")
        leagues["league_last_updated_date"] = pd.to_datetime(
            leagues["league_last_updated_date"]
        )
        threshold = datetime.now() - timedelta(days=1)

        # ► Actualizar ligas en paralelo
        with ThreadPoolExecutor(max_workers=THREADS) as ex:
            futures = [
                ex.submit(self._scrape_league_if_needed, row)
                for _, row in leagues.iterrows()
                if row["league_last_updated_date"] < threshold
            ]
            for f in as_completed(futures):
                f.result()

        # ► Actualizar eventos
        self._refresh_events()

    def _scrape_league_if_needed(self, league_row):
        self._scrape_league(
            url=league_row["league_url"],
            league_id=league_row["league_id"],
        )
        self.db.execute(
            "UPDATE pinnacle_leagues SET league_last_updated_date = %s "
            "WHERE league_id = %s",
            (datetime.now(), league_row["league_id"]),
        )

    def _scrape_league(self, url: str, league_id: int):
        driver = DRIVER_POOL.acquire()
        try:
            driver.get(url)

            try:
                container = WebDriverWait(driver, 20).until(
                    EC.presence_of_element_located((By.CSS_SELECTOR, "div.contentBlock.square"))
                )
            except TimeoutException:
                print(f"⚠️  League {league_id} offline") 
                return

            divisions = container.find_elements(By.XPATH, ".//div")
            scraped_matches = []
            current_date_raw = None

            for div in divisions:
                cls = div.get_attribute("class") or ""
                if "dateBar" in cls:
                    current_date_raw = div.text.strip()
                    continue

                try:
                    link = div.find_element(By.XPATH, ".//a[@href]")
                except NoSuchElementException:
                    continue

                try:
                    time_raw = link.find_element(
                        By.XPATH, ".//div[contains(@class,'matchupDate')]"
                    ).text.strip()
                except NoSuchElementException:
                    continue

                teams = " vs ".join(
                    ele.text.replace(" (Match)", "").strip()
                    for ele in link.find_elements(
                        By.XPATH,
                        ".//div[contains(@class,'ellipsis') and contains(@class,'gameInfoLabel')]",
                    )
                )
                match_url = link.get_attribute("href")
                sql_datetime = self.convert_datetime(current_date_raw, time_raw)

                scraped_matches.append((teams, match_url, sql_datetime))

            if not scraped_matches:
                print(f"⚠️  League {league_id} offline (lista vacía)")
                return


            self.db.execute(
                """
                INSERT INTO pinnacle_events (event_name, event_url, event_date, event_league_id, event_created_date)
                VALUES (%s, %s, %s, %s, NOW())
                ON DUPLICATE KEY UPDATE
                    event_url  = VALUES(event_url),
                    event_date = VALUES(event_date)
                """,
                [(m[0], m[1], m[2], league_id) for m in scraped_matches],
                many=True,
            )

        finally:
            DRIVER_POOL.release(driver)

    def _refresh_events(self):
        df = self.db.select(
            """
            SELECT e.event_id,e.event_name,e.event_url,e.event_date,
                   e.event_last_updated_date,event_league_id,l.league_sport
            FROM pinnacle_events AS e
            JOIN pinnacle_leagues AS l ON e.event_league_id=l.league_id
            """
        )
        now = pd.Timestamp.now()
        df["event_last_updated_date"] = pd.to_datetime(df["event_last_updated_date"])
        df["event_date"] = pd.to_datetime(df["event_date"])

        pq: PriorityQueue = PriorityQueue()
        _counter = count() 

        for _, row in df.iterrows():
            sport = row["league_sport"]
            cfg = SPORT_CFG.get(sport)
            if cfg is None:
                continue

            # decidir si requiere actualización
            delta_start  = row["event_date"] - now
            if   delta_start <= pd.Timedelta(hours=2):   interval = pd.Timedelta(minutes=2)
            elif delta_start <= pd.Timedelta(hours=4):   interval = pd.Timedelta(minutes=5)
            elif delta_start <= pd.Timedelta(hours=8):   interval = pd.Timedelta(hours=3)
            elif delta_start <= pd.Timedelta(hours=24):  interval = pd.Timedelta(hours=8)
            else:                                        interval = pd.Timedelta(hours=72)
            threshold = now - interval

            if pd.isna(row["event_last_updated_date"]) or row["event_last_updated_date"] < threshold:
                priority = abs(delta_start.total_seconds())
                pq.put((priority, next(_counter), row, cfg))

        def worker():
            while True:
                try:
                    _, _, row, cfg = pq.get_nowait()
                except Empty:
                    return
                try:
                    self._scrape_event_wrapper(row, cfg)
                except Exception as e:
                    print(f"Error scraping event {row['event_id']}: {e}")
                finally:
                    pq.task_done()

        threads = [threading.Thread(target=worker, daemon=True) for _ in range(THREADS)]
        for t in threads: t.start()
        pq.join()

    def _scrape_event_wrapper(self, row, cfg):
        try:
            self._scrape_event(
                sport_cfg=cfg,
                event_url=row["event_url"],
                event_id=row["event_id"]
            )
        except Exception as e:
            print(f"{row['event_name']} {e}")
            return
        
        self.db.execute(
            "UPDATE pinnacle_events SET event_last_updated_date=%s WHERE event_id=%s",
            (datetime.now(), row["event_id"]),
        )

    def _scrape_event(self, *, sport_cfg, event_url, event_id):
        driver = DRIVER_POOL.acquire()
        try:
            driver.get(event_url)

            WebDriverWait(driver, 20).until(
                EC.element_to_be_clickable((By.CSS_SELECTOR, 'button[class^="showAllButton"]'))
            ).click()

            groups = WebDriverWait(driver, 20).until(
                EC.presence_of_all_elements_located(
                    (By.CSS_SELECTOR, "[class*='marketGroup-wMlWprW2iC']")
                )
            )

            upserts = []
            for group in groups:
                title = self._safe_text(group, '[class^="titleText-"]') or self._safe_text(group, '[class^="title-"]')
                if title not in sport_cfg["markets"]:
                    continue

                # toggle
                try:
                    group.find_element(By.CSS_SELECTOR, 'button[class^="toggleMarkets"]').click()
                except Exception:
                    pass

                labels, prices = self._extract_labels_prices(group, title)

                mode = (
                    "money"
                    if sport_cfg["prob_mode"] == "money"
                    else "money"
                    if "Money Line" in title or "Correct Score" in title
                    else "most"
                )
                probs = _probabilities(labels, prices, mode)
                for outcome, prob in probs.items():
                    upserts.append(
                        (event_id, title, outcome, round(1 / prob, 3))
                    )

            # bulk UPSERT
            if upserts:
                self.db.execute(
                    f"""
                    INSERT INTO {sport_cfg['table']}
                        (event_id, market_type, outcome, min_odds)
                    VALUES ( %s,       %s,          %s,      JSON_ARRAY(%s))
                    ON DUPLICATE KEY UPDATE
                        min_odds   = JSON_ARRAY_APPEND(min_odds,'$', JSON_EXTRACT(VALUES(min_odds), '$[0]'));
                    """,
                    [(e[0], e[1], e[2], e[3]) for e in upserts],
                    many=True,
                )  
        finally:
            DRIVER_POOL.release(driver)

    @staticmethod
    def _safe_text(el, css):
        try:
            return el.find_element(By.CSS_SELECTOR, css).text
        except NoSuchElementException:
            return ""

    @staticmethod
    def _extract_labels_prices(group, title):
        buttons = group.find_elements(By.CSS_SELECTOR, 'button.market-btn')
        labels, prices = [], []
        for btn in buttons:
            labels.append(
                btn.find_element(By.CLASS_NAME, 'label-GT4CkXEOFj').text
            )
            prices.append(
                btn.find_element(By.CLASS_NAME, 'price-r5BU0ynJha').text
            )

        # prefijos Home/Away si aplica
        if "team" in title.lower() and "both teams to score?" not in title.lower():
            for i in range(len(labels)):
                labels[i] = ("Home " if (i // 2) % 2 == 0 else "Away ") + labels[i]
        elif "handicap" in title.lower():
            for i in range(0, len(labels), 2):
                labels[i] = "Home " + labels[i]
                if i + 1 < len(labels):
                    labels[i + 1] = "Away " + labels[i + 1]

        return labels, prices
    
    # ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    def delete_old_matches(self):
        self.db.execute("""
            DELETE FROM pinnacle_events 
            WHERE event_date < NOW()
        """)

    @staticmethod
    def convert_datetime(date_str: str, time_str: str) -> str:
        date_up = date_str.upper().strip()

        # ── TODAY / TOMORROW ──
        if "TODAY" in date_up:
            date_obj = datetime.today()

        elif "TOMORROW" in date_up:
            date_obj = datetime.today() + timedelta(days=1)

        # ── Formato “TUE MAY 06, 2025”  o  “MAY 06, 2025” ──
        elif "," in date_up:
            parts = date_up.split(",")
            month_day = parts[-2].strip()           # “TUE MAY 06”  ó  “MAY 06”
            year = parts[-1].strip()

            # limpia weekday si existe (3 tokens)
            tokens = month_day.split()              # ['TUE','MAY','06']  →  ['MAY','06']
            if len(tokens) == 3:
                tokens = tokens[1:]
            month_day_clean = " ".join(tokens)      # “MAY 06”

            # %b espera capitalización tipo “May”
            date_for_parse = f"{month_day_clean.title()} {year}"
            date_obj = datetime.strptime(date_for_parse, "%b %d %Y")

        else:
            raise ValueError(f"Formato de fecha no soportado: {date_str}")

        # ── Hora ──
        time_obj = datetime.strptime(time_str.strip(), "%H:%M")

        return datetime.combine(date_obj.date(), time_obj.time()).strftime("%Y-%m-%d %H:%M:%S")
    
# ──────────────────────────── MAIN ───────────────────────────────
if __name__ == "__main__":
    UpdatePinnacle().run()
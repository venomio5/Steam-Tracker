from datetime import datetime
import pandas as pd
import sys
import time
import threading
from PyQt5.QtCore import Qt,  pyqtSignal, QThread, QObject, QTimer, pyqtSlot
from PyQt5.QtGui import QColor
from PyQt5.QtWidgets import (QApplication, QMainWindow, QWidget, QHBoxLayout, QVBoxLayout,
                            QComboBox, QScrollArea, QLabel, QPushButton, QCheckBox, QDoubleSpinBox,
                            QDialog, QListWidget, QListWidgetItem, QTabWidget, QFormLayout, QGraphicsDropShadowEffect,
                            QPlainTextEdit, QGridLayout, QLineEdit, QGroupBox, QSpinBox)
import vpfm
import prescraping, livescraping
import DatabaseManager
import warnings
warnings.filterwarnings("ignore", category=DeprecationWarning)

'''
CHANGES
- Filters in the games.
- Graph of odds and time. Have begginng date, current date, and game dte.
- Ability to click to watch a market (button on the game section) and see it in the left side.
- On / off pre scraping
'''

class UpdatePrescrapingWorker(QObject):
    update_finished = pyqtSignal()
    
    def __init__(self):
        super().__init__()
        self._running = False

    @pyqtSlot()
    def start(self):
        self._running = True
        threading.Thread(target=self._loop, daemon=True).start()

    def stop(self):
        self._running = False

    def _loop(self):
        while self._running:
            try:
                prescraping.UpdatePinnacle().run()
            except Exception as e:
                print("Scraper error:", e)
            self.update_finished.emit()
            time.sleep(5)  # ⏱️ Espera exacta de 5 segundos

class OddsScraperThread(QThread):
    finished = pyqtSignal(list)
    error = pyqtSignal(str)

    def __init__(self, url: str, sport: str):
        super().__init__()
        self.url = url
        self.sport = sport

    def run(self):
        try:
            scraper = livescraping.LiveEventScraper(self.url, self.sport)
            data = scraper.run()
            self.finished.emit(data)
        except Exception as e:
            self.error.emit(str(e))

class MainWindow(QMainWindow):
    def __init__(self):
        super().__init__()
        self.setWindowTitle("LineSniper")
        self.resize(1920, 1080) 
        self.showMaximized()

        # self.thread = QThread()
        # self.worker = UpdatePrescrapingWorker()
        # self.worker.moveToThread(self.thread)

        # self.thread.started.connect(self.worker.start)
        # self.worker.update_finished.connect(self.on_update_finished)

        # self.thread.start()
        
        self.vodds_db = DatabaseManager.DatabaseManager(host="localhost", user="root", password="venomio", database="vodds")

        main_widget = QWidget(self)
        self.setCentralWidget(main_widget)
        main_layout = QHBoxLayout()
        main_layout.setContentsMargins(0, 0, 0, 0)
        main_layout.setSpacing(0)
        main_widget.setLayout(main_layout)

        # Left section
        left_widget = QWidget()
        left_widget.setStyleSheet("background-color: #1a1a1a;")
        self.setup_left_section(left_widget)
        main_layout.addWidget(left_widget)

        # Right section
        right_widget = QWidget()
        right_widget.setStyleSheet("background-color: #1a1a1a;")
        self.setup_right_section(right_widget)
        main_layout.addWidget(right_widget)

        self.live_odds_windows = []

    def closeEvent(self, event):
        self.worker.stop()
        self.thread.quit()
        self.thread.wait()
        super().closeEvent(event)

    def on_update_finished(self):
        pass

# ----------------------- LEFT SECTION  -----------------------
    def setup_left_section(self, widget):
        main_layout = QVBoxLayout(widget)

        self.scroll_area = QScrollArea()
        self.scroll_area.setWidgetResizable(True)
        self.events_container = QWidget()
        self.events_layout = QVBoxLayout(self.events_container)
        self.scroll_area.setWidget(self.events_container)
        main_layout.addWidget(self.scroll_area)
        self.refresh_events()

        self.refresh_timer = QTimer()
        self.refresh_timer.timeout.connect(self.refresh_events)
        self.refresh_timer.start(30000)

    def refresh_events(self):
        events_query = """
                    SELECT 
                        odds_id, market_type, outcome, min_odds, odds_watch, event_name, event_date, league_name, league_sport, event_last_updated_date,
                        (
                            (1 / JSON_EXTRACT(min_odds, CONCAT('$[', JSON_LENGTH(min_odds) - 1, ']'))) -
                            (1 / JSON_EXTRACT(min_odds, CONCAT('$[', JSON_LENGTH(min_odds) - 2, ']')))
                        ) * 100
                        AS prob_diff_pct,
                        JSON_EXTRACT(min_odds, CONCAT('$[', JSON_LENGTH(min_odds) - 1, ']')) AS last_odd

                    FROM (
                        SELECT * FROM pinnacle_soccer
                        UNION ALL
                        SELECT * FROM pinnacle_baseball
                        UNION ALL
                        SELECT * FROM pinnacle_basketball
                    ) AS all_odds
                    INNER JOIN pinnacle_events ON all_odds.event_id = pinnacle_events.event_id
                    INNER JOIN pinnacle_leagues ON pinnacle_events.event_league_id = pinnacle_leagues.league_id
                    WHERE (
                        odds_watch = 1
                        OR (
                            JSON_LENGTH(min_odds) >= 2
                            AND ABS(
                                (1 / JSON_EXTRACT(min_odds, CONCAT('$[', JSON_LENGTH(min_odds) - 1, ']'))) -
                                (1 / JSON_EXTRACT(min_odds, CONCAT('$[', JSON_LENGTH(min_odds) - 2, ']')))
                            ) > 0.005
                            AND event_date < DATE_ADD(NOW(), INTERVAL 4 HOUR)
                        )
                    )
                    ORDER BY prob_diff_pct DESC;
                    """
        self.events_data = self.vodds_db.select(events_query)
        self.populate_events()

    def populate_events(self):
        while self.events_layout.count():
            child = self.events_layout.takeAt(0)
            if child.widget():
                child.widget().deleteLater()
        for _, row in self.events_data.iterrows():
            event_widget = self.create_event_widget(row)
            self.events_layout.addWidget(event_widget)
        self.events_layout.addStretch()

    def create_event_widget(self, event):
        widget = QWidget()
        layout = QVBoxLayout(widget)
        
        main_row = QHBoxLayout()
        
        odds_value = f"{round(event['prob_diff_pct'], 2)}%"
        odds_label = QLabel(odds_value)
        odds_label.setAlignment(Qt.AlignCenter)
        odds_label.setMinimumWidth(10)
        if event['prob_diff_pct'] > 0:
            odds_label.setStyleSheet("color: #03fc73; font-size: 24px; border: none; border-radius: 50px;")
            effect = QGraphicsDropShadowEffect()
            effect.setBlurRadius(20)
            effect.setColor(QColor("#03fc73"))
            effect.setOffset(0)
            odds_label.setGraphicsEffect(effect)
        elif event['prob_diff_pct'] < 0:
            odds_label.setStyleSheet("color: #f71414; font-size: 24px; border: none; border-radius: 50px;")
            effect = QGraphicsDropShadowEffect()
            effect.setBlurRadius(20)
            effect.setColor(QColor("#f71414"))
            effect.setOffset(0)
            odds_label.setGraphicsEffect(effect)
        else:
            odds_label.setStyleSheet("background-color: grey; color: white; padding: 5px; font-size: 24px; border: none;")
        main_row.addWidget(odds_label)
        
        details_layout = QVBoxLayout()
        
        league_row = QHBoxLayout()
        league_name_label = QLabel(event['league_name'])
        league_name_label.setStyleSheet("color: white; padding: 5px; border: none;")
        league_row.addWidget(league_name_label)
        league_sport_label = QLabel(event['league_sport'])
        league_sport_label.setStyleSheet("color: white; padding: 5px; border: none;")
        league_row.addWidget(league_sport_label)
        details_layout.addLayout(league_row)

        event_name_row = QHBoxLayout()
        event_name_label = QLabel(event['event_name'])
        event_name_label.setStyleSheet("color: white; padding: 5px; border: none;")
        event_name_row.addWidget(event_name_label)
        details_layout.addLayout(event_name_row)
        
        event_row = QHBoxLayout()
        market_label = QLabel(event['market_type'])
        market_label.setStyleSheet("color: white; padding: 5px; border: none;")
        event_row.addWidget(market_label)
        outcome_label = QLabel(event['outcome'])
        outcome_label.setStyleSheet("color: white; padding: 5px; border: none;")
        event_row.addWidget(outcome_label)
        min_odds_label = QLabel(str(event['last_odd']))
        min_odds_label.setStyleSheet("color: white; padding: 5px; border: none;")
        event_row.addWidget(min_odds_label)
        details_layout.addLayout(event_row)
        
        main_row.addLayout(details_layout)
        layout.addLayout(main_row)
        
        row2 = QHBoxLayout()
        watch_button = QPushButton("Watch")
        watch_button.clicked.connect(lambda: self.watch_event(event))
        watch_button.setStyleSheet("color: white;")
        watch_button.setCursor(Qt.PointingHandCursor)
        row2.addWidget(watch_button)
        layout.addLayout(row2)
        
        row3 = QHBoxLayout()
        last_updated_label = QLabel(self.get_last_updated_text(event['event_last_updated_date']))
        last_updated_label.setStyleSheet("color: white; padding: 5px; border: none;")
        row3.addWidget(last_updated_label)
        time_diff_label = QLabel(self.get_time_difference_text(event['event_date']))
        time_diff_label.setStyleSheet("color: white; padding: 5px; border: none;")
        row3.addWidget(time_diff_label)
        layout.addLayout(row3)
        widget.setStyleSheet("border: 1px solid white; margin: 5px;")
        return widget
    
    def watch_event(self, event):
        watch_boolean = 0
        if event['odds_watch'] == 0:
            watch_boolean = 1
        else:
            watch_boolean = 0
            
        table_name = ''
        if event['league_sport'] == 'Soccer':
            table_name = 'pinnacle_soccer'
        else:
            return None
        
        update_event_query = f"""
        UPDATE {table_name}
        SET odds_watch = {watch_boolean}
        WHERE odds_id = {event["odds_id"]};
        """
        self.vodds_db.execute(update_event_query)

    def get_time_difference_text(self, event_date):
        now = datetime.now()
        diff = event_date - now
        total_seconds = abs(diff.total_seconds())
        hours = int(total_seconds // 3600)
        minutes = int((total_seconds % 3600) // 60)
        parts = []
        if hours > 0:
            parts.append(f"{hours} hours")
        if minutes > 0 or not parts:
            parts.append(f"{minutes} minutes")
        time_str = ", ".join(parts)
        if diff.total_seconds() > 0:
            return "Starts in " + time_str
        else:
            return "Started " + time_str + " ago"
        
    def get_last_updated_text(self, last_updated_date):
        if pd.isna(last_updated_date):
            return "Last updated: N/A"
        
        now = datetime.now()
        diff = now - last_updated_date
        total_seconds = diff.total_seconds()
        hours = int(total_seconds // 3600)
        minutes = int((total_seconds % 3600) // 60)
        parts = []
        if hours > 0:
            parts.append(f"{hours} hours")
        if minutes > 0 or not parts:
            parts.append(f"{minutes} minutes")
        time_str = ", ".join(parts)
        return "Last updated " + time_str + " ago"

# ----------------------- RIGHT SECTION  -----------------------
    def setup_right_section(self, widget):
        right_layout = QVBoxLayout(widget)
        right_layout.setContentsMargins(10, 10, 10, 10)
        right_layout.setSpacing(15)

        self.events_list_container = QScrollArea()
        self.events_list_container.setWidgetResizable(True)
        self.events_list_widget = QWidget()
        self.events_list_layout = QVBoxLayout(self.events_list_widget)
        self.events_list_container.setWidget(self.events_list_widget)
        right_layout.addWidget(self.events_list_container)
        self.load_events_list()

        self.refresh_timer_2 = QTimer()
        self.refresh_timer_2.timeout.connect(self.load_events_list)
        self.refresh_timer_2.start(60000)

        live_odds_button = QPushButton("Live Odds")
        live_odds_button.setStyleSheet("background-color: #855e13; color: white; padding: 10px;")
        live_odds_button.clicked.connect(self.open_live_odds)
        right_layout.addWidget(live_odds_button)

        trading_calculator_button = QPushButton("Trading Calculator")
        trading_calculator_button.setStyleSheet("background-color: #138585; color: white; padding: 10px;")
        trading_calculator_button.clicked.connect(self.open_trading_calculator)
        right_layout.addWidget(trading_calculator_button)

        trade_amount_button = QPushButton("TradeAmount")
        trade_amount_button.setStyleSheet("background-color: #138585; color: white; padding: 10px;")
        trade_amount_button.clicked.connect(self.open_trade_amount)
        right_layout.addWidget(trade_amount_button)

    def load_events_list(self):
        query_events = """
                    SELECT event_id, event_name, event_date, event_last_updated_date, league_name, league_sport
                    FROM pinnacle_events
                    INNER JOIN pinnacle_leagues ON pinnacle_events.event_league_id = pinnacle_leagues.league_id
                    ORDER BY event_date ASC;
                    """
        self.events_list_data = self.vodds_db.select(query_events)
        self.populate_events_list()

    def populate_events_list(self):
        while self.events_list_layout.count():
            child = self.events_list_layout.takeAt(0)
            if child.widget():
                child.widget().deleteLater()
        for _, row in self.events_list_data.iterrows():
            event_box = self.create_event_box_widget(row)
            self.events_list_layout.addWidget(event_box)
        self.events_list_layout.addStretch()
        
    def create_event_box_widget(self, event):
        btn = QPushButton()
        btn.setStyleSheet("background-color: #1a1a1a; color: white; padding: 10px; text-align: left;")
        btn.setCursor(Qt.PointingHandCursor)
        btn.setText(f"{event['event_name']}\nEvent date: {event['event_date']}\n{event['league_name']} - {event['league_sport']}\nUpdated at {event['event_last_updated_date']}")
        btn.clicked.connect(lambda: self.open_odds_window(event))
        return btn
        
    def open_odds_window(self, event):
        odds_d = QDialog()
        odds_d.setWindowTitle(event['event_name'])
        odds_d.setStyleSheet("background-color: #1a1a1a; color: white;")
        odds_d.setWindowFlags(odds_d.windowFlags() & ~Qt.WindowContextHelpButtonHint)

        layout = QVBoxLayout(odds_d)
        scroll_area = QScrollArea()
        scroll_area.setWidgetResizable(True)
        container = QWidget()
        odds_layout = QVBoxLayout(container)
        query_odds = f"""
                    SELECT 
                        market_type, 
                        outcome, 
                        JSON_EXTRACT(min_odds, CONCAT('$[', JSON_LENGTH(min_odds) - 1, ']')) AS last_odd
                    FROM 
                        pinnacle_{event['league_sport']}
                    WHERE 
                        event_id = {event['event_id']};
                    """
        odds_data = self.vodds_db.select(query_odds)
        for _, odds in odds_data.iterrows():
            odds_widget = QLabel(f"{odds['market_type']} | {odds['outcome']} | {odds['last_odd']}")
            odds_widget.setStyleSheet("color: white; padding: 5px; border: 1px solid #ccc;")
            odds_layout.addWidget(odds_widget)
        odds_layout.addStretch()
        scroll_area.setWidget(container)
        layout.addWidget(scroll_area)

        self.odds_d = odds_d
        odds_d.show()

# -------------------- Open Buttons --------------------
    def open_trading_calculator(self):
        window = QWidget()
        window.setWindowTitle("Trading Calculator")
        window.setStyleSheet("background-color: #1a1a1a; color: white;")
        window.setMinimumSize(800, 600)

        layout = QVBoxLayout(window)
        tabs = QTabWidget()
        layout.addWidget(tabs)

        # ---------- MATCH TAB ----------
        match_tab = QWidget()
        match_layout = QVBoxLayout(match_tab)
        match_grid = QGridLayout()
        match_layout.addLayout(match_grid)

        headers = ["Selection", "Type", "Odds", "Amount", "Action"]
        for col, header in enumerate(headers):
            lbl = QLabel(header)
            lbl.setStyleSheet("font-weight: bold;")
            match_grid.addWidget(lbl, 0, col)

        match_bet_widgets = []
        match_profit_labels = {}

        result_grid = QGridLayout()
        match_layout.addLayout(result_grid)
        for i, outcome in enumerate(["Home", "Draw", "Away"]):
            lbl = QLabel(outcome)
            result_grid.addWidget(lbl, i, 0)
            val = QLabel("$0.00")
            val.setStyleSheet("font-weight: bold;")
            result_grid.addWidget(val, i, 1)
            match_profit_labels[outcome] = val

        def add_match_row():
            row = len(match_bet_widgets) + 1

            sel = QComboBox()
            sel.addItems(["Home", "Draw", "Away"])
            typ = QComboBox()
            typ.addItems(["Back", "Lay"])
            odds = QLineEdit()
            amount = QLineEdit()
            delete_btn = QPushButton("Delete")
            delete_btn.setStyleSheet("background-color: red; color: white;")

            def delete_row():
                for w in [sel, typ, odds, amount, delete_btn]:
                    w.deleteLater()
                match_bet_widgets.remove(entry)

            delete_btn.clicked.connect(delete_row)

            match_grid.addWidget(sel, row, 0)
            match_grid.addWidget(typ, row, 1)
            match_grid.addWidget(odds, row, 2)
            match_grid.addWidget(amount, row, 3)
            match_grid.addWidget(delete_btn, row, 4)

            entry = {"sel": sel, "typ": typ, "odds": odds, "amt": amount}
            match_bet_widgets.append(entry)

        def update_match():
            bets = []
            for w in match_bet_widgets:
                try:
                    o = float(w["odds"].text())
                    a = float(w["amt"].text())
                except:
                    continue
                bets.append({
                    "Selection": w["sel"].currentText(),
                    "Type": w["typ"].currentText(),
                    "Odds": o,
                    "Amount": a
                })
            trade = vpfm.MatchTrade(bets)
            for sel, label in match_profit_labels.items():
                pl = trade.selections_pl.get(sel, 0)
                color = "#4df9a2" if pl >= 0 else "#ce1d2e"
                label.setText(f"${pl:.2f}")
                label.setStyleSheet(f"font-weight: bold; color: {color};")

        add_btn = QPushButton("Add Bet")
        add_btn.setStyleSheet("background-color: #138585; color: white; padding: 5px;")
        add_btn.clicked.connect(add_match_row)

        update_btn = QPushButton("🔄")
        update_btn.setStyleSheet("background-color: #138585; color: white; padding: 5px;")
        update_btn.clicked.connect(update_match)

        btn_row = QHBoxLayout()
        btn_row.addWidget(add_btn)
        btn_row.addWidget(update_btn)
        btn_row.addStretch()
        match_layout.addLayout(btn_row)

        tabs.addTab(match_tab, "Match")

        # ---------- 2-WAY / SCORE TABS (Placeholders) ----------
        tw_tab = QWidget()
        tw_layout = QVBoxLayout(tw_tab)
        tw_layout.addWidget(QLabel("2-Way Trading Placeholder"))
        tabs.addTab(tw_tab, "2-Way")

        score_tab = QWidget()
        score_layout = QVBoxLayout(score_tab)
        score_layout.addWidget(QLabel("Score Trading Placeholder"))
        tabs.addTab(score_tab, "Score")

        window.show()
        if not hasattr(self, 'calc_windows'):
            self.calc_windows = []
        self.calc_windows.append(window)

    def open_trade_amount(self):
        ta_dialog = QDialog()
        ta_dialog.setWindowTitle("Trade Amount Calculation")
        ta_dialog.setStyleSheet("background-color: #1a1a1a; color: white;")
        ta_dialog.setWindowFlags(ta_dialog.windowFlags() & ~Qt.WindowContextHelpButtonHint)

        layout = QVBoxLayout(ta_dialog)

        betTypeLayout = QHBoxLayout()
        betTypeLabel = QLabel("Bet Type:")
        betTypeCombo = QComboBox()
        betTypeCombo.addItems(["Backing", "Laying"])
        betTypeLayout.addWidget(betTypeLabel)
        betTypeLayout.addWidget(betTypeCombo)
        layout.addLayout(betTypeLayout)

        myOddsLayout = QHBoxLayout()              
        myOddsLabel = QLabel("My Odds:")
        myOddsSpinBox = QDoubleSpinBox() 
        myOddsSpinBox.setDecimals(3) 
        myOddsSpinBox.setRange(1.01, 1000)
        myOddsSpinBox.setSingleStep(0.001)
        myOddsSpinBox.setValue(2.000)
        myOddsLayout.addWidget(myOddsLabel)
        myOddsLayout.addWidget(myOddsSpinBox)
        layout.addLayout(myOddsLayout)

        exchangeOddsLayout = QHBoxLayout()
        exchangeOddsLabel = QLabel("Exchange Odds:")
        exchangeOddsSpinBox = QDoubleSpinBox()
        exchangeOddsSpinBox.setDecimals(2)
        exchangeOddsSpinBox.setRange(1.01, 1000)
        exchangeOddsSpinBox.setSingleStep(0.01)
        exchangeOddsSpinBox.setValue(2.500)
        exchangeOddsLayout.addWidget(exchangeOddsLabel)
        exchangeOddsLayout.addWidget(exchangeOddsSpinBox)
        layout.addLayout(exchangeOddsLayout)

        bankrollLayout = QHBoxLayout()
        bankrollLabel = QLabel("Bankroll:")
        bankrollSpinBox = QDoubleSpinBox()
        bankrollSpinBox.setDecimals(2)
        bankrollSpinBox.setRange(0, 10000000)
        bankrollSpinBox.setSingleStep(1)
        bankrollSpinBox.setValue(30000.00)
        bankrollLayout.addWidget(bankrollLabel)
        bankrollLayout.addWidget(bankrollSpinBox)
        layout.addLayout(bankrollLayout)

        resultLabel = QLabel("")
        layout.addWidget(resultLabel)

        def calculate_trade():
            bet_type = betTypeCombo.currentText()
            my_odds = myOddsSpinBox.value()
            exchange_odds = exchangeOddsSpinBox.value()
            bankroll = bankrollSpinBox.value()         

            if bet_type == "Backing":
                p = 1 / my_odds
                edge = exchange_odds * p - 1
                kelly_fraction = max(edge / (exchange_odds - 1), 0)
                trade_amount = bankroll * (kelly_fraction / 3)
                resultLabel.setText(f"Bet Type: Backing\n"
                                    f"Edge: {edge*100:.2f}%\n"
                                    f"Trade Amount: ${trade_amount:.2f}")
            else:
                p = 1 / my_odds
                edge = 1 - exchange_odds * p
                kelly_fraction = max(edge / (exchange_odds - 1), 0)
                stake = bankroll * (kelly_fraction / 3)
                liability = stake * (exchange_odds - 1)
                resultLabel.setText(f"Bet Type: Laying\n"
                                    f"Edge: {edge*100:.2f}%\n"
                                    f"Trade Stake: ${stake:.2f}\n"
                                    f"Liability: ${liability:.2f}")

        myOddsSpinBox.valueChanged.connect(calculate_trade)
        exchangeOddsSpinBox.valueChanged.connect(calculate_trade)
        bankrollSpinBox.valueChanged.connect(calculate_trade)
        betTypeCombo.currentIndexChanged.connect(calculate_trade)

        self.ta_dialog = ta_dialog
        ta_dialog.show()

if __name__ == "__main__":
    app = QApplication(sys.argv)
    window = MainWindow()
    window.show()
    sys.exit(app.exec_())
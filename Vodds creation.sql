CREATE DATABASE IF NOT EXISTS vodds;
USE vodds;

CREATE TABLE IF NOT EXISTS pinnacle_leagues (
    league_id INT AUTO_INCREMENT PRIMARY KEY,
    league_name VARCHAR(255) NOT NULL,
    league_url VARCHAR(500) NOT NULL,
    league_sport VARCHAR(100) NOT NULL,
    league_last_updated_date DATETIME
);

CREATE TABLE IF NOT EXISTS pinnacle_events (
    event_id INT AUTO_INCREMENT PRIMARY KEY,
    event_name VARCHAR(255) NOT NULL,
    event_url VARCHAR(500) NOT NULL,
    event_date DATETIME,
    event_league_id INT,
    event_last_updated_date DATETIME,
    FOREIGN KEY (event_league_id) REFERENCES pinnacle_leagues(league_id),
    UNIQUE KEY unique_event (event_name, event_url)
);

CREATE TABLE IF NOT EXISTS pinnacle_soccer (
    id INT AUTO_INCREMENT PRIMARY KEY,
    event_id INT,
    market_type VARCHAR(255) NOT NULL,
    outcome VARCHAR(255) NOT NULL,
    odds JSON,
    date JSON,
    FOREIGN KEY (event_id) REFERENCES pinnacle_events(event_id) ON DELETE CASCADE,
    UNIQUE KEY unique_soccer_market (event_id, market_type, outcome)
);

CREATE TABLE IF NOT EXISTS pinnacle_baseball (
    id INT AUTO_INCREMENT PRIMARY KEY,
    event_id INT,
    market_type VARCHAR(255) NOT NULL,
    outcome VARCHAR(255) NOT NULL,
    odds JSON,
    date JSON,
    FOREIGN KEY (event_id) REFERENCES pinnacle_events(event_id) ON DELETE CASCADE,
    UNIQUE KEY unique_baseball_market (event_id, market_type, outcome)
);

CREATE TABLE IF NOT EXISTS pinnacle_basketball (
    id INT AUTO_INCREMENT PRIMARY KEY,
    event_id INT,
    market_type VARCHAR(255) NOT NULL,
    outcome VARCHAR(255) NOT NULL,
    odds JSON,
    date JSON,
    FOREIGN KEY (event_id) REFERENCES pinnacle_events(event_id) ON DELETE CASCADE,
    UNIQUE KEY unique_basketball_market (event_id, market_type, outcome)
);

CREATE TABLE IF NOT EXISTS pinnacle_football (
    id INT AUTO_INCREMENT PRIMARY KEY,
    event_id INT,
    market_type VARCHAR(255) NOT NULL,
    outcome VARCHAR(255) NOT NULL,
    odds JSON,
    date JSON,
    FOREIGN KEY (event_id) REFERENCES pinnacle_events(event_id) ON DELETE CASCADE,
    UNIQUE KEY unique_football_market (event_id, market_type, outcome)
);

CREATE TABLE IF NOT EXISTS pinnacle_hockey (
    id INT AUTO_INCREMENT PRIMARY KEY,
    event_id INT,
    market_type VARCHAR(255) NOT NULL,
    outcome VARCHAR(255) NOT NULL,
    odds JSON,
    date JSON,
    FOREIGN KEY (event_id) REFERENCES pinnacle_events(event_id) ON DELETE CASCADE,
    UNIQUE KEY unique_hockey_market (event_id, market_type, outcome)
);

CREATE TABLE IF NOT EXISTS pinnacle_mma (
    id INT AUTO_INCREMENT PRIMARY KEY,
    event_id INT,
    market_type VARCHAR(255) NOT NULL,
    outcome VARCHAR(255) NOT NULL,
    odds JSON,
    date JSON,
    FOREIGN KEY (event_id) REFERENCES pinnacle_events(event_id) ON DELETE CASCADE,
    UNIQUE KEY unique_mma_market (event_id, market_type, outcome)
);

CREATE TABLE IF NOT EXISTS pinnacle_boxing (
    id INT AUTO_INCREMENT PRIMARY KEY,
    event_id INT,
    market_type VARCHAR(255) NOT NULL,
    outcome VARCHAR(255) NOT NULL,
    odds JSON,
    date JSON,
    FOREIGN KEY (event_id) REFERENCES pinnacle_events(event_id) ON DELETE CASCADE,
    UNIQUE KEY unique_boxing_market (event_id, market_type, outcome)
);
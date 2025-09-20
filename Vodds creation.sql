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
    event_created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
    event_last_updated_date DATETIME,
    FOREIGN KEY (event_league_id) REFERENCES pinnacle_leagues(league_id)
);

CREATE TABLE IF NOT EXISTS pinnacle_soccer (
    id INT AUTO_INCREMENT PRIMARY KEY,
    event_id INT,
    market_type VARCHAR(255) NOT NULL,
    outcome VARCHAR(255) NOT NULL,
    min_odds JSON,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (event_id) REFERENCES pinnacle_events(event_id)
);

CREATE TABLE IF NOT EXISTS pinnacle_baseball (
    id INT AUTO_INCREMENT PRIMARY KEY,
    event_id INT,
    market_type VARCHAR(255) NOT NULL,
    outcome VARCHAR(255) NOT NULL,
    min_odds JSON,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (event_id) REFERENCES pinnacle_events(event_id)
);

CREATE TABLE IF NOT EXISTS pinnacle_basketball (
    id INT AUTO_INCREMENT PRIMARY KEY,
    event_id INT,
    market_type VARCHAR(255) NOT NULL,
    outcome VARCHAR(255) NOT NULL,
    min_odds JSON,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (event_id) REFERENCES pinnacle_events(event_id)
);
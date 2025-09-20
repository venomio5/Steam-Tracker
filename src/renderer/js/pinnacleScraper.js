const puppeteer = require('puppeteer');
const mysql = require('mysql2/promise');

// Sport configuration
const SPORT_CFG = {
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
        "table": "pinnacle_soccer",
    },
    "Baseball": {
        "markets": [
            "Money Line – Game", "Handicap – Game",
            "Total – Game", "Team Total – Game",
        ],
        "table": "pinnacle_baseball",
    },
    "Basketball": {
        "markets": [
            "Money Line – Game", "Handicap – Game",
            "Total – Game", "Team Total – Game",
        ],
        "table": "pinnacle_basketball",
    },
};

const THREADS = 3;
const HEADLESS = false;

class PinnacleScraper {
    constructor() {
        this.dbConnection = null;
        this.isScraping = false;
        this.browser = null;
    }

    async init() {
        console.log('🔄 Initializing PinnacleScraper...');
        try {
            // Initialize database connection
            console.log('🔗 Connecting to database...');
            this.dbConnection = await mysql.createConnection({
                host: 'localhost',
                user: 'root',
                password: 'venomio',
                database: 'vodds'
            });
            console.log('✅ Database connected successfully');

            // Initialize browser
            console.log('🌐 Launching browser...');
            this.browser = await puppeteer.launch({
                headless: HEADLESS,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-web-security',
                    '--disable-features=IsolateOrigins,site-per-process',
                    '--window-size=1200,800'
                ]
            });
            console.log('✅ Browser launched successfully');

            return true;
        } catch (error) {
            console.error('❌ Initialization error:', error);
            return false;
        }
    }

    async scrapeLeague(leagueUrl, leagueId, leagueSport) {
        const page = await this.browser.newPage();
        
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
        await page.setViewport({ width: 1200, height: 800 });
        
        try {
            console.log(`🌐 Navigating to league URL: ${leagueUrl}`);
            await page.goto(leagueUrl, { 
                waitUntil: 'networkidle2', 
                timeout: 60000 
            });

            // Wait for content container
            try {
                console.log('⏳ Waiting for content container...');
                await page.waitForSelector('div.contentBlock.square', { timeout: 20000 });
            } catch (error) {
                console.log(`⚠️ League ${leagueId} offline`);
                await page.close();
                return 0;
            }

            const scrapedMatches = await page.evaluate(() => {
                const matches = [];
                const container = document.querySelector('div.contentBlock.square');
                if (!container) return matches;

                const divisions = container.querySelectorAll('div');
                let currentDateRaw = null;

                for (const div of divisions) {
                    const cls = div.className || '';
                    
                    // Handle date bars
                    if (cls.includes('dateBar')) {
                        currentDateRaw = div.textContent.trim();
                        continue;
                    }

                    // Find anchor element
                    const link = div.querySelector('a[href]');
                    if (!link) continue;

                    // Extract time
                    const timeEl = link.querySelector('div[class*="matchupDate"]');
                    if (!timeEl) continue;
                    const timeRaw = timeEl.textContent.trim();

                    // Extract team names
                    const teamEls = link.querySelectorAll('div[class*="ellipsis"][class*="gameInfoLabel"]');
                    if (teamEls.length < 2) continue;

                    const teams = Array.from(teamEls).map(el => 
                        el.textContent.replace('(Match)', '').trim()
                    ).join(' vs ');

                    matches.push({
                        teams: teams,
                        url: link.href,
                        time: timeRaw,
                        date: currentDateRaw
                    });
                }
                return matches;
            });

            console.log(`📊 Found ${scrapedMatches.length} matches`);

            if (scrapedMatches.length === 0) {
                console.log(`⚠️ League ${leagueId} offline (empty list)`);
                await page.close();
                return 0;
            }

            // Insert matches into database
            console.log(`💾 Saving ${scrapedMatches.length} matches to database...`);
            const query = `
                INSERT INTO pinnacle_events (event_name, event_url, event_date, event_league_id, event_created_date)
                VALUES (?, ?, ?, ?, NOW())
                ON DUPLICATE KEY UPDATE
                    event_url = VALUES(event_url),
                    event_date = VALUES(event_date)
            `;

            for (const match of scrapedMatches) {
                const eventDate = this.convertDatetime(match.date, match.time);
                if (eventDate) {
                    await this.dbConnection.execute(query, [
                        match.teams,
                        match.url,
                        eventDate,
                        leagueId
                    ]);
                }
            }

            console.log('✅ Matches saved to database');
            await page.close();
            return scrapedMatches.length;

        } catch (error) {
            console.error('❌ Error scraping league:', error);
            await page.close();
            return 0;
        }
    }

    async run() {
        if (this.isScraping) {
            console.log('⚠️ Scraping already in progress');
            throw new Error('Scraping already in progress');
        }
        
        console.log('🚀 Starting scraping process...');
        this.isScraping = true;
        
        try {
            // Delete old matches first
            console.log('🗑️ Deleting old matches...');
            await this.deleteOldMatches();
            
            // Get all leagues from database
            console.log('📋 Fetching leagues from database...');
            const [leagues] = await this.dbConnection.execute(
                "SELECT * FROM pinnacle_leagues"
            );
            
            console.log(`📊 Found ${leagues.length} leagues in database`);
            
            const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
            
            // Scrape leagues in sequence
            for (const league of leagues) {
                const lastUpdated = new Date(league.league_last_updated_date);
                
                if (!league.league_last_updated_date || lastUpdated < oneDayAgo) {
                    console.log(`🔄 Scraping league: ${league.league_name}`);
                    const matchCount = await this.scrapeLeague(
                        league.league_url, 
                        league.league_id, 
                        league.league_sport
                    );
                    
                    // Update league's last updated date
                    console.log(`🔄 Updating league last updated date: ${league.league_name}`);
                    await this.dbConnection.execute(
                        "UPDATE pinnacle_leagues SET league_last_updated_date = NOW() WHERE league_id = ?",
                        [league.league_id]
                    );
                    
                    console.log(`✅ Found ${matchCount} matches in ${league.league_name}`);
                } else {
                    console.log(`⏩ Skipping league (recently updated): ${league.league_name}`);
                }
            }
            
            // Now scrape all events
            console.log('🔄 Refreshing events...');
            await this.refreshEvents();
            
            console.log('✅ Scraping completed successfully');
            this.isScraping = false;
            return { success: true, message: 'Scraping completed successfully' };
            
        } catch (error) {
            console.error('❌ Error in full scrape:', error);
            this.isScraping = false;
            return { success: false, message: error.message };
        }
    }

    async refreshEvents() {
        console.log('🔄 Refreshing events...');
        const [events] = await this.dbConnection.execute(`
            SELECT e.event_id, e.event_name, e.event_url, e.event_date, 
                   e.event_last_updated_date, e.event_league_id, l.league_sport
            FROM pinnacle_events AS e
            JOIN pinnacle_leagues AS l ON e.event_league_id = l.league_id
        `);
        
        console.log(`📊 Found ${events.length} events in database`);
        
        const now = new Date();
        
        // Process events based on their start time
        for (const event of events) {
            const eventDate = new Date(event.event_date);
            const timeUntilEvent = eventDate - now;
            
            let updateInterval;
            if (timeUntilEvent <= 2 * 60 * 60 * 1000) { // 2 hours
                updateInterval = 2 * 60 * 1000; // 2 minutes
            } else if (timeUntilEvent <= 4 * 60 * 60 * 1000) { // 4 hours
                updateInterval = 5 * 60 * 1000; // 5 minutes
            } else if (timeUntilEvent <= 8 * 60 * 60 * 1000) { // 8 hours
                updateInterval = 3 * 60 * 60 * 1000; // 3 hours
            } else if (timeUntilEvent <= 24 * 60 * 60 * 1000) { // 24 hours
                updateInterval = 8 * 60 * 60 * 1000; // 8 hours
            } else {
                updateInterval = 72 * 60 * 60 * 1000; // 72 hours
            }
            
            const threshold = new Date(now - updateInterval);
            const lastUpdated = new Date(event.event_last_updated_date || 0);
            
            if (!event.event_last_updated_date || lastUpdated < threshold) {
                const sportCfg = SPORT_CFG[event.league_sport];
                if (sportCfg) {
                    console.log(`🔄 Scraping event: ${event.event_name}`);
                    const marketCount = await this.scrapeEvent(
                        event.event_url, 
                        event.event_id, 
                        sportCfg
                    );
                    
                    // Update event's last updated date
                    console.log(`🔄 Updating event last updated date: ${event.event_name}`);
                    await this.dbConnection.execute(
                        "UPDATE pinnacle_events SET event_last_updated_date = NOW() WHERE event_id = ?",
                        [event.event_id]
                    );
                    
                    console.log(`✅ Found ${marketCount} markets for ${event.event_name}`);
                } else {
                    console.log(`⚠️ No configuration found for sport: ${event.league_sport}`);
                }
            } else {
                console.log(`⏩ Skipping event (recently updated): ${event.event_name}`);
            }
        }
    }

    async scrapeEvent(eventUrl, eventId, sportCfg) {
        console.log(`🔍 Scraping event: ${eventUrl}`);
        const page = await this.browser.newPage();
        
        // Set user agent and viewport to mimic a real user
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
        await page.setViewport({ width: 1280, height: 800 });
        
        try {
            console.log(`🌐 Navigating to event URL: ${eventUrl}`);
            await page.goto(eventUrl, { 
                waitUntil: 'networkidle2', 
                timeout: 30000 
            });
            
            // Click the "Show All" button if it exists
            try {
                console.log('🔍 Looking for "Show All" button...');
                await page.waitForSelector('button.showAllButton', { timeout: 5000 });
                console.log('🖱️ Clicking "Show All" button...');
                await page.click('button.showAllButton');
                await page.waitForTimeout(1000);
                console.log('✅ "Show All" button clicked');
            } catch (error) {
                console.log('⚠️ "Show All" button not found, continuing without it');
            }
            
            // Wait for market groups to load
            console.log('⏳ Waiting for market groups to load...');
            await page.waitForSelector('[class*="marketGroup"]', { timeout: 10000 });
            console.log('✅ Market groups loaded');
            
            const marketGroups = await page.$$('[class*="marketGroup"]');
            console.log(`📊 Found ${marketGroups.length} market groups`);
            
            const upserts = [];
            
            for (const group of marketGroups) {
                let title = '';
                
                try {
                    const titleElement = await group.$('[class^="titleText"]') || await group.$('[class^="title"]');
                    if (titleElement) {
                        title = await titleElement.evaluate(el => el.textContent.trim());
                        console.log(`📝 Processing market: ${title}`);
                    }
                } catch (error) {
                    console.log('⚠️ Could not get market title, skipping');
                    continue;
                }
                
                if (!title || !sportCfg.markets.includes(title)) {
                    console.log(`⏩ Skipping market (not in configured markets): ${title}`);
                    continue;
                }
                
                // Try to expand the market group if there's a toggle button
                try {
                    const toggleButton = await group.$('button[class^="toggleMarkets"]');
                    if (toggleButton) {
                        console.log('🖱️ Clicking toggle button...');
                        await toggleButton.click();
                        await page.waitForTimeout(500);
                        console.log('✅ Toggle button clicked');
                    }
                } catch (error) {
                    console.log('⚠️ Could not toggle market group, continuing');
                }
                
                // Extract market data
                console.log(`🔍 Extracting market data for: ${title}`);
                const marketButtons = await group.$$('button.market-btn');
                console.log(`📊 Found ${marketButtons.length} market buttons`);
                
                const labels = [];
                const prices = [];
                
                for (const button of marketButtons) {
                    try {
                        const labelElement = await button.$('.label-GT4CkXEOFj');
                        const priceElement = await button.$('.price-r5BU0ynJha');
                        
                        if (labelElement && priceElement) {
                            const labelText = await labelElement.evaluate(el => el.textContent.trim());
                            const priceText = await priceElement.evaluate(el => el.textContent.trim());
                            
                            // Apply prefixes based on market type
                            let finalLabel = labelText;
                            
                            if (title.toLowerCase().includes('team') && 
                                !title.toLowerCase().includes('both teams to score')) {
                                finalLabel = (labels.length % 2 === 0 ? 'Home ' : 'Away ') + labelText;
                            } else if (title.toLowerCase().includes('handicap')) {
                                finalLabel = (labels.length % 2 === 0 ? 'Home ' : 'Away ') + labelText;
                            }
                            
                            labels.push(finalLabel);
                            prices.push(parseFloat(priceText));
                            
                            console.log(`📝 Found outcome: ${finalLabel} @ ${priceText}`);
                        }
                    } catch (error) {
                        console.log('❌ Error processing market button:', error);
                    }
                }
                
                // Store raw odds without probability calculation
                if (labels.length > 0 && prices.length > 0) {
                    console.log(`💾 Preparing to save ${labels.length} outcomes for market: ${title}`);
                    for (let i = 0; i < labels.length; i++) {
                        upserts.push([eventId, title, labels[i], JSON.stringify([prices[i]])]);
                    }
                } else {
                    console.log(`⚠️ No valid outcomes found for market: ${title}`);
                }
            }
            
            // Insert data into the appropriate table
            if (upserts.length > 0) {
                console.log(`💾 Saving ${upserts.length} outcomes to database...`);
                const query = `
                    INSERT INTO ${sportCfg.table} (event_id, market_type, outcome, min_odds)
                    VALUES (?, ?, ?, ?)
                    ON DUPLICATE KEY UPDATE
                        min_odds = JSON_ARRAY_APPEND(min_odds, '$', JSON_EXTRACT(VALUES(min_odds), '$[0]'))
                `;
                
                for (const data of upserts) {
                    await this.dbConnection.execute(query, data);
                }
                console.log('✅ Outcomes saved to database');
            } else {
                console.log('⚠️ No outcomes to save');
            }
            
            await page.close();
            return upserts.length;
            
        } catch (error) {
            console.error('❌ Error scraping event:', error);
            await page.close();
            return 0;
        }
    }

    convertDatetime(dateStr, timeStr) {
        if (!dateStr || !timeStr) {
            console.log('⚠️ Invalid date or time string');
            return null;
        }
        
        console.log(`📅 Converting datetime: ${dateStr} ${timeStr}`);
        const dateUpper = dateStr.toUpperCase().trim();
        let dateObj;
        
        if (dateUpper.includes('TODAY')) {
            dateObj = new Date();
            console.log('📅 Using today\'s date');
        } else if (dateUpper.includes('TOMORROW')) {
            dateObj = new Date();
            dateObj.setDate(dateObj.getDate() + 1);
            console.log('📅 Using tomorrow\'s date');
        } else if (dateUpper.includes(',')) {
            // Handle formats like "TUE MAY 06, 2025" or "MAY 06, 2025"
            const parts = dateUpper.split(',');
            const year = parseInt(parts[1].trim());
            
            let monthDay = parts[0].trim();
            const monthDayParts = monthDay.split(' ');
            
            // Remove weekday if present
            if (monthDayParts.length === 3) {
                monthDayParts.shift();
            }
            
            const monthStr = monthDayParts[0];
            const day = parseInt(monthDayParts[1]);
            
            const months = {
                'JAN': 0, 'FEB': 1, 'MAR': 2, 'APR': 3, 'MAY': 4, 'JUN': 5,
                'JUL': 6, 'AUG': 7, 'SEP': 8, 'OCT': 9, 'NOV': 10, 'DEC': 11
            };
            
            const month = months[monthStr];
            dateObj = new Date(year, month, day);
            console.log(`📅 Parsed date: ${year}-${month + 1}-${day}`);
        } else {
            console.log('⚠️ Unknown date format');
            return null;
        }
        
        // Parse time
        const timeParts = timeStr.trim().split(':');
        const hours = parseInt(timeParts[0]);
        const minutes = parseInt(timeParts[1]);
        
        dateObj.setHours(hours, minutes, 0, 0);
        const result = dateObj.toISOString().slice(0, 19).replace('T', ' ');
        console.log(`🕒 Final datetime: ${result}`);
        
        return result;
    }

    async deleteOldMatches() {
        try {
            console.log('🗑️ Deleting old matches...');
            await this.dbConnection.execute(
                "DELETE FROM pinnacle_events WHERE event_date < NOW()"
            );
            console.log('✅ Old matches deleted');
            return true;
        } catch (error) {
            console.error('❌ Error deleting old matches:', error);
            return false;
        }
    }

    async close() {
        console.log('🔚 Closing scraper...');
        if (this.dbConnection) {
            await this.dbConnection.end();
            console.log('✅ Database connection closed');
        }
        if (this.browser) {
            await this.browser.close();
            console.log('✅ Browser closed');
        }
    }
}

module.exports = PinnacleScraper;
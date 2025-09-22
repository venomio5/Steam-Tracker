const puppeteer = require('puppeteer');
const mysql = require('mysql2/promise');

const HEADLESS = 'true';

class PinnacleScraper {
    constructor() {
        this.dbConnection = null;
        this.isScraping = false;
        this.browser = null;
    }

    async init() {
        console.log('🚀 Initializing PinnacleScraper...');
        try {
            this.dbConnection = await mysql.createConnection({
                host: 'localhost',
                user: 'root',
                password: 'venomio',
                database: 'vodds'
            });

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

            return true;
        } catch (error) {
            console.error('❌ Initialization error:', error);
            return false;
        }
    }

    async scrapeLeague(leagueUrl, leagueId) {
        const page = await this.browser.newPage();
        
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
        await page.setViewport({ width: 1200, height: 800 });
        
        try {
            await page.goto(leagueUrl, { 
                waitUntil: 'networkidle2', 
                timeout: 60000 
            });

            try {
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
                    
                    if (cls.includes('dateBar')) {
                        currentDateRaw = div.textContent.trim();
                        continue;
                    }

                    const link = div.querySelector('a[href]');
                    if (!link) continue;

                    const timeEl = link.querySelector('div[class*="matchupDate"]');
                    if (!timeEl) continue;
                    const timeRaw = timeEl.textContent.trim();

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

            if (scrapedMatches.length === 0) {
                console.log(`⚠️ League ${leagueId} offline (empty list)`);
                await page.close();
                return 0;
            }

            const query = `
                INSERT INTO pinnacle_events (event_name, event_url, event_date, event_league_id, event_last_updated_date)
                VALUES (?, ?, ?, ?, NOW())
                ON DUPLICATE KEY UPDATE
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
            throw new Error('Scraping already in progress');
        }
        
        this.isScraping = true;
        
        try {
            await this.deleteOldMatches();
            
            const [leagues] = await this.dbConnection.execute(
                "SELECT * FROM pinnacle_leagues"
            );
            
            const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
            
            for (const league of leagues) {
                const lastUpdated = new Date(league.league_last_updated_date);
                
                if (!league.league_last_updated_date || lastUpdated < oneDayAgo) {
                    console.log(`🔄 Scraping league: ${league.league_name}`);
                    this.scrapeLeague(
                        league.league_url, 
                        league.league_id
                    );
                    
                    await this.dbConnection.execute(
                        "UPDATE pinnacle_leagues SET league_last_updated_date = NOW() WHERE league_id = ?",
                        [league.league_id]
                    );
                    
                } else {
                    console.log(`⏩ Skipping league (recently updated): ${league.league_name}`);
                }
            }
            
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
        
        const now = new Date();
        
        for (const event of events) {
            const eventDate = new Date(event.event_date);
            const timeUntilEvent = eventDate - now;
            
            let updateInterval;
            if (timeUntilEvent <= 60 * 60 * 1000) { // 1 hour
                updateInterval = 1 * 60 * 1000; // 1 minute
            } else if (timeUntilEvent <= 2 * 60 * 60 * 1000) { // 2 hours
                updateInterval = 3 * 60 * 1000; // 3 minutes
            } else if (timeUntilEvent <= 4 * 60 * 60 * 1000) { // 4 hours
                updateInterval = 7 * 60 * 1000; // 7 minutes
            } else if (timeUntilEvent <= 8 * 60 * 60 * 1000) { // 8 hours
                updateInterval = 15 * 60 * 1000; // 15 minutes
            } else if (timeUntilEvent <= 20 * 60 * 60 * 1000) { // 20 hours
                updateInterval = 30 * 60 * 1000; // 30 minutes
            } else if (timeUntilEvent <= 48 * 60 * 60 * 1000) { // 48 hours
                updateInterval = 60 * 60 * 1000; // 1 hour
            } else if (timeUntilEvent <= 7 * 24 * 60 * 60 * 1000) { // 7 days
                updateInterval = 3 * 60 * 60 * 1000; // 3 hours
            } else {
                updateInterval = 24 * 60 * 60 * 1000; // 24 hours
            }
            
            const threshold = new Date(now - updateInterval);
            const lastUpdated = new Date(event.event_last_updated_date || 0);
            
            if (!event.event_last_updated_date || lastUpdated < threshold) {
                console.log(`🔄 Scraping event: ${event.event_name}`);
                this.scrapeEvent(
                    event.event_url, 
                    event.event_id,
                    event.league_sport
                );
                
                await this.dbConnection.execute(
                    "UPDATE pinnacle_events SET event_last_updated_date = NOW() WHERE event_id = ?",
                    [event.event_id]
                );
                
            } else {
                console.log(`⏩ Skipping event (recently updated): ${event.event_name}`);
            }
        }
    }

    async scrapeEvent(eventUrl, eventId, eventSport) {
        const page = await this.browser.newPage();
        
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
        await page.setViewport({ width: 1280, height: 800 });
        
        try {
            await page.goto(eventUrl, { 
                waitUntil: 'networkidle2', 
                timeout: 30000 
            });
            
            try {
                await page.waitForSelector('button[class*="showAllButton"]', { timeout: 5000 });
                await page.click('button[class*="showAllButton"]');
            } catch (error) {
                console.log('⚠️ "Show All" button not found, continuing without it');
            }
            
            await page.waitForSelector('[class*="marketGroup"]', { timeout: 10000 });
            
            const marketGroupContainers = await page.$$('[data-test-id^="Event.Row"]');
            
            const upserts = [];
            
            for (const container of marketGroupContainers) {
                let title = '';
                
                try {
                    const titleElement = await container.$('[class*="titleText"], [class*="title"]');
                    if (titleElement) {
                        title = await titleElement.evaluate(el => el.textContent.trim());
                    }
                } catch (error) {
                    console.log('⚠️ Could not get market title, skipping');
                    continue;
                }

                const contentArea = await container.$('.content-fxVWLSFCRI');
                let marketButtons = [];

                if (contentArea) {
                    try {
                        const toggleButton = await contentArea.$('button[class^="toggleMarkets"]');
                        if (toggleButton) {
                            await toggleButton.click();
                            await page.waitForTimeout(500);
                        }
                    } catch (error) {
                        console.log('⚠️ Could not toggle market group, continuing');
                    }


                    marketButtons = await contentArea.$$('button[class*="market-btn"]');
                }
                
                const labels = [];
                const prices = [];
          
                for (let i = 0; i < marketButtons.length; i++) {
                    const button = marketButtons[i];
                    try {
                        const labelElement = await button.$('.label-GT4CkXEOFj');
                        const priceElement = await button.$('.price-r5BU0ynJha');
                        
                        if (labelElement && priceElement) {
                            const labelText = await labelElement.evaluate(el => el.textContent.trim());
                            const priceText = await priceElement.evaluate(el => el.textContent.trim());
                            
                            let finalLabel = labelText;
                            const titleLower = title.toLowerCase();
                            
                            const excludedTeamMarkets = [
                                'both teams to score',
                                'first team to score',
                                'either team to score',
                                'team to score first',
                                'team to score last',
                                'any team to score'
                            ];
                            
                            const shouldExclude = excludedTeamMarkets.some(excluded => 
                                titleLower.includes(excluded)
                            );
                            
                            if (titleLower.includes('team total')) {
                                // For team totals, first two are home, next two are away
                                if (i < 2) {
                                    finalLabel = 'Home ' + labelText;
                                } else {
                                    finalLabel = 'Away ' + labelText;
                                }
                            }
                            else if ((titleLower.includes('team') && !shouldExclude) || titleLower.includes('handicap')) {
                                // Use simple index-based approach instead of parentElement
                                finalLabel = (i % 2 === 0 ? 'Home ' : 'Away ') + labelText;
                            }
                            
                            labels.push(finalLabel);
                            prices.push(parseFloat(priceText));
                            
                        }
                    } catch (error) {
                        console.log('❌ Error processing market button:', error);
                    }
                }

                // Store raw odds without probability calculation
                if (labels.length > 0 && prices.length > 0) {
                    for (let i = 0; i < labels.length; i++) {
                        upserts.push([eventId, title, labels[i], JSON.stringify([prices[i]])]);
                    }
                } else {
                    console.log(`⚠️ No valid outcomes found for market: ${title}`);
                }
            }
            
            // Insert data into the appropriate table
            if (upserts.length > 0) {
                const query = `
                    INSERT INTO pinnacle_${eventSport.toLowerCase()} (event_id, market_type, outcome, odds, date)
                    VALUES (?, ?, ?, ?, JSON_ARRAY(NOW()))
                    ON DUPLICATE KEY UPDATE
                        odds = JSON_ARRAY_APPEND(odds, '$', JSON_EXTRACT(VALUES(odds), '$[0]')),
                        date = JSON_ARRAY_APPEND(date, '$', NOW())
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
        // Parse date
        if (!dateStr || !timeStr) {
            console.log('⚠️ Invalid date or time string');
            return null;
        }
        
        const dateUpper = dateStr.toUpperCase().trim();
        let dateObj;
        
        if (dateUpper.includes('TODAY')) {
            dateObj = new Date();
        } else if (dateUpper.includes('TOMORROW')) {
            dateObj = new Date();
            dateObj.setDate(dateObj.getDate() + 1);
        } else if (dateUpper.includes(',')) {   
            const parts = dateUpper.split(',');
            const year = parseInt(parts[parts.length - 1].trim());
            const dateParts = parts[1].trim().split(" ");
                       
            const monthStr = dateParts[0];
            const day = parseInt(dateParts[1]);
            
            const months = {
                'JAN': 0, 'FEB': 1, 'MAR': 2, 'APR': 3, 'MAY': 4, 'JUN': 5,
                'JUL': 6, 'AUG': 7, 'SEP': 8, 'OCT': 9, 'NOV': 10, 'DEC': 11
            };
            
            const month = months[monthStr];
            dateObj = new Date(year, month, day);
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
        
        return result;
    }

    async deleteOldMatches() {
        try {
            await this.dbConnection.execute(
                "DELETE FROM pinnacle_events WHERE event_date < NOW() - INTERVAL 7 DAY"
            );
            console.log('✅ Old matches deleted (older than 7 days)');
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
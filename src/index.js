const { app, BrowserWindow, Menu, ipcMain } = require('electron');
const path = require('path');
const mysql = require('mysql2/promise');
const PinnacleScraper = require('./renderer/js/pinnacleScraper');

let mainWindow;
let scraper;
let dbConnection;

async function createDatabaseConnection() {
  try {
    dbConnection = await mysql.createConnection({
      host: 'localhost',
      user: 'root',
      password: 'venomio',
      database: 'vodds'
    });
    console.log('Database connected successfully');
  } catch (error) {
    console.error('Database connection error:', error);
  }
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    icon: path.join(__dirname, 'src/renderer/assets/Logo.ico'),
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      enableRemoteModule: true
    }
  });

  mainWindow.loadFile('index.html');

  mainWindow.webContents.openDevTools()

  Menu.setApplicationMenu(null);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  await createDatabaseConnection();
  createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// IPC handlers for data requests
ipcMain.handle('get-leagues', async () => {
  try {
    const [rows] = await dbConnection.execute('SELECT * FROM pinnacle_leagues');
    return rows;
  } catch (error) {
    console.error('Error getting leagues:', error);
    return [];
  }
});

ipcMain.handle('get-games', async (event, filters) => {
  try {
    let query = `
      SELECT e.*, l.league_name, l.league_sport 
      FROM pinnacle_events e 
      JOIN pinnacle_leagues l ON e.event_league_id = l.league_id 
      WHERE e.event_date > NOW() 
    `;

    let params = [];

    if (filters) {
      if (filters.sport && filters.sport !== 'all') {
        query += ` AND l.league_sport = ?`;
        params.push(filters.sport);
      }

      if (filters.league && filters.league !== 'all') {
        query += ` AND l.league_id = ?`;
        params.push(filters.league);
      }

      if (filters.search) {
        query += ` AND e.event_name LIKE ?`;
        params.push(`%${filters.search}%`);
      }
    }

    query += ` ORDER BY e.event_date ASC`;

    const [rows] = await dbConnection.execute(query, params);
    return rows;
  } catch (error) {
    console.error('Error getting games:', error);
    return [];
  }
});

ipcMain.handle('get-steam-data', async (event, timePeriod) => {
  try {
    // This is a simplified example. You would adjust the query based on the timePeriod.
    const [gainers] = await dbConnection.execute(`
      SELECT 
        e.event_id, e.event_name, m.market_type, m.outcome, m.odds,
        (
          SELECT JSON_EXTRACT(m2.odds, CONCAT('$[', JSON_LENGTH(m2.odds)-1, ']')) 
          FROM pinnacle_soccer m2 
          WHERE m2.id = m.id
        ) as current_odd,
        (
          SELECT JSON_EXTRACT(m2.odds, CONCAT('$[', JSON_LENGTH(m2.odds)-2, ']')) 
          FROM pinnacle_soccer m2 
          WHERE m2.id = m.id AND JSON_LENGTH(m2.odds) > 1
        ) as previous_odd
      FROM pinnacle_soccer m
      JOIN pinnacle_events e ON m.event_id = e.event_id
      WHERE e.event_date > NOW() AND JSON_LENGTH(m.odds) > 1
      HAVING previous_odd IS NOT NULL AND current_odd IS NOT NULL
      ORDER BY (current_odd - previous_odd) / previous_odd DESC
      LIMIT 5
    `);

    const [losers] = await dbConnection.execute(`
      SELECT 
        e.event_id, e.event_name, m.market_type, m.outcome, m.odds,
        (
          SELECT JSON_EXTRACT(m2.odds, CONCAT('$[', JSON_LENGTH(m2.odds)-1, ']')) 
          FROM pinnacle_soccer m2 
          WHERE m2.id = m.id
        ) as current_odd,
        (
          SELECT JSON_EXTRACT(m2.odds, CONcat('$[', JSON_LENGTH(m2.odds)-2, ']')) 
          FROM pinnacle_soccer m2 
          WHERE m2.id = m.id AND JSON_LENGTH(m2.odds) > 1
        ) as previous_odd
      FROM pinnacle_soccer m
      JOIN pinnacle_events e ON m.event_id = e.event_id
      WHERE e.event_date > NOW() AND JSON_LENGTH(m.odds) > 1
      HAVING previous_odd IS NOT NULL AND current_odd IS NOT NULL
      ORDER BY (current_odd - previous_odd) / previous_odd ASC
      LIMIT 5
    `);

    return { gainers, losers };
  } catch (error) {
    console.error('Error getting steam data:', error);
    return { gainers: [], losers: [] };
  }
});

ipcMain.handle('get-markets', async (event, { eventId, tableName }) => {
  try {
    const [rows] = await dbConnection.execute(
      `SELECT * FROM ${tableName} WHERE event_id = ? ORDER BY market_type, outcome`,
      [eventId]
    );
    return rows;
  } catch (error) {
    console.error('Error getting markets:', error);
    return [];
  }
});

// Scraper control
ipcMain.handle('start-scraper', async () => {
  try {
    scraper = new PinnacleScraper();
    const initialized = await scraper.init();

    if (initialized) {
      // Run scraper immediately and then every minute
      await scraper.run();
      setInterval(async () => {
        try {
          await scraper.run();
          mainWindow.webContents.send('data-updated');
        } catch (error) {
          console.error('Background scraping error:', error);
        }
      }, 60000); // Run every minute

      return { success: true, message: 'Scraper started successfully' };
    } else {
      return { success: false, message: 'Failed to initialize scraper' };
    }
  } catch (error) {
    console.error('Error starting scraper:', error);
    return { success: false, message: error.message };
  }
});

ipcMain.handle('run-scraper', async () => {
  try {
    if (!scraper) {
      return { success: false, message: 'Scraper not initialized' };
    }

    const result = await scraper.run();
    mainWindow.webContents.send('data-updated');
    return result;
  } catch (error) {
    console.error('Error running scraper:', error);
    return { success: false, message: error.message };
  }
});

ipcMain.on('close-scraper', async () => {
  if (scraper) {
    await scraper.close();
  }
});
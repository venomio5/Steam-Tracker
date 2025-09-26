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

ipcMain.handle('get-steam-data', async (event, timePeriodMinutes) => {
  try {
    const sportTables = [
      'pinnacle_soccer', 'pinnacle_baseball', 'pinnacle_basketball',
      'pinnacle_football', 'pinnacle_hockey', 'pinnacle_mma', 'pinnacle_boxing'
    ];

    let allResults = [];

    // Calcular el timestamp objetivo (hace X minutos)
    const targetTime = new Date(Date.now() - (parseInt(timePeriodMinutes) * 60 * 1000));
    
    for (const table of sportTables) {
      try {
        // Primero obtenemos todos los datos con sus timestamps
        const [results] = await dbConnection.execute(`
          SELECT 
            e.event_id, 
            e.event_name, 
            m.market_type, 
            m.outcome,
            m.odds as odds_array,
            m.date as dates_array
          FROM ${table} m
          JOIN pinnacle_events e ON m.event_id = e.event_id
          WHERE e.event_date > NOW() 
            AND JSON_LENGTH(m.odds) > 1
        `);

        results.forEach(row => {
          try {
            // Intentar diferentes formas de obtener los arrays
            let oddsArray, datesArray;
            
            // Caso 1: Los datos ya son arrays (no necesitan parse)
            if (Array.isArray(row.odds_array)) {
              oddsArray = row.odds_array;
              datesArray = row.dates_array;
            }
            // Caso 2: Los datos son strings JSON
            else if (typeof row.odds_array === 'string') {
              try {
                oddsArray = JSON.parse(row.odds_array);
                datesArray = JSON.parse(row.dates_array);
              } catch (parseError) {
                console.error('Error parsing JSON:', parseError);
                return;
              }
            }
            // Caso 3: No podemos determinar el formato
            else {
              console.error('Unknown data format for odds/dates');
              return;
            }
            
            if (!oddsArray || !datesArray || !oddsArray.length || !datesArray.length || oddsArray.length !== datesArray.length) {
              return;
            }

            // Obtener el odd actual (el último)
            const currentOddValue = oddsArray[oddsArray.length - 1];
            const currentOdd = typeof currentOddValue === 'number' ? currentOddValue : parseFloat(currentOddValue);
            
            // Buscar el odd más cercano al timeframe solicitado
            let closestOdd = null;
            let closestTimeDiff = Infinity;
            
            for (let i = 0; i < datesArray.length; i++) {
              try {
                const timestamp = new Date(datesArray[i]);
                const timeDiff = Math.abs(timestamp - targetTime);
                
                if (timeDiff < closestTimeDiff) {
                  closestTimeDiff = timeDiff;
                  const oddValue = oddsArray[i];
                  closestOdd = typeof oddValue === 'number' ? oddValue : parseFloat(oddValue);
                }
              } catch (dateError) {
                console.error('Error processing date:', datesArray[i]);
                continue;
              }
            }
            
            if (closestOdd !== null && !isNaN(currentOdd) && !isNaN(closestOdd) && closestOdd > 0) {
              // CORRECCIÓN: Invertimos el cálculo para que un odd que baja sea positivo
              const change = ((closestOdd - currentOdd) / closestOdd) * 100;
              
              allResults.push({
                event_id: row.event_id,
                event_name: row.event_name,
                market_type: row.market_type,
                outcome: row.outcome,
                current_odd: currentOdd,
                previous_odd: closestOdd,
                change: change,
                timeframe_minutes: timePeriodMinutes
              });
            }
          } catch (error) {
            console.error('Error processing row:', error);
          }
        });
      } catch (error) {
        console.error(`Error querying ${table}:`, error);
      }
    }

    // Ahora los "gainers" son los que han bajado de odd (cambio positivo)
    const gainers = allResults
      .filter(item => item.change > 0)
      .sort((a, b) => b.change - a.change)  // Mayor cambio primero
      .slice(0, 5);
    
    // Los "losers" son los que han subido de odd (cambio negativo)
    const losers = allResults
      .filter(item => item.change < 0)
      .sort((a, b) => a.change - b.change)  // Menor cambio primero (más negativo)
      .slice(0, 5);

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
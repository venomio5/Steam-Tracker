const { ipcRenderer } = require('electron');

let gamesData = [];
let leaguesData = [];
let oddsChart = null;
let allMarkets = [];

// Initialize the application
document.addEventListener('DOMContentLoaded', async function() {
  // Load initial data
  await loadLeagues();
  await loadGames();
  await loadSteamData();

  // Set up event listeners
  setupEventListeners();

  // Start the background scraper
  const result = await ipcRenderer.invoke('start-scraper');
  if (result.success) {
    console.log('Scraper started successfully');
  } else {
    console.error('Failed to start scraper:', result.message);
    showNotification('Failed to start background scraper', 'error');
  }

  // Listen for data update events
  ipcRenderer.on('data-updated', async () => {
    await loadGames();
    await loadSteamData();
    showNotification('Data updated from background scraping', 'success');
  });

  // Set up periodic data refresh
  setInterval(async () => {
    await loadGames();
    await loadSteamData();
  }, 60000); // Refresh every minute
});

// Set up event listeners
function setupEventListeners() {
  // Filter event listeners
  document.getElementById('sportFilter').addEventListener('change', filterGames);
  document.getElementById('leagueFilter').addEventListener('change', filterGames);
  document.getElementById('statusFilter').addEventListener('change', filterGames);
  document.getElementById('searchInput').addEventListener('input', filterGames);
  document.getElementById('timePeriod').addEventListener('change', loadSteamData);

  // Button event listeners
  document.getElementById('refreshButton').addEventListener('click', async () => {
    await loadGames();
    await loadSteamData();
    showNotification('Data refreshed', 'success');
  });

  document.getElementById('settingsButton').addEventListener('click', () => {
    // TODO: Implement settings dialog
    showNotification('Settings feature coming soon', 'warning');
  });

  // Modal close buttons
  document.querySelectorAll('.close').forEach(closeBtn => {
    closeBtn.addEventListener('click', () => {
      document.querySelectorAll('.modal').forEach(modal => {
        modal.style.display = 'none';
      });
    });
  });

  // Close modal when clicking outside
  window.addEventListener('click', (event) => {
    document.querySelectorAll('.modal').forEach(modal => {
      if (event.target === modal) {
        modal.style.display = 'none';
      }
    });
  });
}

// Load leagues for filter
async function loadLeagues() {
  try {
    leaguesData = await ipcRenderer.invoke('get-leagues');

    const leagueFilter = document.getElementById('leagueFilter');
    leagueFilter.innerHTML = '<option value="all">All Leagues</option>';

    leaguesData.forEach(league => {
      const option = document.createElement('option');
      option.value = league.league_id;
      option.textContent = league.league_name;
      leagueFilter.appendChild(option);
    });
  } catch (error) {
    console.error('Error loading leagues:', error);
  }
}

// Load games from database
async function loadGames() {
  try {
    const gamesList = document.getElementById('gamesList');
    gamesList.innerHTML = '<div class="loading">Loading games...</div>';

    const sportFilter = document.getElementById('sportFilter').value;
    const leagueFilter = document.getElementById('leagueFilter').value;
    const searchText = document.getElementById('searchInput').value;

    const filters = {
      sport: sportFilter,
      league: leagueFilter,
      search: searchText
    };

    gamesData = await ipcRenderer.invoke('get-games', filters);
    displayGames(gamesData);
  } catch (error) {
    console.error('Error loading games:', error);
    document.getElementById('gamesList').innerHTML = '<div class="loading">Error loading games</div>';
  }
}

// Display games in the UI
function displayGames(games) {
  const gamesList = document.getElementById('gamesList');

  if (games.length === 0) {
    gamesList.innerHTML = '<div class="loading">No games found</div>';
    return;
  }

  gamesList.innerHTML = '';

  games.forEach(game => {
    const gameCard = document.createElement('div');
    gameCard.className = 'game-card';
    gameCard.dataset.id = game.event_id;

    const gameDate = new Date(game.event_date);
    const formattedDate = gameDate.toLocaleDateString() + ' ' + gameDate.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});

    gameCard.innerHTML = `
      <h3>${game.event_name}</h3>
      <div class="game-meta">
        <span>${game.league_name}</span>
        <span>${formattedDate}</span>
      </div>
    `;

    gameCard.addEventListener('click', () => {
      showGameDetails(game);
    });

    gamesList.appendChild(gameCard);
  });
}

// Filter games based on selected criteria
function filterGames() {
  const sportFilter = document.getElementById('sportFilter').value;
  const leagueFilter = document.getElementById('leagueFilter').value;
  const statusFilter = document.getElementById('statusFilter').value;
  const searchText = document.getElementById('searchInput').value.toLowerCase();

  let filteredGames = gamesData;

  // Apply sport filter
  if (sportFilter !== 'all') {
    filteredGames = filteredGames.filter(game => game.league_sport.toLowerCase() === sportFilter);
  }

  // Apply league filter
  if (leagueFilter !== 'all') {
    filteredGames = filteredGames.filter(game => game.event_league_id == leagueFilter);
  }

  // Apply status filter
  const now = new Date();
  if (statusFilter === 'upcoming') {
    filteredGames = filteredGames.filter(game => new Date(game.event_date) > now);
  } else if (statusFilter === 'live') {
    // For simplicity, we'll consider games happening within 2 hours as live
    filteredGames = filteredGames.filter(game => {
      const gameDate = new Date(game.event_date);
      return gameDate <= now && gameDate >= new Date(now.getTime() - 2 * 60 * 60 * 1000);
    });
  } else if (statusFilter === 'completed') {
    filteredGames = filteredGames.filter(game => new Date(game.event_date) < new Date(now.getTime() - 2 * 60 * 60 * 1000));
  }

  // Apply search filter
  if (searchText) {
    filteredGames = filteredGames.filter(game => 
      game.event_name.toLowerCase().includes(searchText)
    );
  }

  displayGames(filteredGames);
}

// Show game details in modal
async function showGameDetails(game) {
  try {
    const modal = document.getElementById('gameModal');
    const modalTitle = document.getElementById('modalTitle');
    const marketsContainer = document.getElementById('marketsContainer');

    modalTitle.textContent = game.event_name;
    marketsContainer.innerHTML = '<div class="loading">Loading markets...</div>';

    modal.style.display = 'block';

    // Determine which table to query based on sport
    let tableName;
    switch (game.league_sport.toLowerCase()) {
      case 'soccer': tableName = 'pinnacle_soccer'; break;
      case 'basketball': tableName = 'pinnacle_basketball'; break;
      case 'baseball': tableName = 'pinnacle_baseball'; break;
      default: tableName = 'pinnacle_soccer';
    }

    const markets = await ipcRenderer.invoke('get-markets', { eventId: game.event_id, tableName });
    displayMarkets(markets);
  } catch (error) {
    console.error('Error loading game details:', error);
    document.getElementById('marketsContainer').innerHTML = '<div class="loading">Error loading markets</div>';
  }
}

// Initialize search functionality 
function initializeMarketSearch() {
  const marketsContainer = document.getElementById('marketsContainer');
  
  // Create search input if it doesn't exist
  let searchInput = document.getElementById('marketSearch');
  if (!searchInput) {
    const searchContainer = document.createElement('div');
    searchContainer.className = 'search-container';
    searchContainer.innerHTML = `
      <input type="text" id="marketSearch" placeholder="Search markets..." class="search-input">
    `;
    
    // Insert search before markets container
    marketsContainer.parentNode.insertBefore(searchContainer, marketsContainer);
    
    searchInput = document.getElementById('marketSearch');
    
    // Add event listener for search input
    searchInput.addEventListener('input', function() {
      // Re-display markets with filtered results
      displayMarkets(allMarkets);
    });
  }
}

// Display markets in the modal
function displayMarkets(markets) {
  allMarkets = markets;
  const marketsContainer = document.getElementById('marketsContainer');
  const searchInput = document.getElementById('marketSearch');

  const searchTerm = searchInput ? searchInput.value.toLowerCase().trim() : '';

  const filteredMarkets = searchTerm ? 
    markets.filter(market => 
      market.market_type.toLowerCase().includes(searchTerm) ||
      market.outcome.toLowerCase().includes(searchTerm) ||
      (market.description && market.description.toLowerCase().includes(searchTerm))
    ) : 
    markets;

  if (filteredMarkets.length === 0) {
    marketsContainer.innerHTML = '<div class="loading">' + 
      (searchTerm ? 'No markets match your search' : 'No markets available') + 
      '</div>';
    return;
  }

  // Group markets by type
  const marketGroups = {};
  filteredMarkets.forEach(market => {
    if (!marketGroups[market.market_type]) {
      marketGroups[market.market_type] = [];
    }
    marketGroups[market.market_type].push(market);
  });

  marketsContainer.innerHTML = '';

  for (const [marketType, marketItems] of Object.entries(marketGroups)) {
    const marketGroup = document.createElement('div');
    marketGroup.className = 'market-group';

    marketGroup.innerHTML = `<h3>${marketType}</h3>`;

    const oddsList = document.createElement('div');
    oddsList.className = 'odds-list';

    marketItems.forEach(market => {
      // Parse the JSON odds array
      let dateArray = [];
      try {
        if (market.date) {
          if (typeof market.date === 'string') {
            let dateString = market.date.trim();
            if (dateString.startsWith('[') && dateString.endsWith(']')) {
              dateArray = JSON.parse(dateString);
            } else {
              dateArray = [dateString];
            }
          } else if (Array.isArray(market.date)) {
            dateArray = market.date;
          }
        }
      } catch (e) {
        console.error('Error parsing dates for market', market.id, ':', e);
      }

      let oddsArray = [];
      try {
        if (market.odds) {
          if (typeof market.odds === 'string') {
            let oddsString = market.odds.trim();
            
            if (oddsString.startsWith('[') && oddsString.endsWith(']')) {
              oddsArray = JSON.parse(oddsString);
            } else {
              const singleOdds = parseFloat(oddsString);
              if (!isNaN(singleOdds)) {
                oddsArray = [singleOdds];
              }
            }
          } else if (Array.isArray(market.odds)) {
            oddsArray = market.odds;
          }
        }
      } catch (e) {
        console.error('Error parsing odds for market', market.id, ':', e);
        console.error('Problematic odds data:', market.odds);
      }

      const currentOdd = oddsArray.length > 0 ? parseFloat(oddsArray[oddsArray.length - 1]).toFixed(3) : market.odds;

      const oddsItem = document.createElement('div');
      oddsItem.className = 'odds-item';
      oddsItem.innerHTML = `
        <h4>${market.outcome}</h4>
        <div class="odds-value">${currentOdd}</div>
      `;

      oddsItem.addEventListener('click', () => {
        showOddsHistory(market.outcome, oddsArray, dateArray);
      });

      oddsList.appendChild(oddsItem);
    });

    marketGroup.appendChild(oddsList);
    marketsContainer.appendChild(marketGroup);
    initializeMarketSearch();
  }
}

// Show odds history in modal
function showOddsHistory(outcome, oddsArray, dateArray) {
  const modal = document.getElementById('oddsModal');
  const modalTitle = document.getElementById('oddsModalTitle');
  const chartCanvas = document.getElementById('oddsChart');

  modalTitle.textContent = `${outcome} - Odds History`;
  modal.style.display = 'block';

  // Destroy previous chart if it exists
  if (oddsChart) {
    oddsChart.destroy();
  }

  // Create new chart
  const ctx = chartCanvas.getContext('2d');

  // Format data for time scale - combine dates and odds into objects
  const dataPoints = dateArray.map((date, index) => {
    return {
      x: new Date(date).getTime(), // Use timestamp for x-axis
      y: parseFloat(oddsArray[index]) || 0
    };
  }).filter(point => !isNaN(point.x) && !isNaN(point.y));

  // Sort by date to ensure chronological order
  dataPoints.sort((a, b) => a.x - b.x);

  // Calculate time range for tick configuration
  const timeRange = dataPoints.length > 1 ? 
    dataPoints[dataPoints.length - 1].x - dataPoints[0].x : 0;

  oddsChart = new Chart(ctx, {
    type: 'line',
    data: {
      datasets: [{
        label: 'Odds',
        data: dataPoints,
        borderColor: 'rgb(75, 192, 192)',
        tension: 0.1,
        fill: false,
        pointRadius: 4,
        pointHoverRadius: 6
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: {
          type: 'linear',
          title: {
            display: true,
            text: 'Date & Time'
          },
          ticks: {
            callback: function(value) {
              // Convert timestamp back to readable date
              if (value === undefined || value === null) return '';
              return new Date(value).toLocaleDateString() + ' ' + 
                     new Date(value).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
            },
            maxRotation: 45,
            minRotation: 35,
            autoSkip: true,
            maxTicksLimit: 10
          },
          // Set min/max to show proper time spacing
          min: dataPoints.length > 0 ? dataPoints[0].x - (timeRange * 0.05) : undefined,
          max: dataPoints.length > 0 ? dataPoints[dataPoints.length - 1].x + (timeRange * 0.05) : undefined
        },
        y: {
          title: {
            display: true,
            text: 'Odds'
          },
          beginAtZero: false
        }
      },
      plugins: {
        tooltip: {
          callbacks: {
            title: function(context) {
              if (!context[0]?.parsed?.x) return '';
              const date = new Date(context[0].parsed.x);
              return date.toLocaleString();
            },
            label: function(context) {
              return `Odds: ${context.parsed.y}`;
            }
          }
        },
        legend: {
          display: false
        }
      }
    }
  });
}

// Load steam data (biggest gainers and losers)
async function loadSteamData() {
  try {
    const timePeriod = document.getElementById('timePeriod').value;
    const { gainers, losers } = await ipcRenderer.invoke('get-steam-data', timePeriod);
    displaySteamData(gainers, losers);
  } catch (error) {
    console.error('Error loading steam data:', error);
  }
}

// Display steam data in the UI
function displaySteamData(gainers, losers) {
  const gainersList = document.getElementById('gainersList');
  const losersList = document.getElementById('losersList');

  gainersList.innerHTML = '';
  losersList.innerHTML = '';

  if (gainers.length === 0) {
    gainersList.innerHTML = '<div class="loading">No data available</div>';
  } else {
    gainers.forEach(item => {
      const currentOdd = parseFloat(item.current_odd);
      const previousOdd = parseFloat(item.previous_odd);

      let change = 0;
      if (previousOdd && currentOdd) {
        change = ((currentOdd - previousOdd) / previousOdd) * 100;
      }

      const steamItem = document.createElement('div');
      steamItem.className = 'steam-item';
      steamItem.innerHTML = `
        <div>
          <strong>${item.event_name}</strong><br>
          <small>${item.market_type} - ${item.outcome}</small>
        </div>
        <div class="change">${change > 0 ? '+' : ''}${change.toFixed(2)}%</div>
      `;

      gainersList.appendChild(steamItem);
    });
  }

  if (losers.length === 0) {
    losersList.innerHTML = '<div class="loading">No data available</div>';
  } else {
    losers.forEach(item => {
      const currentOdd = parseFloat(item.current_odd);
      const previousOdd = parseFloat(item.previous_odd);

      let change = 0;
      if (previousOdd && currentOdd) {
        change = ((currentOdd - previousOdd) / previousOdd) * 100;
      }

      const steamItem = document.createElement('div');
      steamItem.className = 'steam-item';
      steamItem.innerHTML = `
        <div>
          <strong>${item.event_name}</strong><br>
          <small>${item.market_type} - ${item.outcome}</small>
        </div>
        <div class="change">${change.toFixed(2)}%</div>
      `;

      losersList.appendChild(steamItem);

      // Show notification for significant changes
      if (Math.abs(change) > 10) {
        showNotification(
          `Significant odds change: ${item.event_name} - ${change > 0 ? '+' : ''}${change.toFixed(2)}%`,
          change > 0 ? 'success' : 'error'
        );
      }
    });
  }
}

// Show notification
function showNotification(message, type = 'info') {
  // Create notification element if it doesn't exist
  let notification = document.querySelector('.notification');
  if (!notification) {
    notification = document.createElement('div');
    notification.className = 'notification';
    document.body.appendChild(notification);
  }

  notification.textContent = message;
  notification.className = `notification ${type} show`;

  // Hide notification after 5 seconds
  setTimeout(() => {
    notification.classList.remove('show');
  }, 5000);
}
import numpy as np
import matplotlib.pyplot as plt
import random
from tqdm import tqdm

# ========================
# PARÁMETROS QUE PUEDES CAMBIAR
# ========================

WIN_PROBABILITY = 0.60      # Probabilidad de que las odds bajen
NUM_SIMULATIONS = 10000      # Número de simulaciones Monte Carlo
NUM_BETS = 10000            # Número de apuestas por simulación
INITIAL_BALANCE = 10000      # Balance inicial en dólares
BET_RATIO = 0.05              # Tamaño de cada apuesta en porcentaje de INITIAL_BALANCE
ODDS_DECREASE_RANGE = 0.1  # Rango de bajada de odds 
ODDS_INCREASE_RANGE = 0.1  # Rango de subida de odds

# ========================
# NO CAMBIES NADA DEBAJO DE ESTA LÍNEA
# ========================

def run_simulation():
    """
    Ejecuta una sola simulación de la estrategia de trading
    """
    balance = INITIAL_BALANCE
    balance_history = np.zeros(NUM_BETS + 1)
    balance_history[0] = balance
    
    for i in range(1, NUM_BETS + 1):
        # Odds iniciales de 2.00
        initial_odds = 2.00
        
        # Determinar si tenemos razón (odds bajan) o no (odds suben)
        is_right = random.random() < WIN_PROBABILITY
        
        if is_right:
            # Odds bajan entre 0 y ODDS_DECREASE_RANGE (ej. de 2.00 a 1.90-2.00)
            decrease_percent = random.uniform(0, ODDS_DECREASE_RANGE)
            new_odds = initial_odds * (1 - decrease_percent)
            
            # Calcular ganancia/pérdida basada en las NUEVAS odds (las reales del mercado)
            # La probabilidad real de ganar es 1/new_odds
            true_win_prob = 1 / new_odds
            wins_bet = random.random() < true_win_prob
            
            if wins_bet:
                profit = (BET_RATIO * INITIAL_BALANCE) * (initial_odds - 1)  # Ganamos con las odds iniciales
            else:
                profit = -(BET_RATIO * INITIAL_BALANCE)  # Perdemos la apuesta
            
        else:
            # Odds suben entre 0 y ODDS_INCREASE_RANGE (ej. de 2.00 a 2.00-2.10)
            increase_percent = random.uniform(0, ODDS_INCREASE_RANGE)
            new_odds = initial_odds * (1 + increase_percent)
            
            # Hacemos hedge para minimizar pérdidas
            # Calculamos cuánto apostar en contra para cubrirnos
            hedge_stake = ((BET_RATIO * INITIAL_BALANCE) * initial_odds) / new_odds
            profit = -abs((BET_RATIO * INITIAL_BALANCE) - hedge_stake)
        
        # Actualizar balance
        balance += profit
        balance_history[i] = balance
        
        # Parar si queda en bancarrota
        if balance <= 0:
            balance_history[i:] = 0
            break
    
    return balance_history

def main():
    """
    Función principal que ejecuta la simulación Monte Carlo
    """
    print("SIMULACIÓN DE TRADING DEPORTIVO")
    print("=" * 50)
    print(f"Probabilidad de acierto: {WIN_PROBABILITY*100}%")
    print(f"Rango de bajada de odds: {ODDS_DECREASE_RANGE*100}%")
    print(f"Rango de subida de odds: {ODDS_INCREASE_RANGE*100}%")
    print(f"Número de simulaciones: {NUM_SIMULATIONS}")
    print(f"Apuestas por simulación: {NUM_BETS}")
    print(f"Balance inicial: ${INITIAL_BALANCE}")
    print(f"Tamaño de apuesta (%): {(BET_RATIO)}")
    print("=" * 50)
    
    # Ejecutar simulaciones Monte Carlo
    print("Ejecutando simulaciones...")
    
    all_simulations = np.zeros((NUM_SIMULATIONS, NUM_BETS + 1))
    final_balances = np.zeros(NUM_SIMULATIONS)
    
    for sim_idx in tqdm(range(NUM_SIMULATIONS)):
        balance_history = run_simulation()
        all_simulations[sim_idx] = balance_history
        final_balances[sim_idx] = balance_history[-1]
    
    # Calcular estadísticas
    avg_final_balance = np.mean(final_balances)
    median_final_balance = np.median(final_balances)
    std_final_balance = np.std(final_balances)
    win_rate = np.mean(final_balances > INITIAL_BALANCE) * 100
    bankruptcy_rate = np.mean(final_balances <= 0) * 100
    
    print("\n=== RESULTADOS ===")
    print(f"Balance final promedio: ${avg_final_balance:,.2f}")
    print(f"Balance final mediano: ${median_final_balance:,.2f}")
    print(f"Desviación estándar: ${std_final_balance:,.2f}")
    print(f"Tasa de ganancia: {win_rate:.1f}%")
    print(f"Tasa de bancarrota: {bankruptcy_rate:.1f}%")
    print(f"Mejor resultado: ${np.max(final_balances):,.2f}")
    print(f"Peor resultado: ${np.min(final_balances):,.2f}")
    
    # Crear gráficos
    fig, axes = plt.subplots(2, 2, figsize=(15, 12))
    
    # Gráfico 1: Trayectorias de ejemplo
    num_sample_paths = min(100, NUM_SIMULATIONS)
    sample_indices = np.random.choice(NUM_SIMULATIONS, num_sample_paths, replace=False)
    
    for idx in sample_indices:
        axes[0, 0].plot(all_simulations[idx], alpha=0.1, color='blue')
    
    avg_path = np.mean(all_simulations, axis=0)
    axes[0, 0].plot(avg_path, color='red', linewidth=2, label='Promedio')
    axes[0, 0].axhline(y=INITIAL_BALANCE, color='green', linestyle='--', alpha=0.8, label='Balance Inicial')
    axes[0, 0].set_xlabel('Número de Apuesta')
    axes[0, 0].set_ylabel('Balance ($)')
    axes[0, 0].set_title(f'Trayectorias de Simulación (Prob: {WIN_PROBABILITY*100}%)')
    axes[0, 0].legend()
    axes[0, 0].grid(True, alpha=0.3)
    
    # Gráfico 2: Distribución de balances finales
    axes[0, 1].hist(final_balances, bins=50, alpha=0.7, color='skyblue', edgecolor='black')
    axes[0, 1].axvline(x=avg_final_balance, color='red', linestyle='--', linewidth=2, label=f'Promedio: ${avg_final_balance:.2f}')
    axes[0, 1].axvline(x=INITIAL_BALANCE, color='green', linestyle='--', alpha=0.8, label='Balance Inicial')
    axes[0, 1].set_xlabel('Balance Final ($)')
    axes[0, 1].set_ylabel('Frecuencia')
    axes[0, 1].set_title('Distribución de Balances Finales')
    axes[0, 1].legend()
    axes[0, 1].grid(True, alpha=0.3)
    
    # Gráfico 3: Percentiles
    percentiles = [5, 25, 50, 75, 95]
    colors = ['red', 'orange', 'green', 'orange', 'red']
    linestyles = ['--', ':', '-', ':', '--']
    
    for i, percentile in enumerate(percentiles):
        percentile_path = np.percentile(all_simulations, percentile, axis=0)
        axes[1, 0].plot(percentile_path, color=colors[i], linestyle=linestyles[i], 
                       label=f'Percentil {percentile}')
    
    axes[1, 0].axhline(y=INITIAL_BALANCE, color='black', linestyle='--', alpha=0.5, label='Balance Inicial')
    axes[1, 0].set_xlabel('Número de Apuesta')
    axes[1, 0].set_ylabel('Balance ($)')
    axes[1, 0].set_title('Trayectorias por Percentiles')
    axes[1, 0].legend()
    axes[1, 0].grid(True, alpha=0.3)
    
    # Gráfico 4: Distribución acumulativa
    sorted_balances = np.sort(final_balances)
    cdf = np.arange(1, len(sorted_balances) + 1) / len(sorted_balances)
    axes[1, 1].plot(sorted_balances, cdf, linewidth=2)
    axes[1, 1].axvline(x=INITIAL_BALANCE, color='green', linestyle='--', alpha=0.8, label='Balance Inicial')
    axes[1, 1].set_xlabel('Balance Final ($)')
    axes[1, 1].set_ylabel('Probabilidad Acumulativa')
    axes[1, 1].set_title('Distribución Acumulativa de Balances Finales')
    axes[1, 1].legend()
    axes[1, 1].grid(True, alpha=0.3)
    
    plt.tight_layout()
    plt.show()

if __name__ == "__main__":   
    main()
# Steam Tracker
A sports trading strategy designed to profit from predicted pre-event odds movements, rather than the event outcome itself.

## Overview
This strategy operates on the principle that Pinnacle's odds represent the most accurate probability assessment at any given time. The core concept is to:
1. Predict future odds movements
2. Execute back/lay bets based on these predictions
3. Manage positions according to whether the predicted movement materializes

## Example Execution
### Initial Position
1. **Prediction**: Odds will decrease from current levels
2. **Action**: Place back bet at initial odds of 2.00

### Scenario 1: Prediction Correct (Odds Decrease to 1.90)
3. **Action**: Maintain original bet position
4. **Rationale**: This becomes a +EV bet with superior odds
5. **P&L Outcome**:
    - Win: Profit calculated at original 2.00 odds
    - Loss: Entire stake lost
    - *Accepts event risk for higher potential payout*

### Scenario 2: Prediction Wrong (Odds Increase to 2.10)
3. **Action**: Execute hedge by placing lay bet at new odds
4. **Rationale**: Capital preservation through position neutralization
5. **P&L Outcome**:
    - Calculated lay stake offsets original back bet
    - Results in small, guaranteed loss (hedging cost)
    - *Prioritizes risk management over potential gains*

## Key Strategy Elements
- **Primary Profit Source**: Accurate prediction of odds movement direction
- **Risk Management**: Systematic hedging when predictions prove incorrect
- **Market Efficiency**: Leverages Pinnacle as probability benchmark

## Further Analysis
See the accompanying notebook for detailed statistics, backtesting results, and profitability analysis of this strategy.
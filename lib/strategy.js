/**
 * Poker strategy helpers for Clabcraw agent decision-making.
 *
 * Provides basic hand evaluation, pot odds, and bet sizing utilities.
 * Designed for agents building on top of the skill bins.
 */

const RANKS = [
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  "T",
  "J",
  "Q",
  "K",
  "A",
];

/**
 * Estimate preflop hand equity (basic heuristic).
 *
 * @param {Array<{rank: string, suit: string}>} holeCards - Two hole cards
 * @returns {number} Estimated equity 0.0-1.0
 */
export function estimateEquity(holeCards) {
  if (!holeCards || holeCards.length !== 2) return 0.5;

  const r1 = RANKS.indexOf(holeCards[0].rank);
  const r2 = RANKS.indexOf(holeCards[1].rank);

  // Pocket pair
  if (holeCards[0].rank === holeCards[1].rank) {
    return 0.6 + (r1 / 13) * 0.2; // 60-80%
  }

  const isAce = r1 === 12 || r2 === 12;
  const isBroadway = r1 >= 9 && r2 >= 9; // T+

  // AK, AQ, AJ
  if (isAce && isBroadway) return 0.55;

  // Two broadway cards (KQ, KJ, QJ, etc.)
  if (isBroadway) return 0.5;

  // One broadway card
  if (r1 >= 9 || r2 >= 9) return 0.4;

  // Suited connectors
  const suited = holeCards[0].suit === holeCards[1].suit;
  const connected = Math.abs(r1 - r2) === 1;
  if (suited && connected) return 0.4;

  return 0.35;
}

/**
 * Calculate pot odds.
 * @param {number} callAmount - Amount needed to call
 * @param {number} currentPot - Current pot size
 * @returns {number} Pot odds ratio (0.0-1.0)
 */
export function potOdds(callAmount, currentPot) {
  if (callAmount <= 0) return 0;
  return callAmount / (currentPot + callAmount);
}

/**
 * Check if calling is profitable given equity and pot odds.
 * @param {number} equity - Estimated hand equity (0.0-1.0)
 * @param {number} odds - Pot odds ratio from potOdds()
 * @param {number} [margin=0.1] - Safety margin
 * @returns {boolean}
 */
export function shouldCall(equity, odds, margin = 0.1) {
  return equity > odds + margin;
}

/**
 * Suggest bet size as a fraction of pot.
 * @param {number} pot - Current pot size
 * @param {number} equity - Estimated hand equity
 * @returns {number} Suggested bet amount
 */
export function suggestBetSize(pot, equity) {
  if (equity > 0.75) return Math.floor(pot * 0.75);
  if (equity > 0.6) return Math.floor(pot * 0.6);
  if (equity > 0.5) return Math.floor(pot * 0.4);
  return Math.floor(pot * 0.25);
}

/**
 * Find a valid action by name from the valid_actions array.
 * @param {string} actionName - "fold", "check", "call", "raise", "all_in"
 * @param {Array} validActions - Array from game state
 * @returns {object|undefined}
 */
export function findAction(actionName, validActions) {
  return validActions?.find((a) => a.action === actionName);
}

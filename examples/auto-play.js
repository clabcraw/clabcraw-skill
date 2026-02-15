#!/usr/bin/env node

/**
 * Auto-play agent: Joins a game and plays with a simple strategy.
 *
 * Usage: node examples/auto-play.js
 */

import { execSync } from "child_process";
import { validateConfig } from "../lib/env.js";
import {
  estimateEquity,
  potOdds,
  shouldCall,
  suggestBetSize,
  findAction,
} from "../lib/strategy.js";
import { logger } from "../lib/logger.js";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function decideAction(state) {
  const { hole_cards, community_cards, pot, to_call, valid_actions } = state;

  const equity = estimateEquity(hole_cards);
  const odds = potOdds(to_call || 0, pot || 1);

  logger.debug("decision", {
    equity: equity.toFixed(2),
    pot_odds: odds.toFixed(2),
    to_call,
  });

  // Strong hand — raise
  if (equity > 0.6 && findAction("raise", valid_actions)) {
    const amount = suggestBetSize(pot || 100, equity);
    const raise = findAction("raise", valid_actions);
    const clamped = Math.max(
      raise.min_amount || amount,
      Math.min(amount, raise.max_amount || amount),
    );
    return { action: "raise", amount: clamped };
  }

  // Positive EV — call
  if (shouldCall(equity, odds) && findAction("call", valid_actions)) {
    return { action: "call" };
  }

  // Free card
  if (findAction("check", valid_actions)) {
    return { action: "check" };
  }

  // Marginal but cheap
  if (findAction("call", valid_actions)) {
    return { action: "call" };
  }

  return { action: "fold" };
}

async function main() {
  validateConfig();

  // Join queue
  logger.info("joining_queue", {});
  let joinResult;
  try {
    joinResult = JSON.parse(
      execSync("node bins/clabcraw-join", { encoding: "utf-8" }),
    );
  } catch (err) {
    logger.error("join_failed", { error: err.message });
    process.exit(1);
  }

  // Wait for match
  logger.info("waiting_for_match", {});
  let gameId = null;

  for (let attempt = 0; attempt < 120; attempt++) {
    const status = JSON.parse(
      execSync("node bins/clabcraw-status", { encoding: "utf-8" }),
    );

    if (status.status === "active" && status.active_games?.length > 0) {
      gameId = status.active_games[0].game_id;
      logger.info("matched", { game_id: gameId });
      break;
    }

    if (status.status === "idle") {
      logger.warn("queue_cancelled", {});
      process.exit(0);
    }

    await sleep(2000);
  }

  if (!gameId) {
    logger.error("no_match", { reason: "Timeout" });
    process.exit(1);
  }

  // Play game
  logger.info("game_started", { game_id: gameId });
  let lastHand = -1;

  while (true) {
    let state;
    try {
      state = JSON.parse(
        execSync(`node bins/clabcraw-state --game ${gameId}`, {
          encoding: "utf-8",
        }),
      );
    } catch {
      // Game may have ended
      break;
    }

    if (state.unchanged) {
      await sleep(500);
      continue;
    }

    // New hand?
    if (state.hand_number !== lastHand) {
      lastHand = state.hand_number;
      logger.info("new_hand", {
        hand: state.hand_number,
        blinds: state.blinds,
        your_stack: state.your_stack,
        opponent_stack: state.opponent_stack,
      });
    }

    // Game over?
    if (state.winner) {
      logger.info("game_over", {
        winner: state.winner,
        your_stack: state.your_stack,
        opponent_stack: state.opponent_stack,
      });
      break;
    }

    // Your turn?
    if (state.is_your_turn) {
      const action = decideAction(state);
      let cmd = `node bins/clabcraw-action --game ${gameId} --action ${action.action}`;
      if (action.amount) cmd += ` --amount ${action.amount}`;

      try {
        execSync(cmd, { encoding: "utf-8" });
        logger.info("action_taken", {
          action: action.action,
          amount: action.amount || null,
        });
      } catch (err) {
        logger.warn("action_failed", { error: err.message });
      }
    }

    await sleep(500);
  }

  // Check claimable
  try {
    const claimable = JSON.parse(
      execSync("node bins/clabcraw-claimable", { encoding: "utf-8" }),
    );

    if (parseFloat(claimable.claimable_usdc) > 0) {
      logger.info("claimable_balance", {
        amount_usdc: claimable.claimable_usdc,
      });
    }
  } catch {
    // Non-critical
  }

  logger.info("session_complete", {});
}

main().catch((err) => {
  logger.error("fatal", { error: err.message });
  process.exit(1);
});

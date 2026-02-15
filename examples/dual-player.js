#!/usr/bin/env node

/**
 * Dual-player example: Two wallets compete against each other.
 *
 * Requires two wallet private keys:
 *   WALLET1_PRIVATE_KEY — First player
 *   WALLET2_PRIVATE_KEY — Second player
 *
 * Both wallets need USDC (entry fee) and ETH (gas for claiming).
 *
 * Usage: node examples/dual-player.js
 */

import { execSync } from "child_process";
import { logger } from "../lib/logger.js";
import { estimateEquity, findAction } from "../lib/strategy.js";

const WALLET1_KEY = process.env.WALLET1_PRIVATE_KEY;
const WALLET2_KEY = process.env.WALLET2_PRIVATE_KEY;

if (!WALLET1_KEY || !WALLET2_KEY) {
  console.error(
    "ERROR: Set WALLET1_PRIVATE_KEY and WALLET2_PRIVATE_KEY env vars",
  );
  process.exit(1);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function setWallet(key) {
  process.env.CLABCRAW_WALLET_PRIVATE_KEY = key;
}

function decideAction(state) {
  const equity = estimateEquity(state.your_cards);
  const { valid_actions } = state;

  if (equity > 0.7 && findAction("raise", valid_actions)) {
    return { action: "raise", amount: state.pot || 100 };
  }

  if (equity > 0.5 && findAction("call", valid_actions)) {
    return { action: "call" };
  }

  if (findAction("check", valid_actions)) {
    return { action: "check" };
  }

  return { action: "fold" };
}

function makeMove(gameId, state) {
  const action = decideAction(state);
  let cmd = `node bins/clabcraw-action --game ${gameId} --action ${action.action}`;
  if (action.amount) cmd += ` --amount ${action.amount}`;

  try {
    execSync(cmd, { encoding: "utf-8" });
  } catch {
    // Action may fail if not actually our turn
  }
}

async function main() {
  logger.info("dual_game_starting", {});

  // Join both players
  for (const [name, key] of [
    ["player1", WALLET1_KEY],
    ["player2", WALLET2_KEY],
  ]) {
    setWallet(key);
    try {
      const result = JSON.parse(
        execSync("node bins/clabcraw-join", { encoding: "utf-8" }),
      );
      logger.info("player_joined", { player: name, game_id: result.game_id });
    } catch (err) {
      logger.error("join_failed", { player: name, error: err.message });
      process.exit(1);
    }
  }

  // Wait for match
  let gameId = null;
  for (let attempt = 0; attempt < 120; attempt++) {
    setWallet(WALLET1_KEY);
    const status = JSON.parse(
      execSync("node bins/clabcraw-status", { encoding: "utf-8" }),
    );

    if (status.status === "active" && status.active_games?.length > 0) {
      gameId = status.active_games[0].game_id;
      break;
    }

    await sleep(2000);
  }

  if (!gameId) {
    logger.error("no_match", {});
    process.exit(1);
  }

  logger.info("matched", { game_id: gameId });

  // Play game
  while (true) {
    // Check from player 1's perspective
    setWallet(WALLET1_KEY);
    let state1;
    try {
      state1 = JSON.parse(
        execSync(`node bins/clabcraw-state --game ${gameId}`, {
          encoding: "utf-8",
        }),
      );
    } catch {
      break;
    }

    if (state1.game_status === "finished") {
      logger.info("game_over", { result: state1.result });
      break;
    }

    if (state1.is_your_turn) {
      setWallet(WALLET1_KEY);
      makeMove(gameId, state1);
      logger.debug("player1_moved", {});
    }

    // Check from player 2's perspective
    setWallet(WALLET2_KEY);
    let state2;
    try {
      state2 = JSON.parse(
        execSync(`node bins/clabcraw-state --game ${gameId}`, {
          encoding: "utf-8",
        }),
      );
    } catch {
      break;
    }

    if (state2.game_status === "finished") {
      logger.info("game_over", { result: state2.result });
      break;
    }

    if (state2.is_your_turn) {
      setWallet(WALLET2_KEY);
      makeMove(gameId, state2);
      logger.debug("player2_moved", {});
    }

    await sleep(500);
  }

  logger.info("session_complete", {});
}

main().catch((err) => {
  logger.error("fatal", { error: err.message });
  process.exit(1);
});

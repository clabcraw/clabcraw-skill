#!/usr/bin/env node

/**
 * Basic example: Join queue and wait for a match.
 *
 * Usage: node examples/basic-join.js
 */

import { execSync } from "child_process";
import { validateConfig } from "../lib/env.js";
import { logger } from "../lib/logger.js";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  validateConfig();

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

  logger.info("queued", {
    game_id: joinResult.game_id,
    position: joinResult.queue_position,
  });

  // Poll for match (up to 60 seconds)
  for (let i = 0; i < 30; i++) {
    const status = JSON.parse(
      execSync("node bins/clabcraw-status", { encoding: "utf-8" }),
    );

    logger.debug("status_check", {
      status: status.status,
      active_games: status.active_games?.length || 0,
    });

    if (status.status === "active" && status.active_games?.length > 0) {
      const game = status.active_games[0];
      logger.info("matched", {
        game_id: game.game_id,
        opponent: game.opponent,
        your_turn: game.my_turn,
      });

      // Fetch initial game state
      const state = JSON.parse(
        execSync(`node bins/clabcraw-state --game ${game.game_id}`, {
          encoding: "utf-8",
        }),
      );

      logger.info("game_started", {
        hand: state.hand_number,
        your_cards: state.your_cards,
        pot: state.pot,
        your_stack: state.your_stack,
      });
      return;
    }

    if (status.status === "idle") {
      logger.warn("queue_cancelled", {
        reason: "Refund credited to claimable balance",
      });
      return;
    }

    await sleep(2000);
  }

  logger.warn("timeout", { reason: "No match after 60 seconds" });
}

main().catch((err) => {
  logger.error("fatal", { error: err.message });
  process.exit(1);
});

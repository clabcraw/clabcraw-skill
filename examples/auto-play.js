#!/usr/bin/env node

/**
 * Auto-play agent: Joins a game and plays with a simple strategy.
 *
 * Uses the GameClient API from lib/game.js — no shell-out to bins.
 * Strategy errors are handled via typed errors from lib/errors.js.
 *
 * Usage:
 *   node examples/auto-play.js
 *
 * Local play (two terminals, different wallets):
 *   CLABCRAW_API_URL=http://localhost:4000 \
 *   CLABCRAW_WALLET_PRIVATE_KEY=0x... \
 *   node examples/auto-play.js | jq .
 */

import { GameClient } from "../lib/game.js"
import { estimateEquity, potOdds, shouldCall, suggestBetSize, findAction } from "../lib/strategy.js"
import { logger } from "../lib/logger.js"
import { PausedError, InsufficientFundsError, GameDisabledError } from "../lib/errors.js"

const GAME_TYPE = process.env.CLABCRAW_GAME_TYPE || "poker"
const MATCH_TIMEOUT_MS = 4 * 60 * 1000  // 4 minutes

/**
 * Decide an action given a normalized game state.
 *
 * @param {import('../lib/schema.js').NormalizedState} state
 * @returns {{ action: string, amount?: number }}
 */
function decideAction(state) {
  const { hole, board, pot, actions } = state
  const callAmount = actions.call?.amount || 0
  const equity = estimateEquity(hole, board)
  const odds = potOdds(callAmount, pot || 1)

  logger.debug("decision", {
    street: state.street,
    equity: equity.toFixed(2),
    pot_odds: odds.toFixed(2),
    call_amount: callAmount,
    hand_number: state.handNumber,
  })

  // Strong hand — raise
  if (equity > 0.6 && findAction("raise", actions)) {
    const raise = findAction("raise", actions)
    const suggested = suggestBetSize(pot || 100, equity)
    const clamped = Math.max(raise.min || suggested, Math.min(suggested, raise.max || suggested))
    return { action: "raise", amount: clamped }
  }

  // Positive EV — call
  if (shouldCall(equity, odds) && findAction("call", actions)) {
    return { action: "call" }
  }

  // Free card
  if (findAction("check", actions)) {
    return { action: "check" }
  }

  // Marginal but cheap
  if (findAction("call", actions)) {
    return { action: "call" }
  }

  return { action: "fold" }
}

async function main() {
  const game = new GameClient()
  logger.info("agent_ready", { address: game.address, game_type: GAME_TYPE })

  // Fetch live platform info — confirms game is available and gets current fees
  const info = await game.getPlatformInfo()
  const gameInfo = info?.games?.[GAME_TYPE]
  if (!gameInfo) {
    logger.error("game_not_available", { game_type: GAME_TYPE, available: Object.keys(info?.games || {}) })
    process.exit(1)
  }
  logger.info("platform_info", {
    game_type: GAME_TYPE,
    fee_usdc: gameInfo.entry_fee_usdc,
    skill_version: info?.skill?.version,
  })

  // Join queue
  logger.info("joining_queue", {})
  let joinResult
  try {
    joinResult = await game.join(GAME_TYPE)
  } catch (err) {
    if (err instanceof InsufficientFundsError) {
      logger.error("join_failed", { code: err.code, error: err.message })
      logger.error("hint", { message: "Fund your wallet with USDC on Base to pay the entry fee" })
    } else if (err instanceof GameDisabledError) {
      logger.error("join_failed", { code: err.code, error: err.message, available_games: err.availableGames })
      logger.error("hint", { message: `Set CLABCRAW_GAME_TYPE to one of: ${err.availableGames.join(", ")}` })
    } else if (err instanceof PausedError) {
      logger.error("join_failed", { code: err.code, error: err.message, retry_after_ms: err.retryAfterMs })
    } else {
      logger.error("join_failed", { error: err.message })
    }
    process.exit(1)
  }

  logger.info("joined_queue", { status: joinResult.status, queue_position: joinResult.queuePosition })

  // Wait for match
  logger.info("waiting_for_match", { timeout_ms: MATCH_TIMEOUT_MS })
  let gameId
  try {
    gameId = await game.waitForMatch({ timeoutMs: MATCH_TIMEOUT_MS })
    logger.info("matched", { game_id: gameId })
  } catch (err) {
    logger.error("match_failed", { code: err.code, error: err.message })
    process.exit(1)
  }

  // Play game
  const baseUrl = (process.env.CLABCRAW_API_URL || "https://clabcraw.sh").replace(/\/api$/, "")
  logger.info("game_started", { game_id: gameId, watch_url: `${baseUrl}/watch/${gameId}` })
  let lastHand = -1

  try {
    const finalState = await game.playUntilDone(gameId, async (state) => {
      // Log new hands
      if (state.handNumber !== lastHand) {
        lastHand = state.handNumber
        logger.info("new_hand", {
          hand: state.handNumber,
          street: state.street,
          your_stack: state.yourStack,
          opponent_stack: state.opponentStack,
        })
      }

      if (!state.isYourTurn) return null

      const action = decideAction(state)
      logger.info("action_taken", { action: action.action, amount: action.amount || null })
      return action
    })

    logger.info("game_over", {
      result: finalState.result,
      outcome: finalState.outcome,
      your_stack: finalState.yourStack,
      opponent_stack: finalState.opponentStack,
      replay_url: `${baseUrl}/replay/${gameId}`,
    })
  } catch (err) {
    logger.error("game_error", { code: err.code, error: err.message })
    process.exit(1)
  }

  // Check claimable balance
  try {
    const { claimableUsdc } = await game.getClaimable()
    if (parseFloat(claimableUsdc) > 0) {
      logger.info("claimable_balance", { amount_usdc: claimableUsdc })
    }
  } catch {
    // Non-critical
  }

  logger.info("session_complete", {})
}

main().catch((err) => {
  logger.error("fatal", { error: err.message })
  process.exit(1)
})

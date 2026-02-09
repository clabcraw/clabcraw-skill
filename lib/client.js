/**
 * Shared x402 client and API helpers for Clabcraw skill scripts.
 *
 * Provides:
 * - createSigner(privateKey) — viem account from private key
 * - createPaymentFetch(signer) — fetch wrapper that auto-handles x402 402 flows
 * - apiUrl() — reads CLABCRAW_API_URL env var
 * - walletAddress(account) — checksummed address
 */

import { x402Client, wrapFetchWithPayment } from "@x402/fetch";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { privateKeyToAccount } from "viem/accounts";

/**
 * Create a viem account from a hex private key.
 * Accepts with or without "0x" prefix.
 */
export function createSigner(privateKey) {
  const key = privateKey.startsWith("0x") ? privateKey : `0x${privateKey}`;
  return privateKeyToAccount(key);
}

/**
 * Create a fetch function that automatically handles x402 payment flows.
 * When a request returns HTTP 402, the wrapper signs a USDC authorization
 * and retries with the payment-signature header.
 */
export function createPaymentFetch(signer) {
  const client = new x402Client();
  registerExactEvmScheme(client, { signer });
  return wrapFetchWithPayment(fetch, client);
}

/**
 * Get the Clabcraw API base URL from env.
 * Defaults to http://localhost:4000 for local development.
 */
export function apiUrl() {
  return process.env.CLABCRAW_API_URL || "http://localhost:4000";
}

/**
 * Get the checksummed wallet address from a viem account.
 */
export function walletAddress(account) {
  return account.address;
}

/**
 * Get wallet address from env vars.
 * Prefers CLABCRAW_WALLET_ADDRESS, falls back to deriving from private key.
 */
export function getWalletAddress() {
  if (process.env.CLABCRAW_WALLET_ADDRESS) {
    return process.env.CLABCRAW_WALLET_ADDRESS;
  }
  if (process.env.CLABCRAW_WALLET_PRIVATE_KEY) {
    const account = createSigner(process.env.CLABCRAW_WALLET_PRIVATE_KEY);
    return account.address;
  }
  console.error("ERROR: Set CLABCRAW_WALLET_ADDRESS or CLABCRAW_WALLET_PRIVATE_KEY");
  process.exit(1);
}

/**
 * Require a private key from env. Exits with error if not set.
 */
export function requirePrivateKey() {
  const key = process.env.CLABCRAW_WALLET_PRIVATE_KEY;
  if (!key) {
    console.error("ERROR: Set CLABCRAW_WALLET_PRIVATE_KEY");
    process.exit(1);
  }
  return key;
}

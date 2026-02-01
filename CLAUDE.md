# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a minimal reproduction of a partial swap (PSWAP) note consumption issue using the Miden WebClient SDK. It demonstrates a scenario where PSWAP works correctly via the Rust SDK but fails with a VM execution error when using the TypeScript/WASM WebClient SDK.

## Development Commands

```bash
pnpm install     # Install dependencies
pnpm dev         # Start dev server (http://localhost:3000)
pnpm build       # Production build
```

To run the test: Navigate to http://localhost:3000/partial and click "Run Test"

## Architecture

### Tech Stack
- Next.js 16 (with webpack, required for WASM support)
- React 19
- @demox-labs/miden-sdk 0.12.5 (Miden WebClient for browser-based blockchain interaction)

### Key Files
- `app/partial/page.tsx` - Main test page implementing the full PSWAP flow
- `lib/masm/pswap.ts` - PSWAP note script in Miden Assembly (MASM)

### Test Flow
The test at `/partial` executes:
1. Creates two faucets (GOLD and SILVER)
2. Creates two wallets (Maker and Taker)
3. Mints 1000 GOLD to Maker, 250 SILVER to Taker
4. Maker creates a PSWAP note offering 1000 GOLD for 1000 SILVER
5. Taker attempts to fill 25% (250 SILVER for 250 GOLD)
6. Maker consumes P2ID note to receive SILVER
7. Verifies final balances

## Miden-Specific Patterns

### AccountId Handling
Store AccountIds as hex strings immediately after creation to avoid WASM garbage collection issues:
```typescript
const accountId = account.id();
const accountIdHex = accountId.toString();
// Later: AccountId.fromHex(accountIdHex)
```

### Swap Tags
Swap tags must encode offered/requested faucet prefixes (not fromAccountId):
```typescript
const buildSwapTag = (noteType, offeredFaucetId, requestedFaucetId) => {
  const offeredTag = Number((offeredFaucetId.prefix().asInt() >> BigInt(56)) & BigInt(0xFF));
  const requestedTag = Number((requestedFaucetId.prefix().asInt() >> BigInt(56)) & BigInt(0xFF));
  const payload = (offeredTag << 8) | requestedTag;
  return NoteTag.forPublicUseCase(SWAP_USE_CASE_ID, payload, NoteExecutionMode.newLocal());
};
```

### Note Inputs Layout (14 felts)
```
0-3:   REQUESTED_ASSET_WORD [amount, 0, suffix, prefix]
4:     SWAPP_TAG
5:     P2ID_TAG
6-7:   Empty (reserved)
8:     SWAP_COUNT
9:     EXPIRATION_BLOCK (0 = no expiration)
10-11: Empty (reserved)
12:    CREATOR_PREFIX
13:    CREATOR_SUFFIX
```

### Fill Transaction Requirements
Per Miden team guidance, fill transactions require:
- `withAuthenticatedInputNotes` - the SWAPP note being consumed
- `withExpectedFutureNotes` - P2ID note + leftover SWAPP note details
- `withExpectedOutputRecipients` - both recipients
- Use `submitNewTransaction` instead of manual execute/prove/submit

## Environment

- Node.js 18+
- Uses public accounts and notes
- Connects to Miden testnet RPC: `https://rpc.testnet.miden.io:443`

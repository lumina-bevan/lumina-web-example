# PSWAP Partial Fill Example

Working example of partial swap note consumption using the Miden WebClient SDK.

## What This Test Does

1. Creates two faucets (GOLD and SILVER)
2. Creates two wallets (Maker and Taker)
3. Mints 1000 GOLD to Maker, 250 SILVER to Taker
4. Maker creates a PSWAP note offering 1000 GOLD for 1000 SILVER
5. Taker fills 25% (sends 250 SILVER, receives 250 GOLD)
6. Maker consumes P2ID note (receives 250 SILVER)
7. Verifies final balances:
   - Maker: 750 GOLD + 250 SILVER
   - Taker: 250 GOLD

## Setup

```bash
pnpm install
pnpm dev
```

Navigate to http://localhost:3000/partial and click "Run Test".

## Files

- `app/partial/page.tsx` - Test page that runs the full PSWAP flow
- `lib/masm/pswap.ts` - PSWAP note script (MASM assembly)

## Key Implementation Details

The following were required to make partial fills work with the WebClient:

1. **Swap tags must be built from asset pair** - Use `buildSwapTag(noteType, offeredFaucetId, requestedFaucetId)` instead of `NoteTag.fromAccountId()`

2. **Fill transactions require expected future notes** - Use `TransactionRequestBuilder` with:
   - `withAuthenticatedInputNotes()` - the SWAPP note being consumed
   - `withExpectedFutureNotes()` - P2ID note + leftover SWAPP note details
   - `withExpectedOutputRecipients()` - both recipients

3. **Use `submitNewTransaction()`** - Instead of manual execute/prove/submit flow

## Environment

- Node.js 18+
- `@demox-labs/miden-sdk@0.12.5`
- Next.js 16 (for WASM support)

## Notes

- The test uses public accounts and notes for simplicity
- Wait times are included to allow transactions to commit on testnet
- AccountIds are stored as hex strings and converted back when needed (to avoid WASM GC issues)

# PSWAP Partial Fill Examples

Working examples of partial swap note consumption using the Miden WebClient SDK.

## Test Pages

### `/partial` - Public PSWAP (original)
Tests partial fills with PUBLIC notes. All notes are visible on-chain.

### `/private-partial` - Private PSWAP (new)
Tests partial fills with PRIVATE notes. Key differences:
- Uses `PSWAP_PRIVATE_MASM` with 15 inputs (includes `NOTE_TYPE_OUTPUT`)
- Creates PSWAP note with `NoteType.Private`
- Output notes (P2ID + leftover) inherit privacy from `NOTE_TYPE_OUTPUT` input
- Notes are NOT visible on midenscan.com

## What The Tests Do

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

Navigate to:
- http://localhost:3000/partial - Public PSWAP test
- http://localhost:3000/private-partial - Private PSWAP test

## Files

- `app/partial/page.tsx` - Test page for PUBLIC PSWAP flow
- `app/private-partial/page.tsx` - Test page for PRIVATE PSWAP flow
- `lib/masm/pswap.ts` - Original PSWAP note script (hardcoded PUBLIC_NOTE)
- `lib/masm/pswap-private.ts` - Modified PSWAP script with dynamic NOTE_TYPE_OUTPUT

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

## Private PSWAP Implementation

The key change to support private output notes is in the MASM script:

### Original (`pswap.ts`):
```masm
const.PUBLIC_NOTE=1
...
push.PUBLIC_NOTE  # Always creates PUBLIC output notes
```

### Modified (`pswap-private.ts`):
```masm
const.NOTE_TYPE_OUTPUT_INPUT = 0x000E  # Input index 14
...
mem_load.NOTE_TYPE_OUTPUT_INPUT  # Reads note type from input
```

This allows the caller to specify whether output notes (P2ID payback + leftover SWAPP) should be:
- `0` = Private (not visible on-chain)
- `1` = Public (visible on-chain)

### Note Inputs Layout (15 felts):
```
0-3:   REQUESTED_ASSET_WORD [amount, 0, suffix, prefix]
4:     SWAPP_TAG
5:     P2ID_TAG
6-7:   Empty (reserved)
8:     SWAP_COUNT
9:     EXPIRATION_BLOCK
10-11: Empty (reserved)
12:    CREATOR_PREFIX
13:    CREATOR_SUFFIX
14:    NOTE_TYPE_OUTPUT  <-- NEW (0=Private, 1=Public)
```

## Notes

- The `/partial` test uses public accounts and notes for simplicity
- The `/private-partial` test uses private wallets and notes
- Wait times are included to allow transactions to commit on testnet
- AccountIds are stored as hex strings and converted back when needed (to avoid WASM GC issues)
- Private notes require out-of-band sharing (post office or direct export)

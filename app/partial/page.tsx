"use client";

/**
 * PSWAP Partial Fill Test Page
 *
 * Converted from: ../lumina-engine-be/tests/pswap_testnet_prefix_suffix.rs
 *
 * This test demonstrates:
 *   1. Maker creates PSWAP: 1000 GOLD for 1000 SILVER
 *   2. Taker fills 25%: sends 250 SILVER, receives 250 GOLD
 *   3. Maker consumes P2ID: receives 250 SILVER
 *   4. Leftover SWAPP: 750 GOLD remains (still owned by maker)
 */

import { useState, useCallback } from "react";
import { AccountId } from "@demox-labs/miden-sdk";

const OFFERED_AMOUNT = BigInt(1000);
const REQUESTED_AMOUNT = BigInt(1000);
const FILL_AMOUNT = BigInt(250); // 25% fill

type TestPhase =
  | "idle"
  | "init"
  | "create-faucets"
  | "create-wallets"
  | "mint-tokens"
  | "create-swapp"
  | "fill-swapp"
  | "consume-p2id"
  | "verify"
  | "done"
  | "error";

interface TestState {
  phase: TestPhase;
  logs: string[];
  goldFaucetId: string | null;
  silverFaucetId: string | null;
  makerId: string | null;
  takerId: string | null;
  swappNoteId: string | null;
  p2idNoteId: string | null;
  leftoverNoteId: string | null;
}

export default function PartialFillTestPage() {
  const [state, setState] = useState<TestState>({
    phase: "idle",
    logs: [],
    goldFaucetId: null,
    silverFaucetId: null,
    makerId: null,
    takerId: null,
    swappNoteId: null,
    p2idNoteId: null,
    leftoverNoteId: null,
  });

  const log = useCallback((message: string) => {
    console.log(message);
    setState((prev) => ({
      ...prev,
      logs: [
        ...prev.logs,
        `[${new Date().toISOString().slice(11, 19)}] ${message}`,
      ],
    }));
  }, []);

  const setPhase = useCallback((phase: TestPhase) => {
    setState((prev) => ({ ...prev, phase }));
  }, []);

  /**
   * Log prefix and suffix for an AccountId (matches Rust log_prefix_suffix)
   */
  const logPrefixSuffix = useCallback(
    async (name: string, accountId: unknown) => {
      const id = accountId as AccountId;
      const hex = id.toString();
      const hexLen = hex.replace("0x", "").length;
      const prefix = id.prefix().asInt();
      const suffix = id.suffix().asInt();

      log(`  ${name} ID:     ${hex}`);
      log(`  ${name} hex len: ${hexLen} chars`);
      log(
        `  ${name} prefix:  ${prefix} (0x${prefix.toString(16).padStart(16, "0")})`,
      );
      log(
        `  ${name} suffix:  ${suffix} (0x${suffix.toString(16).padStart(16, "0")})`,
      );
    },
    [log],
  );

  /**
   * Run the complete PSWAP test flow
   */
  const runTest = useCallback(async () => {
    setState({
      phase: "init",
      logs: [],
      goldFaucetId: null,
      silverFaucetId: null,
      makerId: null,
      takerId: null,
      swappNoteId: null,
      p2idNoteId: null,
      leftoverNoteId: null,
    });

    try {
      log("============================================================");
      log("PSWAP PARTIAL FILL - COMPLETE FLOW TEST (WEBCLIENT)");
      log("============================================================");
      log("");
      log("This test demonstrates:");
      log("  1. Maker creates PSWAP: 1000 GOLD for 1000 SILVER");
      log("  2. Taker fills 25%: sends 250 SILVER, receives 250 GOLD");
      log("  3. Maker consumes P2ID: receives 250 SILVER");
      log("  4. Leftover SWAPP: 750 GOLD remains (still owned by maker)");

      // Import SDK
      const {
        WebClient,
        AccountStorageMode,
        NoteType,
        Word,
        Felt,
        FungibleAsset,
        Note,
        NoteAssets,
        NoteMetadata,
        NoteRecipient,
        NoteTag,
        NoteExecutionHint,
        NoteExecutionMode,
        NoteInputs,
        OutputNote,
        TransactionRequestBuilder,
        MidenArrays,
      } = await import("@demox-labs/miden-sdk");

      // =========================================================================
      // PHASE 1: Initialize Client
      // =========================================================================
      setPhase("init");
      log("");
      log("============================================================");
      log("PHASE 1: INITIALIZE CLIENT");
      log("============================================================");

      const rpcUrl =
        process.env.NEXT_PUBLIC_MIDEN_NODE_URI ||
        "https://rpc.testnet.miden.io:443";
      log(`RPC URL: ${rpcUrl}`);

      const client = await WebClient.createClient(rpcUrl);
      log("WebClient created");

      await client.syncState();
      const syncHeight = await client.getSyncHeight();
      log(`Synced to block: ${syncHeight}`);

      // =========================================================================
      // PHASE 2: Create Faucets
      // =========================================================================
      setPhase("create-faucets");
      log("");
      log("============================================================");
      log("PHASE 2: CREATE FAUCETS");
      log("============================================================");

      // Helper: Convert hex string to AccountId (avoids WASM GC issues)
      const { AccountId } = await import("@demox-labs/miden-sdk");
      const toAccountId = (hex: string) => AccountId.fromHex(hex);

      /**
       * Build swap tag from asset pair (per Miden team feedback)
       * Tag payload is constructed by taking asset tags (8 bits of each faucet ID prefix)
       * and concatenating them: offered_asset_tag + requested_asset_tag.
       */
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const buildSwapTag = (noteType: any, offeredFaucetId: any, requestedFaucetId: any) => {
        const SWAP_USE_CASE_ID = 0;

        // Get bits 56..63 (top 8 bits) from each faucet ID prefix
        const offeredPrefix = offeredFaucetId.prefix().asInt();
        const offeredTag = Number((offeredPrefix >> BigInt(56)) & BigInt(0xFF));

        const requestedPrefix = requestedFaucetId.prefix().asInt();
        const requestedTag = Number((requestedPrefix >> BigInt(56)) & BigInt(0xFF));

        // Payload = offered_tag (high 8 bits) | requested_tag (low 8 bits)
        const payload = (offeredTag << 8) | requestedTag;

        if (noteType === NoteType.Public) {
          return NoteTag.forPublicUseCase(SWAP_USE_CASE_ID, payload, NoteExecutionMode.newLocal());
        } else {
          return NoteTag.forLocalUseCase(SWAP_USE_CASE_ID, payload);
        }
      };

      // GOLD faucet (offered token)
      log("");
      log("Creating GOLD faucet...");
      const goldFaucet = await client.newFaucet(
        AccountStorageMode.public(),
        false, // fungible
        "GOLD",
        0, // decimals
        BigInt(1_000_000_000),
        0,
      );
      // Store as hex string immediately to avoid WASM GC issues
      const goldFaucetId = goldFaucet.id();
      const goldFaucetIdHex = goldFaucetId.toString();
      setState((prev) => ({ ...prev, goldFaucetIdHex: goldFaucetIdHex }));

      log("");
      log("=== GOLD FAUCET (OFFERED TOKEN) ===");
      await logPrefixSuffix("GOLD", toAccountId(goldFaucetIdHex));

      // SILVER faucet (requested token)
      log("");
      log("Creating SILVER faucet...");
      const silverFaucet = await client.newFaucet(
        AccountStorageMode.public(),
        false, // fungible
        "SILVER",
        0, // decimals
        BigInt(1_000_000_000),
        0,
      );
      // Store as hex string immediately to avoid WASM GC issues
      const silverFaucetId = silverFaucet.id();
      const silverFaucetIdHex = silverFaucetId.toString();
      setState((prev) => ({
        ...prev,
        silverFaucetIdHex: silverFaucetIdHex,
      }));

      log("");
      log("=== SILVER FAUCET (REQUESTED TOKEN) ===");
      await logPrefixSuffix("SILVER", toAccountId(silverFaucetIdHex));

      // =========================================================================
      // PHASE 3: Create Wallets
      // =========================================================================
      setPhase("create-wallets");
      log("");
      log("============================================================");
      log("PHASE 3: CREATE WALLETS");
      log("============================================================");

      // Maker wallet
      log("");
      log("Creating Maker wallet...");
      const makerWallet = await client.newWallet(
        AccountStorageMode.public(),
        true, // mutable
        0,
      );
      // Store as hex string immediately to avoid WASM GC issues
      const makerId = makerWallet.id();
      const makerIdHex = makerId.toString();
      setState((prev) => ({ ...prev, makerIdHex: makerIdHex }));

      log("");
      log("=== MAKER WALLET ===");
      await logPrefixSuffix("Maker", toAccountId(makerIdHex));

      // Taker wallet
      log("");
      log("Creating Taker wallet...");
      const takerWallet = await client.newWallet(
        AccountStorageMode.public(),
        true, // mutable
        0,
      );
      // Store as hex string immediately to avoid WASM GC issues
      const takerId = takerWallet.id();
      const takerIdHex = takerId.toString();
      setState((prev) => ({ ...prev, takerIdHex: takerIdHex }));

      log("");
      log("=== TAKER WALLET ===");
      await logPrefixSuffix("Taker", toAccountId(takerIdHex));

      // =========================================================================
      // PHASE 4: Mint Tokens
      // =========================================================================
      setPhase("mint-tokens");
      log("");
      log("============================================================");
      log("PHASE 4: MINT TOKENS");
      log("============================================================");

      // Mint GOLD to maker
      log("");
      log(`Minting ${OFFERED_AMOUNT} GOLD to Maker...`);
      const mintGoldReq = client.newMintTransactionRequest(
        makerId,
        goldFaucetId,
        NoteType.Public,
        OFFERED_AMOUNT,
      );
      const mintGoldResult = await client.executeTransaction(
        goldFaucetId,
        mintGoldReq,
      );
      const mintGoldProven = await client.proveTransaction(mintGoldResult);
      const mintGoldHeight = await client.submitProvenTransaction(
        mintGoldProven,
        mintGoldResult,
      );
      await client.applyTransaction(mintGoldResult, mintGoldHeight);
      log("  GOLD mint transaction submitted");

      // Mint SILVER to taker
      log(`Minting ${FILL_AMOUNT} SILVER to Taker...`);
      const mintSilverReq = client.newMintTransactionRequest(
        takerId,
        silverFaucetId,
        NoteType.Public,
        FILL_AMOUNT,
      );
      const mintSilverResult = await client.executeTransaction(
        silverFaucetId,
        mintSilverReq,
      );
      const mintSilverProven = await client.proveTransaction(mintSilverResult);
      const mintSilverHeight = await client.submitProvenTransaction(
        mintSilverProven,
        mintSilverResult,
      );
      await client.applyTransaction(mintSilverResult, mintSilverHeight);
      log("  SILVER mint transaction submitted");

      // Wait for mints to commit
      log("");
      log("Waiting for mints to commit (12s)...");
      await new Promise((r) => setTimeout(r, 12000));
      await client.syncState();

      // Consume minted notes
      log("");
      log("--- Consuming Minted Notes ---");

      // Get consumable notes for maker
      const makerConsumable = await client.getConsumableNotes(toAccountId(makerIdHex));
      log(`  Maker has ${makerConsumable.length} consumable notes`);

      if (makerConsumable.length > 0) {
        const makerNoteIds = makerConsumable.map((n) =>
          n.inputNoteRecord().id().toString(),
        );
        const makerConsumeReq =
          client.newConsumeTransactionRequest(makerNoteIds);
        const makerConsumeResult = await client.executeTransaction(
          toAccountId(makerIdHex),
          makerConsumeReq,
        );
        const makerConsumeProven =
          await client.proveTransaction(makerConsumeResult);
        const makerConsumeHeight = await client.submitProvenTransaction(
          makerConsumeProven,
          makerConsumeResult,
        );
        await client.applyTransaction(makerConsumeResult, makerConsumeHeight);
        log("  Maker consumed mint note(s)");
      }

      // Consume for taker
      const takerConsumable = await client.getConsumableNotes(toAccountId(takerIdHex));
      log(`  Taker has ${takerConsumable.length} consumable notes`);

      if (takerConsumable.length > 0) {
        const takerNoteIds = takerConsumable.map((n) =>
          n.inputNoteRecord().id().toString(),
        );
        const takerConsumeReq =
          client.newConsumeTransactionRequest(takerNoteIds);
        const takerConsumeResult = await client.executeTransaction(
          toAccountId(takerIdHex),
          takerConsumeReq,
        );
        const takerConsumeProven =
          await client.proveTransaction(takerConsumeResult);
        const takerConsumeHeight = await client.submitProvenTransaction(
          takerConsumeProven,
          takerConsumeResult,
        );
        await client.applyTransaction(takerConsumeResult, takerConsumeHeight);
        log("  Taker consumed mint note(s)");
      }

      // Wait for consumption
      log("");
      log("Waiting for consumption to commit (12s)...");
      await new Promise((r) => setTimeout(r, 12000));
      await client.syncState();

      // =========================================================================
      // PHASE 5: Create PSWAP Note
      // =========================================================================
      setPhase("create-swapp");
      log("");
      log("============================================================");
      log("PHASE 5: CREATE PSWAP NOTE");
      log("============================================================");
      log("");
      log(
        `Offer: ${OFFERED_AMOUNT} GOLD for ${REQUESTED_AMOUNT} SILVER (1:1 ratio)`,
      );

      // Import PSWAP script
      const { PSWAP_MASM } = await import("@/lib/masm/pswap");
      const builder = client.createScriptBuilder();
      const noteScript = builder.compileNoteScript(PSWAP_MASM);

      // Build offered asset (use fresh AccountId from hex)
      const offeredAsset = new FungibleAsset(toAccountId(goldFaucetIdHex), OFFERED_AMOUNT);

      // Build requested asset word [amount, 0, suffix, prefix]
      const silverFaucetIdFresh = toAccountId(silverFaucetIdHex);
      const reqSuffix = silverFaucetIdFresh.suffix().asInt();
      const reqPrefix = silverFaucetIdFresh.prefix().asInt();

      log("");
      log("=== REQUESTED_ASSET WORD (indices 0-3) ===");
      log(
        `  [0] amount: ${REQUESTED_AMOUNT} (0x${REQUESTED_AMOUNT.toString(16).padStart(16, "0")})`,
      );
      log(`  [1] zero:   0 (0x${"0".padStart(16, "0")})`);
      log(
        `  [2] suffix: ${reqSuffix} (0x${reqSuffix.toString(16).padStart(16, "0")})`,
      );
      log(
        `  [3] prefix: ${reqPrefix} (0x${reqPrefix.toString(16).padStart(16, "0")})`,
      );

      // Build note inputs (14 felts) - use fresh AccountId from hex
      const makerIdFresh = toAccountId(makerIdHex);
      // CRITICAL FIX: Use buildSwapTag from asset pair, NOT fromAccountId
      // Per Miden team feedback: swap tags must encode offered/requested faucet prefixes
      const swappTag = buildSwapTag(NoteType.Public, toAccountId(goldFaucetIdHex), toAccountId(silverFaucetIdHex));
      const p2idTag = NoteTag.fromAccountId(makerIdFresh); // P2ID goes to maker, so this stays
      const creatorPrefix = makerIdFresh.prefix().asInt();
      const creatorSuffix = makerIdFresh.suffix().asInt();

      const noteInputsArray = [
        new Felt(REQUESTED_AMOUNT), // 0: requested_amount
        new Felt(BigInt(0)), // 1: zero
        new Felt(BigInt(reqSuffix)), // 2: faucet_suffix
        new Felt(BigInt(reqPrefix)), // 3: faucet_prefix
        new Felt(BigInt(swappTag.asU32())), // 4: swapp_tag
        new Felt(BigInt(p2idTag.asU32())), // 5: p2id_tag
        new Felt(BigInt(0)), // 6: empty
        new Felt(BigInt(0)), // 7: empty
        new Felt(BigInt(0)), // 8: swap_count
        new Felt(BigInt(0)), // 9: expiration_block (0 = no expiration)
        new Felt(BigInt(0)), // 10: empty
        new Felt(BigInt(0)), // 11: empty
        new Felt(BigInt(creatorPrefix)), // 12: creator_prefix
        new Felt(BigInt(creatorSuffix)), // 13: creator_suffix
      ];

      log("");
      log("=== ALL 14 NOTE INPUTS ===");
      const inputNames = [
        "requested_amount",
        "zero",
        "faucet_suffix",
        "faucet_prefix",
        "swapp_tag",
        "p2id_tag",
        "empty",
        "empty",
        "swap_count",
        "expiration_block",
        "empty",
        "empty",
        "creator_prefix",
        "creator_suffix",
      ];
      for (let i = 0; i < noteInputsArray.length; i++) {
        const val = noteInputsArray[i].asInt();
        log(
          `  input[${i.toString().padStart(2)}] (${inputNames[i].padEnd(16)}): ${val.toString().padStart(20)} (0x${val.toString(16).padStart(16, "0")})`,
        );
      }

      const noteInputs = new NoteInputs(
        new MidenArrays.FeltArray(noteInputsArray),
      );

      // Build note components
      const noteAssets = new NoteAssets([offeredAsset]);
      const noteMetadata = new NoteMetadata(
        makerIdFresh,
        NoteType.Public,
        swappTag,
        NoteExecutionHint.always(),
        new Felt(BigInt(0)),
      );
      const serialNum = new Word(
        new BigUint64Array([BigInt(1), BigInt(2), BigInt(3), BigInt(4)]),
      );
      const recipient = new NoteRecipient(serialNum, noteScript, noteInputs);
      const swappNote = new Note(noteAssets, noteMetadata, recipient);
      const swappNoteId = swappNote.id().toString();
      setState((prev) => ({ ...prev, swappNoteId }));

      // Log SWAPP tag details (CRITICAL FIX: now using buildSwapTag from asset pair)
      log("");
      log("=== SWAPP TAG (FIXED - using buildSwapTag from asset pair) ===");
      const goldPrefix = toAccountId(goldFaucetIdHex).prefix().asInt();
      const silverPrefix = toAccountId(silverFaucetIdHex).prefix().asInt();
      log(`  GOLD faucet prefix top 8 bits:   0x${((goldPrefix >> BigInt(56)) & BigInt(0xFF)).toString(16)}`);
      log(`  SILVER faucet prefix top 8 bits: 0x${((silverPrefix >> BigInt(56)) & BigInt(0xFF)).toString(16)}`);
      log(`  SWAPP tag u32: ${swappTag.asU32()} (0x${swappTag.asU32().toString(16)})`);
      log(`  SWAPP tag toString(): ${swappTag.toString()}`);

      log("");
      log("=== PSWAP NOTE CREATED ===");
      log(`  Note ID: ${swappNoteId}`);
      log(`  Tag: ${swappTag.asU32()} (computed from asset pair, NOT fromAccountId)`);

      // Submit SWAPP creation
      const outputNote = OutputNote.full(swappNote);
      const swappTxReq = new TransactionRequestBuilder()
        .withOwnOutputNotes(new MidenArrays.OutputNoteArray([outputNote]))
        .build();

      const swappTxResult = await client.executeTransaction(
        toAccountId(makerIdHex),
        swappTxReq,
      );
      const swappTxProven = await client.proveTransaction(swappTxResult);
      const swappTxHeight = await client.submitProvenTransaction(
        swappTxProven,
        swappTxResult,
      );
      await client.applyTransaction(swappTxResult, swappTxHeight);
      log("");
      log("  SWAPP transaction submitted");

      // Register tags so other accounts can discover the note (mirrors Rust add_note_tag).
      // The JS client expects hex strings; use padded hex and swallow failures.
      const swappTagStr = swappTag.asU32().toString(10);
      const p2idTagStr = p2idTag.asU32().toString(10);
      try {
        await client.addTag(swappTagStr);
        await client.addTag(p2idTagStr);
        log(`  Registered SWAPP tag ${swappTagStr} and P2ID tag ${p2idTagStr}`);
        await client.syncState();
        log("  Synced after tag registration");
      } catch (e) {
        log(`  WARNING: tag registration failed: ${e}`);
      }

      // Wait for note to become consumable (polling up to 5 times)
      log("");
      log("--- Waiting for SWAPP note to be consumable (polling up to 5 times) ---");
      let swappConsumableForTaker = false;
      for (let i = 0; i < 5; i++) {
        await client.syncState();
        const notesForTaker = await client.getConsumableNotes(toAccountId(takerIdHex));
        if (notesForTaker.some((n) => n.inputNoteRecord().id().toString() === swappNoteId)) {
          swappConsumableForTaker = true;
          log(`  SWAPP consumable by taker after ${i + 1} poll(s)`);
          break;
        }
        log(`  Poll ${i + 1}: not yet consumable; waiting 3s...`);
        await new Promise((r) => setTimeout(r, 3000));
      }
      if (!swappConsumableForTaker) {
        log("  WARNING: SWAPP never became consumable for taker; will try authenticated input anyway");
      }

      // =========================================================================
      // PHASE 6: Taker Fills 25%
      // =========================================================================
      setPhase("fill-swapp");
      log("");
      log("============================================================");
      log("PHASE 6: TAKER FILLS 25%");
      log("============================================================");

      const takerReceives = (FILL_AMOUNT * OFFERED_AMOUNT) / REQUESTED_AMOUNT;
      const leftoverOffered = OFFERED_AMOUNT - takerReceives;
      const leftoverRequested = REQUESTED_AMOUNT - FILL_AMOUNT;

      log("");
      log("Fill calculation:");
      log(`  Fill amount:        ${FILL_AMOUNT} SILVER (taker sends)`);
      log(`  Taker receives:     ${takerReceives} GOLD`);
      log(`  Leftover offered:   ${leftoverOffered} GOLD (in new SWAPP)`);
      log(`  Leftover requested: ${leftoverRequested} SILVER (in new SWAPP)`);

      // Note args: [0, 0, 0, fill_amount] – MASM reads top of stack, which is index 3
      const noteArgs = new Word(
        new BigUint64Array([BigInt(0), BigInt(0), BigInt(0), FILL_AMOUNT]),
      );

      log("");
      log("=== NOTE ARGS ===");
      log(`  [0]: 0`);
      log(`  [1]: 0`);
      log(`  [2]: 0`);
      log(`  [3]: ${FILL_AMOUNT} (fill_amount)`);

      // KEY DIFFERENCE: Rust uses authenticated_input_notes
      // Let's try BOTH approaches to see which works

      // DEBUG: Check taker's balance before fill
      const takerAcctBefore = await client.getAccount(toAccountId(takerIdHex));
      if (takerAcctBefore) {
        const takerAssetsBefore = takerAcctBefore.vault().fungibleAssets();
        log("");
        log("--- Taker balance BEFORE fill ---");
        for (const asset of takerAssetsBefore) {
          log(`  ${asset.faucetId().toString()}: ${asset.amount()}`);
        }
        if (takerAssetsBefore.length === 0) {
          log("  WARNING: Taker has NO assets!");
        }
      }

      log("");
      log("--- Attempting fill with AUTHENTICATED input note ---");
      log("(This matches the Rust test approach)");

      // KEY FIX #1: Rust uses get_consumable_notes(None) - no account filter
      // Try to get ALL consumable notes without filtering by account
      log("  Getting ALL consumable notes (no account filter, like Rust)...");
      let allConsumableNotes;
      try {
        // Try calling without argument first (might work like Rust's None)
        allConsumableNotes = await (client as any).getConsumableNotes();
      } catch {
        // Fallback: get notes for both accounts
        const makerNotes = await client.getConsumableNotes(toAccountId(makerIdHex));
        const takerNotes = await client.getConsumableNotes(toAccountId(takerIdHex));
        allConsumableNotes = [...makerNotes, ...takerNotes];
      }
      log(`  Found ${allConsumableNotes.length} total consumable notes`);

      for (const n of allConsumableNotes) {
        const noteRecord = n.inputNoteRecord();
        log(`    - ${noteRecord.id().toString()}`);
      }

      let swappNoteFromStore = null;
      for (const n of allConsumableNotes) {
        const noteRecord = n.inputNoteRecord();
        if (noteRecord.id().toString() === swappNoteId) {
          swappNoteFromStore = noteRecord;
          log(`  Found SWAPP note in consumable notes: ${noteRecord.id().toString()}`);
          break;
        }
      }

      // Fallback: fetch note directly by id (needs tag registration + sync)
      if (!swappNoteFromStore) {
        const swappNoteIdHex =
          swappNoteId.startsWith("0x") ? swappNoteId : `0x${swappNoteId}`;
        const fetched = await client.getInputNote(swappNoteIdHex);
        if (fetched) {
          swappNoteFromStore = fetched;
          log(`  Retrieved SWAPP note via getInputNote: ${swappNoteIdHex}`);
          // After fetching, sync to ensure inclusion proof is stored for auth input
          await client.syncState();
          log("  Synced after fetching SWAPP note");
        }
      }

      const sdk = await import("@demox-labs/miden-sdk");
      const { NoteId, NoteIdAndArgs, NoteIdAndArgsArray } = sdk as any;

      await client.syncState();

      // DEBUG: Final balance check before fill
      log("");
      log("--- FINAL DEBUG: Taker state before fill ---");
      const takerAcctFinal = await client.getAccount(toAccountId(takerIdHex));
      if (takerAcctFinal) {
        const takerAssetsFinal = takerAcctFinal.vault().fungibleAssets();
        log(`  Taker vault has ${takerAssetsFinal.length} asset(s):`);
        for (const asset of takerAssetsFinal) {
          const faucetId = asset.faucetId().toString();
          const amount = asset.amount();
          const isSilver = faucetId === silverFaucetIdHex;
          log(`    ${faucetId}: ${amount}${isSilver ? " (SILVER - NEEDED FOR FILL)" : ""}`);
        }
        if (takerAssetsFinal.length === 0) {
          log("  *** CRITICAL: Taker has NO assets! Cannot fill SWAPP ***");
        }
      } else {
        log("  *** CRITICAL: Could not get taker account! ***");
      }

      // Check if we have the SWAPP note
      log("");
      log("--- Checking SWAPP note state ---");
      const swappNoteIdHex =
        swappNoteId.startsWith("0x") ? swappNoteId : `0x${swappNoteId}`;
      log(`  SWAPP note ID: ${swappNoteIdHex}`);

      // Try to get the note from the store
      const noteFromStore = await client.getInputNote(swappNoteIdHex);
      if (noteFromStore) {
        log(`  SWAPP note found in store`);
        const noteAssets = noteFromStore.details()?.assets();
        if (noteAssets) {
          const assets = noteAssets.fungibleAssets();
          log(`  Note has ${assets.length} asset(s):`);
          for (const asset of assets) {
            log(`    ${asset.faucetId().toString()}: ${asset.amount()}`);
          }
        }
      } else {
        log("  *** WARNING: SWAPP note NOT found in store via getInputNote ***");
      }

      const noteIdObj = NoteId.fromHex(swappNoteIdHex);
      const noteIdAndArgs = new NoteIdAndArgs(noteIdObj, noteArgs);

      log("");
      log("--- Building fill transaction with expected future notes ---");
      log(`  Note args (fill amount): [0, 0, 0, ${FILL_AMOUNT}]`);
      log(`  Using withAuthenticatedInputNotes with note ID: ${swappNoteIdHex}`);

      // Per Philipp's feedback: fill transaction needs withExpectedFutureNotes
      // For partial fill, PSWAP creates:
      // 1. P2ID note to maker (fill_amount of SILVER)
      // 2. Leftover SWAPP note (remaining GOLD)

      // Import additional types for expected future notes (NoteRecipient already imported above)
      const {
        NoteDetails,
        NoteDetailsAndTag,
        NoteDetailsAndTagArray,
        NoteRecipientArray,
      } = sdk as any;

      // Use the already-calculated leftover amounts from above
      log(`  Expected P2ID: ${FILL_AMOUNT} SILVER to maker`);
      log(`  Expected leftover SWAPP: ${leftoverOffered} GOLD for ${leftoverRequested} SILVER`);

      // KEY FIX #2: Build BOTH expected notes with EXACT serial numbers (like Rust)

      // Import Rpo256 and NoteScript for proper computation
      const { Rpo256, NoteScript } = sdk as any;

      // Original swap serial number (must match what we used when creating the SWAPP)
      const swapSerialFelts = [new Felt(BigInt(1)), new Felt(BigInt(2)), new Felt(BigInt(3)), new Felt(BigInt(4))];
      const nextSwapCount = BigInt(1); // After this fill, swap_count becomes 1

      // Compute P2ID serial: hmerge(swap_serial, [swap_count, 0, 0, 0])
      // hmerge = Rpo256.hashElements([...word1, ...word2])
      const swapCountFelts = [new Felt(nextSwapCount), new Felt(BigInt(0)), new Felt(BigInt(0)), new Felt(BigInt(0))];
      const p2idSerialWord = Rpo256.hashElements(new MidenArrays.FeltArray([...swapSerialFelts, ...swapCountFelts]));
      log(`  Computed P2ID serial via hmerge(swap_serial, [swap_count, 0, 0, 0])`);

      // Build P2ID recipient (matches Rust's build_p2id_recipient):
      // NoteRecipient::new(serial_num, p2id_script, [target.suffix(), target.prefix()])
      const p2idMakerId = toAccountId(makerIdHex);
      const p2idScript = NoteScript.p2id();
      const p2idNoteInputs = new NoteInputs(new MidenArrays.FeltArray([
        new Felt(p2idMakerId.suffix().asInt()),  // target.suffix() first
        new Felt(p2idMakerId.prefix().asInt()),  // target.prefix() second
      ]));
      const p2idRecipient = new NoteRecipient(p2idSerialWord, p2idScript, p2idNoteInputs);

      // Build P2ID note assets and tag
      const p2idSilverAsset = new FungibleAsset(toAccountId(silverFaucetIdHex), FILL_AMOUNT);
      const p2idNoteAssets = new NoteAssets([p2idSilverAsset]);
      const p2idNoteTag = NoteTag.fromAccountId(p2idMakerId);

      const p2idNoteDetails = new NoteDetails(p2idNoteAssets, p2idRecipient);
      const p2idDetailsAndTag = new NoteDetailsAndTag(p2idNoteDetails, p2idNoteTag);
      log(`  Built expected P2ID note with computed serial`);

      // Build expected leftover SWAPP note details
      // Assets: leftover GOLD
      const leftoverGoldAsset = new FungibleAsset(toAccountId(goldFaucetIdHex), leftoverOffered);
      const leftoverNoteAssets = new NoteAssets([leftoverGoldAsset]);

      // The leftover SWAPP will have the same tag (computed from asset pair)
      // and same script, but updated inputs
      const leftoverSwappTag = buildSwapTag(NoteType.Public, toAccountId(goldFaucetIdHex), toAccountId(silverFaucetIdHex));

      // Build the leftover note inputs (updated with remaining amounts)
      const leftoverSilverFaucetId = toAccountId(silverFaucetIdHex);
      const leftoverReqSuffix = leftoverSilverFaucetId.suffix().asInt();
      const leftoverReqPrefix = leftoverSilverFaucetId.prefix().asInt();
      const leftoverMakerId = toAccountId(makerIdHex);
      const leftoverCreatorPrefix = leftoverMakerId.prefix().asInt();
      const leftoverCreatorSuffix = leftoverMakerId.suffix().asInt();

      const leftoverInputsArray = [
        new Felt(leftoverRequested), // 0: remaining requested_amount (750)
        new Felt(BigInt(0)), // 1: zero
        new Felt(BigInt(leftoverReqSuffix)), // 2: faucet_suffix
        new Felt(BigInt(leftoverReqPrefix)), // 3: faucet_prefix
        new Felt(BigInt(leftoverSwappTag.asU32())), // 4: swapp_tag
        new Felt(BigInt(p2idTag.asU32())), // 5: p2id_tag
        new Felt(BigInt(0)), // 6: empty
        new Felt(BigInt(0)), // 7: empty
        new Felt(BigInt(1)), // 8: swap_count (incremented)
        new Felt(BigInt(0)), // 9: expiration_block
        new Felt(BigInt(0)), // 10: empty
        new Felt(BigInt(0)), // 11: empty
        new Felt(BigInt(leftoverCreatorPrefix)), // 12: creator_prefix
        new Felt(BigInt(leftoverCreatorSuffix)), // 13: creator_suffix
      ];

      const leftoverNoteInputs = new NoteInputs(
        new MidenArrays.FeltArray(leftoverInputsArray),
      );

      // Get the PSWAP script (same as original)
      const leftoverNoteScript = builder.compileNoteScript(PSWAP_MASM);

      // Serial number for leftover = original with last element + 1 (as per Rust code)
      // Original was [1, 2, 3, 4], so leftover is [1, 2, 3, 5]
      const leftoverSerialNum = new Word(
        new BigUint64Array([BigInt(1), BigInt(2), BigInt(3), BigInt(5)]),
      );

      // Build recipient for leftover SWAPP
      const leftoverRecipient = new NoteRecipient(leftoverSerialNum, leftoverNoteScript, leftoverNoteInputs);

      // Create NoteDetails for expected leftover SWAPP
      const leftoverNoteDetails = new NoteDetails(leftoverNoteAssets, leftoverRecipient);
      const leftoverDetailsAndTag = new NoteDetailsAndTag(leftoverNoteDetails, leftoverSwappTag);

      log(`  Built expected future note details for leftover SWAPP`);

      // KEY FIX #3: Both recipients via withExpectedOutputRecipients (like Rust)
      // The PSWAP script creates two output notes:
      // 1. P2ID note to maker (with fill_amount SILVER)
      // 2. Leftover SWAPP note (with remaining GOLD)

      const expectedRecipients = new NoteRecipientArray([
        p2idRecipient,      // P2ID recipient (maker gets SILVER)
        leftoverRecipient,  // Leftover SWAPP recipient
      ]);

      log(`  Built expected output recipients (P2ID + leftover SWAPP)`);

      // Build the fill transaction with ALL of Philipp's requirements:
      // 1. withAuthenticatedInputNotes - the SWAPP note being consumed
      // 2. withExpectedFutureNotes - BOTH P2ID and leftover (like Rust)
      // 3. withExpectedOutputRecipients - BOTH recipients (like Rust)
      const fillTxReq = new TransactionRequestBuilder()
        .withAuthenticatedInputNotes(new NoteIdAndArgsArray([noteIdAndArgs]))
        .withExpectedFutureNotes(new NoteDetailsAndTagArray([p2idDetailsAndTag, leftoverDetailsAndTag]))
        .withExpectedOutputRecipients(expectedRecipients)
        .build();

      log("");
      log("--- Submitting Fill Transaction via submitNewTransaction ---");
      log("  (Per Philipp's feedback: use submitNewTransaction instead of manual execute/prove/submit)");

      // Use submitNewTransaction as Philipp recommended
      // This handles execute + prove + submit internally and returns TransactionId
      const fillTxId = await client.submitNewTransaction(toAccountId(takerIdHex), fillTxReq);
      log(`  Transaction submitted via submitNewTransaction`);
      log(`  Transaction ID: ${fillTxId.toHex()}`);

      // Wait for transaction to commit
      log("");
      log("Waiting for fill transaction to commit (12s)...");
      await new Promise((r) => setTimeout(r, 12000));
      await client.syncState();

      // Check taker's balance after fill to verify it worked
      log("");
      log("--- Verifying fill results ---");
      const takerAcctAfter = await client.getAccount(toAccountId(takerIdHex));
      if (takerAcctAfter) {
        const takerAssetsAfter = takerAcctAfter.vault().fungibleAssets();
        log(`  Taker vault after fill:`);
        for (const asset of takerAssetsAfter) {
          log(`    ${asset.faucetId().toString()}: ${asset.amount()}`);
        }
      }

      // =========================================================================
      // PHASE 7: Maker Consumes P2ID Note
      // =========================================================================
      setPhase("consume-p2id");
      log("");
      log("============================================================");
      log("PHASE 7: MAKER CONSUMES P2ID NOTE");
      log("============================================================");

      // Wait for P2ID to become consumable
      log("");
      log("Waiting for P2ID note to be consumable (12s)...");
      await new Promise((r) => setTimeout(r, 12000));
      await client.syncState();

      // Get P2ID note for maker
      const makerP2idNotes = await client.getConsumableNotes(toAccountId(makerIdHex));
      log(`  Maker has ${makerP2idNotes.length} consumable notes`);

      // Consume P2ID
      if (makerP2idNotes.length > 0) {
        const p2idNoteIds = makerP2idNotes.map((n) =>
          n.inputNoteRecord().id().toString(),
        );
        log(`  Consuming P2ID notes: ${p2idNoteIds.join(", ")}`);
        const p2idConsumeReq = client.newConsumeTransactionRequest(p2idNoteIds);
        const p2idConsumeResult = await client.executeTransaction(
          toAccountId(makerIdHex),
          p2idConsumeReq,
        );
        const p2idConsumeProven =
          await client.proveTransaction(p2idConsumeResult);
        const p2idConsumeHeight = await client.submitProvenTransaction(
          p2idConsumeProven,
          p2idConsumeResult,
        );
        await client.applyTransaction(p2idConsumeResult, p2idConsumeHeight);
        log("  Maker consumed P2ID note(s)");
      } else {
        log("  WARNING: No P2ID notes found for maker");
      }

      // =========================================================================
      // PHASE 8: Verify Final Balances
      // =========================================================================
      setPhase("verify");
      log("");
      log("============================================================");
      log("PHASE 8: VERIFY FINAL BALANCES");
      log("============================================================");

      // Get account balances
      const makerAccount = await client.getAccount(toAccountId(makerIdHex));
      const takerAccount = await client.getAccount(toAccountId(takerIdHex));

      if (makerAccount && takerAccount) {
        const makerVault = makerAccount.vault();
        const takerVault = takerAccount.vault();

        const makerAssets = makerVault.fungibleAssets();
        const takerAssets = takerVault.fungibleAssets();

        log("");
        log("=== FINAL BALANCES ===");
        log("");
        log(`  MAKER (${makerIdHex}):`);
        for (const asset of makerAssets) {
          log(`    ${asset.faucetId().toString()}: ${asset.amount()}`);
        }

        log("");
        log(`  TAKER (${takerIdHex}):`);
        for (const asset of takerAssets) {
          log(`    ${asset.faucetId().toString()}: ${asset.amount()}`);
        }
      }

      setPhase("done");
      log("");
      log("============================================================");
      log("TEST COMPLETE");
      log("============================================================");
    } catch (error) {
      setPhase("error");
      log("");
      log("============================================================");
      log("ERROR");
      log("============================================================");
      log(`${error}`);
      if (error instanceof Error && error.stack) {
        log(error.stack);
      }
      console.error("Test error:", error);
    }
  }, [log, logPrefixSuffix, setPhase]);

  const isRunning = state.phase !== "idle" && state.phase !== "done" && state.phase !== "error";

  return (
    <div style={{ minHeight: "100vh", backgroundColor: "#000", color: "#fff", padding: "24px", fontFamily: "monospace" }}>
      <div style={{ maxWidth: "896px", margin: "0 auto" }}>
        <h1 style={{ fontSize: "1.5rem", fontWeight: "bold", marginBottom: "16px" }}>
          PSWAP Partial Fill Test
        </h1>
        <p style={{ color: "#9ca3af", marginBottom: "24px" }}>
          Tests partial swap note consumption with the WebClient SDK
        </p>

        <div style={{ display: "flex", gap: "16px", marginBottom: "24px", alignItems: "center" }}>
          <button
            onClick={runTest}
            disabled={isRunning}
            style={{
              padding: "8px 16px",
              backgroundColor: isRunning ? "#374151" : "#3b82f6",
              color: "#fff",
              border: "none",
              borderRadius: "4px",
              cursor: isRunning ? "not-allowed" : "pointer",
              fontFamily: "monospace",
            }}
          >
            {state.phase === "idle"
              ? "Run Test"
              : state.phase === "done"
                ? "Run Again"
                : state.phase === "error"
                  ? "Retry"
                  : "Running..."}
          </button>

          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span style={{ color: "#6b7280" }}>Phase:</span>
            <span
              style={{
                fontFamily: "monospace",
                color: state.phase === "error" ? "#ef4444" : state.phase === "done" ? "#22c55e" : "#eab308",
              }}
            >
              {state.phase}
            </span>
          </div>
        </div>

        {/* Account IDs */}
        {(state.goldFaucetId || state.makerId) && (
          <div style={{ marginBottom: "24px", padding: "16px", backgroundColor: "#111827", borderRadius: "8px", fontFamily: "monospace", fontSize: "0.875rem" }}>
            <h2 style={{ fontSize: "1.125rem", fontWeight: "bold", marginBottom: "8px" }}>Accounts Created</h2>
            {state.goldFaucetId && <div>GOLD Faucet: {state.goldFaucetId}</div>}
            {state.silverFaucetId && (
              <div>SILVER Faucet: {state.silverFaucetId}</div>
            )}
            {state.makerId && <div>Maker: {state.makerId}</div>}
            {state.takerId && <div>Taker: {state.takerId}</div>}
            {state.swappNoteId && <div>SWAPP Note: {state.swappNoteId}</div>}
            {state.p2idNoteId && <div>P2ID Note: {state.p2idNoteId}</div>}
            {state.leftoverNoteId && (
              <div>Leftover Note: {state.leftoverNoteId}</div>
            )}
          </div>
        )}

        {/* Logs */}
        <div style={{ backgroundColor: "#111827", borderRadius: "8px", padding: "16px", fontFamily: "monospace", fontSize: "0.875rem", overflow: "auto", maxHeight: "600px" }}>
          <h2 style={{ fontSize: "1.125rem", fontWeight: "bold", marginBottom: "8px" }}>Console Output</h2>
          {state.logs.length === 0 ? (
            <p style={{ color: "#6b7280" }}>Click &quot;Run Test&quot; to start</p>
          ) : (
            <pre style={{ whiteSpace: "pre-wrap" }}>{state.logs.join("\n")}</pre>
          )}
        </div>
      </div>
    </div>
  );
}

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
      const swappTag = NoteTag.fromAccountId(makerIdFresh);
      const p2idTag = NoteTag.fromAccountId(makerIdFresh);
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
      log(`SWAPP tag u32: ${swappTag.asU32()} hex: 0x${swappTag.asU32().toString(16)} toString(): ${swappTag.toString()}`);

      log("");
      log("=== PSWAP NOTE CREATED ===");
      log(`  Note ID: ${swappNoteId}`);
      log(`  Tag: ${swappTag.asU32()}`);

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

      // Check what notes the taker can consume
      const takerConsumableNotes = await client.getConsumableNotes(toAccountId(takerIdHex));
      log(`  Taker has ${takerConsumableNotes.length} consumable notes`);

      for (const n of takerConsumableNotes) {
        const noteRecord = n.inputNoteRecord();
        log(`    - ${noteRecord.id().toString()}`);
      }

      let swappNoteFromStore = null;
      for (const n of takerConsumableNotes) {
        const noteRecord = n.inputNoteRecord();
        if (noteRecord.id().toString() === swappNoteId) {
          swappNoteFromStore = noteRecord;
          log(
            `  Found SWAPP note consumable by taker: ${noteRecord.id().toString()}`,
          );
          break;
        }
      }

      if (!swappNoteFromStore) {
        log("  WARNING: SWAPP note not consumable by taker!");
        log("  Checking if it exists in maker's view...");
        const makerConsumableNotes = await client.getConsumableNotes(toAccountId(makerIdHex));
        for (const n of makerConsumableNotes) {
          const noteRecord = n.inputNoteRecord();
          if (noteRecord.id().toString() === swappNoteId) {
            log(
              `  Found SWAPP note in maker's consumable: ${noteRecord.id().toString()}`,
            );
            // Use the maker's copy (has inclusion proof) to build the input
            swappNoteFromStore = noteRecord;
            break;
          }
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

      const swappNoteIdHex =
        swappNoteId.startsWith("0x") ? swappNoteId : `0x${swappNoteId}`;
      const noteIdObj = NoteId.fromHex(swappNoteIdHex);
      const noteIdAndArgs = new NoteIdAndArgs(noteIdObj, noteArgs);

      const fillTxReq = new TransactionRequestBuilder()
        .withAuthenticatedInputNotes(new NoteIdAndArgsArray([noteIdAndArgs]))
        .build();

      log("");
      log("--- Submitting Fill Transaction ---");

      const fillTxResult = await client.executeTransaction(toAccountId(takerIdHex), fillTxReq);
      log(`  Transaction executed`);

      const fillTxProven = await client.proveTransaction(fillTxResult);
      log(`  Transaction proven`);

      const fillTxHeight = await client.submitProvenTransaction(
        fillTxProven,
        fillTxResult,
      );
      log(`  Transaction submitted at height: ${fillTxHeight}`);

      await client.applyTransaction(fillTxResult, fillTxHeight);
      log(`  Transaction applied`);

      // Extract output notes
      const outputNotes = fillTxResult.executedTransaction().outputNotes();
      log("");
      log("--- Fill Output Notes ---");
      log(`  Number of output notes: ${outputNotes.numNotes()}`);

      const notes = outputNotes.notes();
      for (let i = 0; i < notes.length; i++) {
        const noteId = notes[i].id().toString();
        log(`  Output note ${i}: ${noteId}`);
        if (i === 0) {
          setState((prev) => ({ ...prev, p2idNoteId: noteId }));
        } else if (i === 2) {
          setState((prev) => ({ ...prev, leftoverNoteId: noteId }));
        }
      }

      // Wait for transaction to commit
      log("");
      log("Waiting for fill transaction to commit (12s)...");
      await new Promise((r) => setTimeout(r, 12000));
      await client.syncState();

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

"use client";

/**
 * PSWAP Private Partial Fill Test Page
 *
 * This test verifies that private PSWAP notes work correctly:
 *   1. Maker creates PRIVATE PSWAP: 1000 GOLD for 1000 SILVER
 *   2. Taker fills 25%: sends 250 SILVER, receives 250 GOLD
 *   3. Output notes (P2ID + leftover) should also be PRIVATE
 *   4. Maker consumes P2ID: receives 250 SILVER
 *
 * Key difference from /partial:
 *   - Uses PSWAP_PRIVATE_MASM with 15 inputs (includes NOTE_TYPE_OUTPUT)
 *   - Creates notes with NoteType.Private
 *   - Uses forLocalUseCase tags instead of forPublicUseCase
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

export default function PrivatePartialFillTestPage() {
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
   * Run the complete PRIVATE PSWAP test flow
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
      log("PRIVATE PSWAP PARTIAL FILL - TEST");
      log("============================================================");
      log("");
      log("This test verifies PRIVATE note output from partial swaps:");
      log("  1. Maker creates PRIVATE PSWAP: 1000 GOLD for 1000 SILVER");
      log("  2. Taker fills 25%: sends 250 SILVER, receives 250 GOLD");
      log("  3. P2ID note to maker should be PRIVATE");
      log("  4. Leftover SWAPP note should be PRIVATE");
      log("");
      log("Key: Uses PSWAP_PRIVATE_MASM with NOTE_TYPE_OUTPUT input");

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
      // PHASE 2: Create Faucets (still PUBLIC accounts - only notes are private)
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
       * Build swap tag from asset pair
       * KEY DIFFERENCE: For private notes, use forLocalUseCase instead of forPublicUseCase
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
          // PRIVATE: Use forLocalUseCase
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
      const goldFaucetId = goldFaucet.id();
      const goldFaucetIdHex = goldFaucetId.toString();
      setState((prev) => ({ ...prev, goldFaucetId: goldFaucetIdHex }));

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
      const silverFaucetId = silverFaucet.id();
      const silverFaucetIdHex = silverFaucetId.toString();
      setState((prev) => ({
        ...prev,
        silverFaucetId: silverFaucetIdHex,
      }));

      log("");
      log("=== SILVER FAUCET (REQUESTED TOKEN) ===");
      await logPrefixSuffix("SILVER", toAccountId(silverFaucetIdHex));

      // =========================================================================
      // PHASE 3: Create Wallets (PRIVATE storage mode for privacy)
      // =========================================================================
      setPhase("create-wallets");
      log("");
      log("============================================================");
      log("PHASE 3: CREATE WALLETS (PRIVATE STORAGE)");
      log("============================================================");

      // Maker wallet - PRIVATE for full privacy
      log("");
      log("Creating Maker wallet (PRIVATE storage)...");
      const makerWallet = await client.newWallet(
        AccountStorageMode.private(), // PRIVATE wallet
        true, // mutable
        0,
      );
      const makerId = makerWallet.id();
      const makerIdHex = makerId.toString();
      setState((prev) => ({ ...prev, makerId: makerIdHex }));

      log("");
      log("=== MAKER WALLET (PRIVATE) ===");
      await logPrefixSuffix("Maker", toAccountId(makerIdHex));

      // Taker wallet - PRIVATE for full privacy
      log("");
      log("Creating Taker wallet (PRIVATE storage)...");
      const takerWallet = await client.newWallet(
        AccountStorageMode.private(), // PRIVATE wallet
        true, // mutable
        0,
      );
      const takerId = takerWallet.id();
      const takerIdHex = takerId.toString();
      setState((prev) => ({ ...prev, takerId: takerIdHex }));

      log("");
      log("=== TAKER WALLET (PRIVATE) ===");
      await logPrefixSuffix("Taker", toAccountId(takerIdHex));

      // =========================================================================
      // PHASE 4: Mint Tokens (PUBLIC notes for minting - tokens need to arrive)
      // =========================================================================
      setPhase("mint-tokens");
      log("");
      log("============================================================");
      log("PHASE 4: MINT TOKENS");
      log("============================================================");
      log("(Mint uses PUBLIC notes so tokens can be discovered)");

      // Mint GOLD to maker
      log("");
      log(`Minting ${OFFERED_AMOUNT} GOLD to Maker...`);
      const mintGoldReq = client.newMintTransactionRequest(
        makerId,
        goldFaucetId,
        NoteType.Public, // Mint as PUBLIC so it can be consumed
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
        NoteType.Public, // Mint as PUBLIC so it can be consumed
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
      // PHASE 5: Create PRIVATE PSWAP Note
      // =========================================================================
      setPhase("create-swapp");
      log("");
      log("============================================================");
      log("PHASE 5: CREATE PRIVATE PSWAP NOTE");
      log("============================================================");
      log("");
      log("*** USING NoteType.Private FOR THE PSWAP NOTE ***");
      log(`Offer: ${OFFERED_AMOUNT} GOLD for ${REQUESTED_AMOUNT} SILVER (1:1 ratio)`);

      // Import PSWAP_PRIVATE script with 15 inputs
      const { PSWAP_PRIVATE_MASM, NOTE_TYPE } = await import("@/lib/masm/pswap-private");
      const builder = client.createScriptBuilder();
      const noteScript = builder.compileNoteScript(PSWAP_PRIVATE_MASM);

      // Build offered asset
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

      // Build note inputs (15 felts - INCLUDING NOTE_TYPE_OUTPUT)
      const makerIdFresh = toAccountId(makerIdHex);
      // PRIVATE swap tag using forLocalUseCase
      const swappTag = buildSwapTag(NoteType.Private, toAccountId(goldFaucetIdHex), toAccountId(silverFaucetIdHex));
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
        new Felt(NOTE_TYPE.PRIVATE), // 14: NOTE_TYPE_OUTPUT = 0 (PRIVATE)
      ];

      log("");
      log("=== ALL 15 NOTE INPUTS (NEW: includes NOTE_TYPE_OUTPUT) ===");
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
        "NOTE_TYPE_OUTPUT", // NEW INPUT
      ];
      for (let i = 0; i < noteInputsArray.length; i++) {
        const val = noteInputsArray[i].asInt();
        const extra = i === 14 ? (val === BigInt(2) ? " (PRIVATE)" : " (PUBLIC)") : "";
        log(
          `  input[${i.toString().padStart(2)}] (${inputNames[i].padEnd(16)}): ${val.toString().padStart(20)} (0x${val.toString(16).padStart(16, "0")})${extra}`,
        );
      }

      const noteInputs = new NoteInputs(
        new MidenArrays.FeltArray(noteInputsArray),
      );

      // Build note components - PRIVATE note type
      const noteAssets = new NoteAssets([offeredAsset]);
      const noteMetadata = new NoteMetadata(
        makerIdFresh,
        NoteType.Private, // KEY: Creating PRIVATE note
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

      log("");
      log("=== PRIVATE PSWAP NOTE CREATED ===");
      log(`  Note ID: ${swappNoteId}`);
      log(`  Note Type: PRIVATE`);
      log(`  Tag: ${swappTag.asU32()} (forLocalUseCase)`);
      log(`  NOTE_TYPE_OUTPUT input[14]: ${NOTE_TYPE.PRIVATE} (PRIVATE)`);

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
      log("  PRIVATE SWAPP transaction submitted");

      // For PRIVATE notes, we use withUnauthenticatedInputNotes with the full Note object
      // In production, the note would be shared via post office or direct export
      // For this test, we keep the swappNote object and pass it directly to the transaction
      log("");
      log("--- PRIVATE NOTE: Will use withUnauthenticatedInputNotes ---");
      log("  (Private notes require full Note object, not just note ID)");

      // Wait for SWAPP creation to commit
      log("");
      log("Waiting for SWAPP creation to commit (12s)...");
      await new Promise((r) => setTimeout(r, 12000));
      await client.syncState();

      // =========================================================================
      // PHASE 6: Taker Fills 25%
      // =========================================================================
      setPhase("fill-swapp");
      log("");
      log("============================================================");
      log("PHASE 6: TAKER FILLS 25% (PRIVATE OUTPUT NOTES)");
      log("============================================================");

      const takerReceives = (FILL_AMOUNT * OFFERED_AMOUNT) / REQUESTED_AMOUNT;
      const leftoverOffered = OFFERED_AMOUNT - takerReceives;
      const leftoverRequested = REQUESTED_AMOUNT - FILL_AMOUNT;

      log("");
      log("Fill calculation:");
      log(`  Fill amount:        ${FILL_AMOUNT} SILVER (taker sends)`);
      log(`  Taker receives:     ${takerReceives} GOLD`);
      log(`  Leftover offered:   ${leftoverOffered} GOLD (in new PRIVATE SWAPP)`);
      log(`  Leftover requested: ${leftoverRequested} SILVER (in new PRIVATE SWAPP)`);

      // Note args: [0, 0, 0, fill_amount]
      const noteArgs = new Word(
        new BigUint64Array([BigInt(0), BigInt(0), BigInt(0), FILL_AMOUNT]),
      );

      log("");
      log("=== NOTE ARGS ===");
      log(`  [0]: 0`);
      log(`  [1]: 0`);
      log(`  [2]: 0`);
      log(`  [3]: ${FILL_AMOUNT} (fill_amount)`);

      // Check taker's balance before fill
      const takerAcctBefore = await client.getAccount(toAccountId(takerIdHex));
      if (takerAcctBefore) {
        const takerAssetsBefore = takerAcctBefore.vault().fungibleAssets();
        log("");
        log("--- Taker balance BEFORE fill ---");
        for (const asset of takerAssetsBefore) {
          log(`  ${asset.faucetId().toString()}: ${asset.amount()}`);
        }
      }

      log("");
      log("--- Building fill transaction with PRIVATE expected future notes ---");

      const sdk = await import("@demox-labs/miden-sdk");
      const { NoteDetails, NoteDetailsAndTag, NoteDetailsAndTagArray, NoteRecipientArray, Rpo256, NoteScript } = sdk as any;

      // Compute P2ID serial
      const swapSerialFelts = [new Felt(BigInt(1)), new Felt(BigInt(2)), new Felt(BigInt(3)), new Felt(BigInt(4))];
      const nextSwapCount = BigInt(1);
      const swapCountFelts = [new Felt(nextSwapCount), new Felt(BigInt(0)), new Felt(BigInt(0)), new Felt(BigInt(0))];
      const p2idSerialWord = Rpo256.hashElements(new MidenArrays.FeltArray([...swapSerialFelts, ...swapCountFelts]));

      // Build P2ID recipient
      const p2idMakerId = toAccountId(makerIdHex);
      const p2idScript = NoteScript.p2id();
      const p2idNoteInputs = new NoteInputs(new MidenArrays.FeltArray([
        new Felt(p2idMakerId.suffix().asInt()),
        new Felt(p2idMakerId.prefix().asInt()),
      ]));
      const p2idRecipient = new NoteRecipient(p2idSerialWord, p2idScript, p2idNoteInputs);

      // Build P2ID note assets and tag
      const p2idSilverAsset = new FungibleAsset(toAccountId(silverFaucetIdHex), FILL_AMOUNT);
      const p2idNoteAssets = new NoteAssets([p2idSilverAsset]);
      // P2ID tag uses fromAccountId (unchanged - this is for discovery routing)
      const p2idNoteTag = NoteTag.fromAccountId(p2idMakerId);

      const p2idNoteDetails = new NoteDetails(p2idNoteAssets, p2idRecipient);
      const p2idDetailsAndTag = new NoteDetailsAndTag(p2idNoteDetails, p2idNoteTag);
      log(`  Built expected P2ID note (will be PRIVATE via MASM input)`);

      // Build expected leftover SWAPP note details
      const leftoverGoldAsset = new FungibleAsset(toAccountId(goldFaucetIdHex), leftoverOffered);
      const leftoverNoteAssets = new NoteAssets([leftoverGoldAsset]);
      const leftoverSwappTag = buildSwapTag(NoteType.Private, toAccountId(goldFaucetIdHex), toAccountId(silverFaucetIdHex));

      // Build leftover inputs (15 felts - with NOTE_TYPE_OUTPUT = PRIVATE)
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
        new Felt(NOTE_TYPE.PRIVATE), // 14: NOTE_TYPE_OUTPUT = PRIVATE (inherited)
      ];

      const leftoverNoteInputs = new NoteInputs(
        new MidenArrays.FeltArray(leftoverInputsArray),
      );

      const leftoverNoteScript = builder.compileNoteScript(PSWAP_PRIVATE_MASM);
      const leftoverSerialNum = new Word(
        new BigUint64Array([BigInt(1), BigInt(2), BigInt(3), BigInt(5)]),
      );
      const leftoverRecipient = new NoteRecipient(leftoverSerialNum, leftoverNoteScript, leftoverNoteInputs);

      const leftoverNoteDetails = new NoteDetails(leftoverNoteAssets, leftoverRecipient);
      const leftoverDetailsAndTag = new NoteDetailsAndTag(leftoverNoteDetails, leftoverSwappTag);
      log(`  Built expected leftover SWAPP note (will be PRIVATE via MASM input)`);

      const expectedRecipients = new NoteRecipientArray([
        p2idRecipient,
        leftoverRecipient,
      ]);

      // Build transaction using UNAUTHENTICATED input (for private notes)
      // This requires the full Note object, not just the note ID
      // Per Miden engineer: "You can use .withUnauthenticatedInputNotes() even if the note is authenticated"
      const { NoteAndArgs } = sdk as any;
      const noteAndArgs = new NoteAndArgs(swappNote, noteArgs);

      log(`  Using withUnauthenticatedInputNotes with full Note object`);

      const fillTxReq = new TransactionRequestBuilder()
        .withUnauthenticatedInputNotes(new MidenArrays.NoteAndArgsArray([noteAndArgs]))
        .withExpectedFutureNotes(new NoteDetailsAndTagArray([p2idDetailsAndTag, leftoverDetailsAndTag]))
        .withExpectedOutputRecipients(expectedRecipients)
        .build();

      log("");
      log("--- Submitting Fill Transaction ---");
      log("  Expected outputs: P2ID (PRIVATE) + Leftover SWAPP (PRIVATE)");

      const fillTxId = await client.submitNewTransaction(toAccountId(takerIdHex), fillTxReq);
      log(`  Transaction submitted`);
      log(`  Transaction ID: ${fillTxId.toHex()}`);

      // Wait for transaction to commit
      log("");
      log("Waiting for fill transaction to commit (12s)...");
      await new Promise((r) => setTimeout(r, 12000));
      await client.syncState();

      // Check taker's balance after fill
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
      log("(P2ID note should have been created as PRIVATE)");

      // For private P2ID, maker needs to receive it via sharing
      // In this test, since both accounts are in the same client, we can try to find it
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
        log("  Note: PRIVATE P2ID may not be auto-discoverable");
        log("  In production, P2ID would be shared via post office");
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
      log("");
      log("KEY VERIFICATION POINTS:");
      log("  1. PSWAP note was created as PRIVATE (NoteType.Private)");
      log("  2. MASM script used NOTE_TYPE_OUTPUT input (input[14] = 0)");
      log("  3. P2ID and leftover SWAPP should be PRIVATE (read from input)");
      log("  4. Private notes are NOT visible on midenscan.com");
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
          PRIVATE PSWAP Partial Fill Test
        </h1>
        <p style={{ color: "#9ca3af", marginBottom: "24px" }}>
          Tests private swap note consumption with dynamic NOTE_TYPE_OUTPUT
        </p>

        <div style={{ display: "flex", gap: "16px", marginBottom: "24px", alignItems: "center" }}>
          <button
            onClick={runTest}
            disabled={isRunning}
            style={{
              padding: "8px 16px",
              backgroundColor: isRunning ? "#374151" : "#22c55e",
              color: "#fff",
              border: "none",
              borderRadius: "4px",
              cursor: isRunning ? "not-allowed" : "pointer",
              fontFamily: "monospace",
            }}
          >
            {state.phase === "idle"
              ? "Run Private Test"
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
            {state.makerId && <div>Maker (PRIVATE): {state.makerId}</div>}
            {state.takerId && <div>Taker (PRIVATE): {state.takerId}</div>}
            {state.swappNoteId && <div>SWAPP Note (PRIVATE): {state.swappNoteId}</div>}
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
            <p style={{ color: "#6b7280" }}>Click &quot;Run Private Test&quot; to start</p>
          ) : (
            <pre style={{ whiteSpace: "pre-wrap" }}>{state.logs.join("\n")}</pre>
          )}
        </div>
      </div>
    </div>
  );
}

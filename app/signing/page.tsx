"use client";

import { useCallback, useState } from "react";
import {
  useWallet,
  WalletMultiButton,
} from "@demox-labs/miden-wallet-adapter";

// Key derivation message from useAddressBookEncryption (33 bytes)
const KEY_DERIVATION_MESSAGE = "lumina-address-book-encryption-v1";

// RPC endpoint for testnet
const RPC_URL = "https://rpc.testnet.miden.io:443";

interface TestState {
  logs: string[];
  phase: "idle" | "signing" | "done" | "error";
  internalTestPhase: "idle" | "running" | "done" | "error";
}

function arrayBufferToHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export default function SigningPage() {
  const { connected, address, signBytes } = useWallet();

  const [state, setState] = useState<TestState>({
    logs: [],
    phase: "idle",
    internalTestPhase: "idle",
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

  const setPhase = useCallback((phase: TestState["phase"]) => {
    setState((prev) => ({ ...prev, phase }));
  }, []);

  const runSigningTest = useCallback(async () => {
    if (!signBytes) {
      log("❌ signBytes not available - is wallet connected?");
      setPhase("error");
      return;
    }

    setPhase("signing");
    log("=== Starting Signing Test ===");
    log(`Wallet address: ${address}`);

    try {
      // Test 1: Message length analysis
      const encoder = new TextEncoder();
      const messageBytes = encoder.encode(KEY_DERIVATION_MESSAGE);
      log(`\nMessage: "${KEY_DERIVATION_MESSAGE}"`);
      log(`Message byte length: ${messageBytes.length} bytes`);
      log(`Message bytes (hex): ${arrayBufferToHex(messageBytes.buffer as ArrayBuffer)}`);

      // Test 2: Sign with "word" kind
      log("\n--- Test 2: signBytes with kind='word' ---");
      try {
        const signature1 = await signBytes(messageBytes, "word");
        log(`✅ Signature 1 received!`);
        log(`Signature length: ${signature1.length} bytes`);
        const sig1Buffer = new Uint8Array(signature1).buffer as ArrayBuffer;
        log(
          `Signature (first 64 hex chars): ${arrayBufferToHex(sig1Buffer).slice(0, 64)}...`
        );

        // Test 3: Sign again to test determinism
        log("\n--- Test 3: Determinism check ---");
        const signature2 = await signBytes(messageBytes, "word");
        log(`✅ Signature 2 received!`);
        log(`Signature length: ${signature2.length} bytes`);

        const sig1Hex = arrayBufferToHex(sig1Buffer);
        const sig2Buffer = new Uint8Array(signature2).buffer as ArrayBuffer;
        const sig2Hex = arrayBufferToHex(sig2Buffer);
        const areEqual = sig1Hex === sig2Hex;
        log(
          `Signatures match: ${areEqual ? "✅ YES (deterministic)" : "❌ NO (non-deterministic)"}`
        );

        if (!areEqual) {
          log("WARNING: Non-deterministic signatures will break key derivation!");
          log(`Sig1: ${sig1Hex.slice(0, 64)}...`);
          log(`Sig2: ${sig2Hex.slice(0, 64)}...`);
        }

        // Test 4: Hash the signature (what we do for key derivation)
        log("\n--- Test 4: SHA-256 hash of signature ---");
        const keyMaterial = await crypto.subtle.digest("SHA-256", sig1Buffer);
        log(`Hash length: ${keyMaterial.byteLength} bytes (should be 32)`);
        log(`Key material (hex): ${arrayBufferToHex(keyMaterial)}`);

        // Test 5: Try importing as AES key
        log("\n--- Test 5: Import as AES-256-GCM key ---");
        const cryptoKey = await crypto.subtle.importKey(
          "raw",
          keyMaterial,
          { name: "AES-GCM", length: 256 },
          false,
          ["encrypt", "decrypt"]
        );
        log(`✅ Successfully imported as CryptoKey!`);
        log(`Key algorithm: ${cryptoKey.algorithm.name}`);
        log(`Key usages: ${cryptoKey.usages.join(", ")}`);

        // Test 6: Try a round-trip encryption
        log("\n--- Test 6: Encryption round-trip ---");
        const testData = "Hello, encrypted address book!";
        const testDataBytes = encoder.encode(testData);
        const iv = crypto.getRandomValues(new Uint8Array(12));

        const ciphertext = await crypto.subtle.encrypt(
          { name: "AES-GCM", iv },
          cryptoKey,
          testDataBytes
        );
        log(`Encrypted ${testDataBytes.length} bytes → ${ciphertext.byteLength} bytes`);

        const decrypted = await crypto.subtle.decrypt(
          { name: "AES-GCM", iv },
          cryptoKey,
          ciphertext
        );
        const decryptedText = new TextDecoder().decode(decrypted);
        log(`Decrypted: "${decryptedText}"`);
        log(`Round-trip success: ${decryptedText === testData ? "✅ YES" : "❌ NO"}`);

        log("\n=== All tests passed! ===");
        setPhase("done");
      } catch (signError) {
        log(`❌ Signing error: ${signError}`);

        // Try with "signingInputs" kind as fallback
        log("\n--- Trying with kind='signingInputs' ---");
        try {
          const signature = await signBytes(messageBytes, "signingInputs");
          log(`✅ signingInputs signature received!`);
          log(`Signature length: ${signature.length} bytes`);
        } catch (e2) {
          log(`❌ signingInputs also failed: ${e2}`);
        }

        setPhase("error");
      }
    } catch (error) {
      log(`❌ Test error: ${error}`);
      setPhase("error");
    }
  }, [signBytes, address, log, setPhase]);

  // Internal wallet test using SecretKey.sign() directly
  const runInternalWalletTest = useCallback(async () => {
    setState((prev) => ({ ...prev, internalTestPhase: "running" }));
    log("\n=== Starting INTERNAL Wallet Signing Test ===");

    try {
      const {
        WebClient,
        AccountStorageMode,
        SecretKey,
        Word,
      } = await import("@demox-labs/miden-sdk");

      // Create a fresh WebClient
      log("Creating WebClient...");
      const client = await WebClient.createClient(RPC_URL);
      await client.syncState();
      const syncHeight = await client.getSyncHeight();
      log(`Synced to block: ${syncHeight}`);

      // Generate a deterministic seed for testing
      log("\nGenerating deterministic seed...");
      const seed = new Uint8Array(32);
      seed.fill(42); // Deterministic seed for testing
      log(`Seed (first 8 bytes): [${Array.from(seed.slice(0, 8)).join(', ')}]`);

      // Create wallet WITH the seed so we can recover the key later
      log("\nCreating test wallet with seed...");
      const wallet = await client.newWallet(
        AccountStorageMode.private(),
        true, // mutable
        0,    // auth scheme (RpoFalcon512)
        seed  // Pass the seed!
      );
      const walletId = wallet.id().toString();
      log(`Created wallet: ${walletId}`);

      // Generate SecretKey from SAME seed
      log("\nGenerating SecretKey from same seed...");
      const secretKey = SecretKey.rpoFalconWithRNG(seed);
      log(`SecretKey created, public key available: ${!!secretKey.publicKey()}`);

      // Prepare the message
      const encoder = new TextEncoder();
      const messageBytes = encoder.encode(KEY_DERIVATION_MESSAGE);
      log(`\nMessage: "${KEY_DERIVATION_MESSAGE}" (${messageBytes.length} bytes)`);

      // Hash the message to get 32 bytes for Word
      log("\n--- Hashing message to Word ---");
      const messageHash = await crypto.subtle.digest(
        "SHA-256",
        messageBytes.buffer as ArrayBuffer
      );
      const hashArray = new Uint8Array(messageHash);
      log(`Message hash (32 bytes): ${arrayBufferToHex(messageHash)}`);

      // Convert 32 bytes to Word (4 Felts, each 8 bytes as BigUint64)
      log("\n--- Converting hash to Word ---");
      const view = new DataView(messageHash);
      const felt0 = view.getBigUint64(0, true);  // little-endian
      const felt1 = view.getBigUint64(8, true);
      const felt2 = view.getBigUint64(16, true);
      const felt3 = view.getBigUint64(24, true);
      log(`Felt values: [${felt0}, ${felt1}, ${felt2}, ${felt3}]`);

      const word = new Word(new BigUint64Array([felt0, felt1, felt2, felt3]));
      log(`Word created: ${word.toHex()}`);

      // Sign the Word
      log("\n--- Test: SecretKey.sign(word) ---");
      const signature1 = secretKey.sign(word);
      const sig1Bytes = signature1.serialize();
      log(`✅ Signature 1 received!`);
      log(`Signature length: ${sig1Bytes.length} bytes`);
      const sig1Buffer = new Uint8Array(sig1Bytes).buffer as ArrayBuffer;
      log(`Signature (first 64 hex chars): ${arrayBufferToHex(sig1Buffer).slice(0, 64)}...`);

      // Sign again to test determinism
      log("\n--- Determinism check ---");
      const signature2 = secretKey.sign(word);
      const sig2Bytes = signature2.serialize();
      log(`✅ Signature 2 received!`);
      log(`Signature length: ${sig2Bytes.length} bytes`);

      const sig1Hex = arrayBufferToHex(sig1Buffer);
      const sig2Buffer = new Uint8Array(sig2Bytes).buffer as ArrayBuffer;
      const sig2Hex = arrayBufferToHex(sig2Buffer);
      const areEqual = sig1Hex === sig2Hex;
      log(`Signatures match: ${areEqual ? "✅ YES (deterministic)" : "❌ NO (non-deterministic)"}`);

      if (!areEqual) {
        log("WARNING: Non-deterministic signatures will break key derivation!");
        log(`Sig1: ${sig1Hex.slice(0, 64)}...`);
        log(`Sig2: ${sig2Hex.slice(0, 64)}...`);
      }

      // Hash signature for key material
      log("\n--- SHA-256 hash of signature ---");
      const keyMaterial = await crypto.subtle.digest("SHA-256", sig1Buffer);
      log(`Hash length: ${keyMaterial.byteLength} bytes`);
      log(`Key material (hex): ${arrayBufferToHex(keyMaterial)}`);

      // Import as AES key and test encryption
      log("\n--- Import as AES-256-GCM key ---");
      const cryptoKey = await crypto.subtle.importKey(
        "raw",
        keyMaterial,
        { name: "AES-GCM", length: 256 },
        false,
        ["encrypt", "decrypt"]
      );
      log(`✅ Successfully imported as CryptoKey!`);

      // Test encryption round-trip
      log("\n--- Encryption round-trip ---");
      const testData = "Internal wallet encryption test!";
      const testDataBytes = encoder.encode(testData);
      const iv = crypto.getRandomValues(new Uint8Array(12));

      const ciphertext = await crypto.subtle.encrypt(
        { name: "AES-GCM", iv },
        cryptoKey,
        testDataBytes
      );
      log(`Encrypted ${testDataBytes.length} bytes → ${ciphertext.byteLength} bytes`);

      const decrypted = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv },
        cryptoKey,
        ciphertext
      );
      const decryptedText = new TextDecoder().decode(decrypted);
      log(`Decrypted: "${decryptedText}"`);
      log(`Round-trip success: ${decryptedText === testData ? "✅ YES" : "❌ NO"}`);

      // Cleanup
      secretKey.free();

      // Test 7: Try to retrieve AuthSecretKey from store and reconstruct
      log("\n--- Test 7: Retrieve key from WebClient store ---");
      try {
        const pubKeyWord = wallet.getPublicKeys()[0];
        log(`Wallet public key: ${pubKeyWord.toHex()}`);

        const authSecretKey = await client.getAccountAuthByPubKey(pubKeyWord);
        log(`✅ Got AuthSecretKey from store!`);

        const secretKeyFelts = authSecretKey.getRpoFalcon512SecretKeyAsFelts();
        log(`Secret key felts count: ${secretKeyFelts.length}`);

        // Try to deserialize SecretKey from felts
        // The felts represent the serialized key - let's see if we can reconstruct
        const feltValues = secretKeyFelts.map(f => f.asInt());
        log(`First 4 felt values: [${feltValues.slice(0, 4).join(', ')}]`);

        // Try to reconstruct bytes from felts (each felt might be a byte value)
        const feltsAsBytes = new Uint8Array(feltValues.map(v => Number(v) & 0xFF));
        log(`Felts as bytes (first 16): [${Array.from(feltsAsBytes.slice(0, 16)).join(', ')}]`);

        // Try serializing and deserializing the original key
        const testSecretKey = SecretKey.rpoFalconWithRNG(seed);
        const serialized = testSecretKey.serialize();
        log(`SecretKey serialized length: ${serialized.length} bytes`);
        log(`Serialized (first 16): [${Array.from(serialized.slice(0, 16)).join(', ')}]`);

        // Compare serialized bytes with felts-as-bytes
        const match = serialized.length === feltsAsBytes.length + 1 || serialized.length === feltsAsBytes.length;
        log(`Lengths match (±1): ${match}`);

        // Try deserializing from felts-as-bytes
        try {
          const fromFelts = SecretKey.deserialize(feltsAsBytes);
          const testSigFromFelts = fromFelts.sign(word);
          log(`✅ SecretKey deserialized from Felts can sign!`);
          fromFelts.free();
        } catch (deserErr) {
          log(`❌ Cannot deserialize from felts-as-bytes: ${deserErr}`);

          // Try with a leading byte prepended (0 = RPO Falcon512 auth scheme)
          try {
            const withPrefix = new Uint8Array([0, ...feltsAsBytes]);
            const fromFeltsWithPrefix = SecretKey.deserialize(withPrefix);
            log(`✅ With prefix byte 0: SecretKey deserialized!`);

            // CRITICAL: Verify it produces the SAME signature
            const sigFromStore = fromFeltsWithPrefix.sign(word);
            const sigFromStoreSerialized = sigFromStore.serialize();
            const sigFromStoreHex = arrayBufferToHex(new Uint8Array(sigFromStoreSerialized).buffer as ArrayBuffer);

            // Compare with original signature
            const sigMatch = sigFromStoreHex === sig1Hex;
            log(`Signature from store key matches original: ${sigMatch ? "✅ YES" : "❌ NO"}`);

            if (!sigMatch) {
              log(`Original sig: ${sig1Hex.slice(0, 64)}...`);
              log(`Store sig:    ${sigFromStoreHex.slice(0, 64)}...`);
            } else {
              log(`🎉 Can retrieve SecretKey from WebClient store for signing!`);
            }

            fromFeltsWithPrefix.free();
          } catch (e2) {
            log(`❌ With prefix also failed: ${e2}`);
          }
        }

        const deserialized = SecretKey.deserialize(serialized);
        log(`✅ SecretKey can be serialized/deserialized!`);

        // Sign with deserialized key to verify it works
        const testSig = deserialized.sign(word);
        log(`✅ Deserialized key can sign!`);

        testSecretKey.free();
        deserialized.free();
      } catch (retrieveErr) {
        log(`❌ Could not retrieve/reconstruct key: ${retrieveErr}`);
      }

      log("\n=== Internal wallet test passed! ===");
      setState((prev) => ({ ...prev, internalTestPhase: "done" }));
    } catch (error) {
      log(`❌ Internal wallet test error: ${error}`);
      setState((prev) => ({ ...prev, internalTestPhase: "error" }));
    }
  }, [log]);

  const isRunning = state.phase === "signing";
  const isInternalRunning = state.internalTestPhase === "running";

  return (
    <div
      style={{
        minHeight: "100vh",
        backgroundColor: "#000",
        color: "#fff",
        padding: "24px",
        fontFamily: "monospace",
      }}
    >
      <div style={{ maxWidth: "896px", margin: "0 auto" }}>
        <h1
          style={{
            fontSize: "1.5rem",
            fontWeight: "bold",
            marginBottom: "16px",
          }}
        >
          🔐 Wallet Signing Test
        </h1>
        <p style={{ color: "#9ca3af", marginBottom: "8px" }}>
          Tests signBytes functionality for address book encryption key derivation.
        </p>
        <p
          style={{ color: "#6b7280", marginBottom: "24px", fontSize: "0.875rem" }}
        >
          Key derivation message: &quot;{KEY_DERIVATION_MESSAGE}&quot; (
          {KEY_DERIVATION_MESSAGE.length} chars)
        </p>

        {/* Connection status */}
        <div
          style={{
            marginBottom: "16px",
            padding: "12px",
            backgroundColor: connected ? "#064e3b" : "#1f2937",
            borderRadius: "8px",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <p>
            Wallet:{" "}
            {connected ? (
              <>
                <span style={{ color: "#10b981" }}>Connected</span>
                <span
                  style={{
                    color: "#9ca3af",
                    marginLeft: "8px",
                    fontSize: "0.875rem",
                  }}
                >
                  {address?.slice(0, 30)}...
                </span>
              </>
            ) : (
              <span style={{ color: "#f59e0b" }}>Not connected</span>
            )}
          </p>
          <WalletMultiButton />
        </div>

        {/* Buttons */}
        <div
          style={{
            display: "flex",
            gap: "16px",
            marginBottom: "24px",
            alignItems: "center",
          }}
        >
          <button
            onClick={runSigningTest}
            disabled={isRunning || !connected}
            style={{
              padding: "8px 16px",
              backgroundColor: isRunning || !connected ? "#374151" : "#10b981",
              color: "#fff",
              border: "none",
              borderRadius: "4px",
              cursor: isRunning || !connected ? "not-allowed" : "pointer",
              fontFamily: "monospace",
            }}
          >
            {state.phase === "signing"
              ? "Testing..."
              : state.phase === "done"
                ? "Run Again"
                : "Run Signing Test"}
          </button>

          <button
            onClick={runInternalWalletTest}
            disabled={isInternalRunning}
            style={{
              padding: "8px 16px",
              backgroundColor: isInternalRunning ? "#374151" : "#8b5cf6",
              color: "#fff",
              border: "none",
              borderRadius: "4px",
              cursor: isInternalRunning ? "not-allowed" : "pointer",
              fontFamily: "monospace",
            }}
          >
            {state.internalTestPhase === "running"
              ? "Testing..."
              : state.internalTestPhase === "done"
                ? "Run Internal Again"
                : "Test Internal Wallet"}
          </button>

          <button
            onClick={() =>
              setState({
                logs: [],
                phase: "idle",
                internalTestPhase: "idle",
              })
            }
            style={{
              padding: "8px 16px",
              backgroundColor: "#4b5563",
              color: "#fff",
              border: "none",
              borderRadius: "4px",
              cursor: "pointer",
              fontFamily: "monospace",
            }}
          >
            Clear Logs
          </button>
        </div>

        {/* Logs */}
        <div
          style={{
            backgroundColor: "#111827",
            borderRadius: "8px",
            padding: "16px",
            fontFamily: "monospace",
            fontSize: "0.875rem",
            overflow: "auto",
            maxHeight: "600px",
          }}
        >
          <h2
            style={{
              fontSize: "1.125rem",
              fontWeight: "bold",
              marginBottom: "8px",
            }}
          >
            Console Output
          </h2>
          {state.logs.length === 0 ? (
            <p style={{ color: "#6b7280" }}>
              1. Connect your Miden wallet browser extension
              <br />
              2. Click &quot;Run Signing Test&quot; to test signBytes
            </p>
          ) : (
            <pre style={{ whiteSpace: "pre-wrap" }}>{state.logs.join("\n")}</pre>
          )}
        </div>

        {/* Info section */}
        <div
          style={{
            marginTop: "24px",
            padding: "16px",
            backgroundColor: "#1e3a5f",
            borderRadius: "8px",
            fontSize: "0.875rem",
          }}
        >
          <h3 style={{ fontWeight: "bold", marginBottom: "8px" }}>
            What this tests:
          </h3>
          <p style={{ color: "#60a5fa", marginBottom: "8px" }}>
            <strong>External Wallet</strong> (browser extension):
          </p>
          <ul style={{ paddingLeft: "20px", color: "#93c5fd", marginBottom: "16px" }}>
            <li>signBytes with arbitrary-length message (33 bytes)</li>
            <li>Determinism: signing same message twice = identical signatures</li>
            <li>SHA-256 hash of signature → AES-256-GCM key</li>
          </ul>
          <p style={{ color: "#a78bfa", marginBottom: "8px" }}>
            <strong>Internal Wallet</strong> (SDK SecretKey.sign):
          </p>
          <ul style={{ paddingLeft: "20px", color: "#c4b5fd" }}>
            <li>Hash message to Word (32 bytes / 4 Felts)</li>
            <li>SecretKey.sign(word) using RPO Falcon512</li>
            <li>Determinism check for key derivation</li>
            <li>Full encryption round-trip</li>
          </ul>
        </div>
      </div>
    </div>
  );
}

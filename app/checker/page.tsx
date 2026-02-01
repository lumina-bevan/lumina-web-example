"use client";

import { useCallback, useState } from "react";
import { PSWAP_NOTE_ID } from "@/lib/constants";
import { getRpcNote } from "@/lib/rpcClient";

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
  logs: string[];
  phase: TestPhase;
}

export default function CheckerPage() {
  const [state, setState] = useState<TestState>({
    logs: [],
    phase: "idle",
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

  const runCheck = useCallback(async () => {
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

    const rpcUrl = "https://rpc.testnet.miden.io:443";
    const webClient = await WebClient.createClient(rpcUrl);
    log("WebClient created!");

    await webClient.syncState();

    const syncHeight = await webClient.getSyncHeight();
    log(`Synced to block: ${syncHeight}`);

    const fetchedNote = await getRpcNote(PSWAP_NOTE_ID);

    if (fetchedNote) {
      const noteId = fetchedNote.inputNote?.id();
      if (noteId) log(`Note ID -> ${noteId}`);

      const noteMetadata = fetchedNote.metadata;
      if (noteMetadata) {
        log(`Sender: ${noteMetadata.sender().toString()}`);
        log(`Tag: ${noteMetadata.tag().asU32()}`);
        log(`Note Type: ${noteMetadata.noteType()}`);
      }

      if (fetchedNote?.inputNote) {
        try {
          log("Found the NoteID!");
          const inputNote = fetchedNote.inputNote;
          const { NoteFile } = await import("@demox-labs/miden-sdk");
          const noteFile = NoteFile.fromInputNote(inputNote);
          await webClient.importNoteFile(noteFile);
        } catch (error) {
          console.error("Error on inputNote check ", error);
          throw new Error("fail");
        }
      }
    }
  }, [log, setPhase]);

  const isRunning =
    state.phase !== "idle" && state.phase !== "done" && state.phase !== "error";

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
          Note Hunt
        </h1>
        <p style={{ color: "#9ca3af", marginBottom: "24px" }}>
          See if we can find the note {PSWAP_NOTE_ID}
        </p>

        <div
          style={{
            display: "flex",
            gap: "16px",
            marginBottom: "24px",
            alignItems: "center",
          }}
        >
          <button
            onClick={runCheck}
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

          <div
            style={{ display: "flex", alignItems: "center", gap: "8px" }}
          ></div>
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
              Click &quot;Run Test&quot; to start
            </p>
          ) : (
            <pre style={{ whiteSpace: "pre-wrap" }}>
              {state.logs.join("\n")}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}

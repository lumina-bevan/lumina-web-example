import type { RpcClient, Endpoint, NoteId } from "@demox-labs/miden-sdk";
type FetchedNote = Awaited<ReturnType<RpcClient["getNotesById"]>>[number];

let rpcClient: RpcClient | null = null;

export async function getRpcClient(): Promise<RpcClient> {
  if (!rpcClient) {
    const { RpcClient, Endpoint } = await import("@demox-labs/miden-sdk");
    const endpoint = Endpoint.testnet();
    rpcClient = new RpcClient(endpoint);
  }
  return rpcClient;
}

export async function getRpcNote(
  noteIdAsHex: string,
): Promise<FetchedNote | null> {
  const rpcClient = await getRpcClient();
  const { NoteId } = await import("@demox-labs/miden-sdk");
  const noteId = NoteId.fromHex(noteIdAsHex);
  try {
    const rpcNotes = await rpcClient.getNotesById([noteId]);
    if (rpcNotes.length === 0) {
      console.log("Note not found:", noteIdAsHex);
      return null;
    }

    const note = rpcNotes[0];
    return note;
  } catch (error) {
    console.error("Error fetching note:", error);
    return null;
  }
}

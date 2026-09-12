export type ArenaClient = {
    id: string;
    name: string;
    x: number;
    y: number;
    color: string;
    cursorSeq: number;
};

export type ArenaServerMessage =
    | { type: "snapshot"; selfId: string; clients: ArenaClient[] }
    | { type: "presence"; action: "join" | "leave"; clientId: string; client?: ArenaClient }
    | { type: "cursor"; clientId: string; seq: number; x: number; y: number }
    | { type: "reaction"; clientId: string; seq: number; x: number; y: number; emoji: string };

export type ArenaClientMessage =
    | { type: "hello"; clientId: string; name: string }
    | { type: "cursor"; seq: number; x: number; y: number }
    | { type: "reaction"; seq: number; x: number; y: number; emoji: string };

const isUnit = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
const isClient = (value: unknown): value is ArenaClient => {
    if (!value || typeof value !== "object") return false;
    const client = value as Record<string, unknown>;
    return typeof client.id === "string" && typeof client.name === "string" && isUnit(client.x) && isUnit(client.y)
        && typeof client.color === "string" && Number.isInteger(client.cursorSeq);
};

export const parseServerMessage = (raw: string): ArenaServerMessage | null => {
    let value: unknown;
    try { value = JSON.parse(raw); } catch { return null; }
    if (!value || typeof value !== "object") return null;
    const message = value as Record<string, unknown>;
    if (message.type === "snapshot" && typeof message.selfId === "string" && Array.isArray(message.clients)
        && message.clients.every(isClient)) {
        return { type: "snapshot", selfId: message.selfId, clients: message.clients };
    }
    if (message.type === "presence" && (message.action === "join" || message.action === "leave")
        && typeof message.clientId === "string" && (message.action === "leave" || isClient(message.client))) {
        return message.action === "join"
            ? { type: "presence", action: "join", clientId: message.clientId, client: message.client as ArenaClient }
            : { type: "presence", action: "leave", clientId: message.clientId };
    }
    if ((message.type === "cursor" || message.type === "reaction") && typeof message.clientId === "string"
        && Number.isInteger(message.seq) && isUnit(message.x) && isUnit(message.y)) {
        if (message.type === "cursor") return { type: "cursor", clientId: message.clientId, seq: message.seq, x: message.x, y: message.y };
        if (typeof message.emoji === "string" && message.emoji.length <= 8) {
            return { type: "reaction", clientId: message.clientId, seq: message.seq, x: message.x, y: message.y, emoji: message.emoji };
        }
    }
    return null;
};

export interface SseEvent {
  id?: string;
  event?: string;
  data: string;
}

export function parseSseChunk(buffer: string): { events: SseEvent[]; rest: string } {
  const normalized = buffer.replace(/\r\n/g, "\n");
  const events: SseEvent[] = [];
  let start = 0;
  for (;;) {
    const sep = normalized.indexOf("\n\n", start);
    if (sep === -1) break;
    const block = normalized.slice(start, sep);
    start = sep + 2;
    const ev: SseEvent = { data: "" };
    const dataLines: string[] = [];
    for (const line of block.split("\n")) {
      if (line === "" || line.startsWith(":")) continue;
      const colon = line.indexOf(":");
      const field = colon === -1 ? line : line.slice(0, colon);
      let value = colon === -1 ? "" : line.slice(colon + 1);
      if (value.startsWith(" ")) value = value.slice(1);
      if (field === "data") dataLines.push(value);
      else if (field === "id") ev.id = value;
      else if (field === "event") ev.event = value;
    }
    ev.data = dataLines.join("\n");
    if (ev.data !== "" || ev.id !== undefined || ev.event !== undefined) events.push(ev);
  }
  return { events, rest: normalized.slice(start) };
}

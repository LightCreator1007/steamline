import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

export interface Seen {
  url: string;
  auth?: string;
  apiToken?: string;
}

export interface TestServer {
  base: string;
  seen: Seen[];
  close: () => void;
}

export function startServer(
  handler: (req: IncomingMessage, res: ServerResponse, seen: Seen[]) => void,
): Promise<TestServer> {
  const seen: Seen[] = [];
  const server = createServer((req, res) => {
    seen.push({
      url: req.url ?? "",
      auth: req.headers.authorization,
      apiToken: req.headers["x-api-token"] as string | undefined,
    });
    handler(req, res, seen);
  });
  return new Promise<TestServer>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as { port: number };
      resolve({ base: `http://127.0.0.1:${addr.port}`, seen, close: () => server.close() });
    });
  });
}

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

export type RecordedRequest = { method: string; path: string; headers: IncomingMessage["headers"]; raw: string; body: unknown };
export type Behaviour = (request: RecordedRequest, response: ServerResponse) => void | Promise<void>;

/** A valid System One answer for the classifier's two questions, as fictional numbers. */
export function answerBody(category = "PLUMBING", urgency = "NORMAL", categoryP = 0.9, urgencyP = 0.8): unknown {
  const categories = ["PLUMBING", "ELECTRICAL", "HOUSEKEEPING", "LIFT", "OTHER"];
  const urgencies = ["HIGH", "NORMAL", "LOW"];
  const spread = (labels: string[], top: string, p: number): Record<string, number> =>
    Object.fromEntries(labels.map((label) => [label, label === top ? p : (1 - p) / (labels.length - 1)]));
  return {
    model: "fake-model",
    answers: {
      category: { type: "choice", choice: category, confidence: 0.9, probabilities: spread(categories, category, categoryP) },
      urgency: { type: "choice", choice: urgency, confidence: 0.8, probabilities: spread(urgencies, urgency, urgencyP) },
    },
    usage: { input_tokens: 100, output_tokens: 10 },
  };
}

export const respondJson = (status: number, body: unknown, headers: Record<string, string> = {}): Behaviour => (_request, response) => {
  response.writeHead(status, { "content-type": "application/json", ...headers });
  response.end(JSON.stringify(body));
};

/** Never answers, so only a timeout or an abort ends the request. */
export const hang: Behaviour = () => undefined;

/** A fake System One provider on 127.0.0.1: it records every request, counts requests the client dropped, and answers as told. */
export class FakeProvider {
  readonly requests: RecordedRequest[] = [];
  /** Requests whose connection closed before the server answered. */
  dropped = 0;
  behaviour: Behaviour = respondJson(200, answerBody());
  private server: Server;
  url = "";

  constructor() {
    this.server = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on("data", (chunk: Buffer) => chunks.push(chunk));
      request.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf8");
        let body: unknown = null;
        try {
          body = JSON.parse(raw);
        } catch {
          body = null;
        }
        response.on("close", () => {
          if (!response.writableEnded) this.dropped += 1;
        });
        const recorded = { method: request.method ?? "", path: request.url ?? "", headers: request.headers, raw, body };
        this.requests.push(recorded);
        void this.behaviour(recorded, response);
      });
    });
  }

  async start(): Promise<this> {
    await new Promise<void>((resolve) => this.server.listen(0, "127.0.0.1", resolve));
    this.url = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}/v1/systemone`;
    return this;
  }

  async stop(): Promise<void> {
    this.server.closeAllConnections();
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }
}

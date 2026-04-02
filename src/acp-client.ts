import { ChildProcess, spawn } from "child_process";

export interface AcpMessage {
  jsonrpc: "2.0";
  id?: number;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export class AcpClient {
  private process: ChildProcess | null = null;
  private nextId = 1;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private buffer = "";
  private onUpdate: ((msg: AcpMessage) => void) | null = null;

  constructor(private kiroPath: string) {}

  setUpdateHandler(handler: (msg: AcpMessage) => void) {
    this.onUpdate = handler;
  }

  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.process = spawn(this.kiroPath, ["acp", "--trust-all-tools"], {
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env },
      });

      this.process.stdout?.on("data", (chunk: Buffer) => {
        this.buffer += chunk.toString();
        this.processBuffer();
      });

      this.process.stderr?.on("data", (chunk: Buffer) => {
        console.debug("[kiro stderr]", chunk.toString().trim());
      });

      this.process.on("error", (err) => reject(err));
      this.process.on("close", () => { this.process = null; });

      // Give it a moment to start
      setTimeout(() => resolve(), 500);
    });
  }

  private processBuffer() {
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() || "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const msg: AcpMessage = JSON.parse(trimmed);
        if (msg.id !== undefined && this.pending.has(msg.id)) {
          const p = this.pending.get(msg.id)!;
          this.pending.delete(msg.id);
          if (msg.error) p.reject(new Error(msg.error.message));
          else p.resolve(msg.result);
        } else if (msg.method && this.onUpdate) {
          this.onUpdate(msg);
        }
      } catch {
        // skip non-JSON lines
      }
    }
  }

  async send(method: string, params?: Record<string, unknown>): Promise<unknown> {
    if (!this.process?.stdin) throw new Error("Kiro not running");
    const id = this.nextId++;
    const msg = JSON.stringify({ jsonrpc: "2.0", id, method, params });
    this.process.stdin.write(msg + "\n");
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error("Request timed out"));
        }
      }, 120000);
    });
  }

  async initialize(): Promise<unknown> {
    return this.send("initialize", {
      clientInfo: { name: "obsidian-kiro", version: "0.1.0" },
      capabilities: { loadSession: false, promptCapabilities: { image: false } },
    });
  }

  async newSession(): Promise<unknown> {
    return this.send("session/new", {});
  }

  async prompt(text: string): Promise<unknown> {
    return this.send("session/prompt", {
      content: [{ type: "text", text }],
    });
  }

  async cancel(): Promise<void> {
    await this.send("session/cancel", {});
  }

  stop() {
    this.process?.kill();
    this.process = null;
  }

  get isRunning(): boolean {
    return this.process !== null;
  }
}

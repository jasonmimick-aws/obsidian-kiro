import { ChildProcess, spawn } from "child_process";
import type { KiroSettings } from "./main";

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
  private sessionId: string | null = null;

  constructor(private kiroPath: string, private settings: KiroSettings) {}

  private log(...args: unknown[]) {
    if (this.settings.debug) console.log("[Kiro ACP]", ...args);
  }

  setUpdateHandler(handler: (msg: AcpMessage) => void) {
    this.onUpdate = handler;
  }

  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.log("Spawning:", this.kiroPath, "acp --trust-all-tools");
      this.process = spawn(this.kiroPath, ["acp", "--trust-all-tools"], {
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env },
      });

      this.process.stdout?.on("data", (chunk: Buffer) => {
        const raw = chunk.toString();
        this.log("raw chunk:", JSON.stringify(raw).substring(0, 500));
        this.buffer += raw;
        this.processBuffer();
      });

      this.process.stderr?.on("data", (chunk: Buffer) => {
        this.log("stderr:", chunk.toString().trim());
      });

      this.process.on("error", (err) => {
        console.error("[Kiro ACP] process error:", err);
        reject(err);
      });
      this.process.on("close", (code) => {
        this.log("process closed, code:", code);
        this.process = null;
      });

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
        this.log("←", JSON.stringify(msg).substring(0, 300));
        if (msg.id !== undefined && this.pending.has(msg.id)) {
          const p = this.pending.get(msg.id)!;
          this.pending.delete(msg.id);
          if (msg.error) p.reject(new Error(msg.error.message));
          else p.resolve(msg.result);
        } else if (msg.method && this.onUpdate) {
          this.onUpdate(msg);
        }
      } catch {
        this.log("non-JSON:", trimmed.substring(0, 200));
      }
    }
  }

  async send(method: string, params?: Record<string, unknown>): Promise<unknown> {
    if (!this.process?.stdin) throw new Error("Kiro not running");
    const id = this.nextId++;
    const msg = JSON.stringify({ jsonrpc: "2.0", id, method, params });
    this.log("→", msg.substring(0, 300));
    this.process.stdin.write(msg + "\n");
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.log("TIMEOUT id:", id, "buffer:", JSON.stringify(this.buffer).substring(0, 300));
          this.pending.delete(id);
          reject(new Error("Request timed out"));
        }
      }, 120000);
    });
  }

  async initialize(): Promise<unknown> {
    return this.send("initialize", {
      protocolVersion: "2025-01-01",
      clientInfo: { name: "obsidian-kiro", version: "0.2.0" },
      capabilities: { loadSession: false, promptCapabilities: { image: true } },
    });
  }

  async newSession(cwd: string): Promise<unknown> {
    const result = await this.send("session/new", { cwd, mcpServers: [] }) as Record<string, unknown>;
    this.sessionId = result?.sessionId as string || null;
    this.log("sessionId:", this.sessionId);
    return result;
  }

  async prompt(content: Array<Record<string, unknown>>): Promise<unknown> {
    return this.send("session/prompt", {
      sessionId: this.sessionId,
      prompt: content,
    });
  }

  async cancel(): Promise<void> {
    if (this.sessionId) {
      await this.send("session/cancel", { sessionId: this.sessionId });
    }
  }

  stop() {
    this.process?.kill();
    this.process = null;
  }

  get isRunning(): boolean {
    return this.process !== null;
  }
}

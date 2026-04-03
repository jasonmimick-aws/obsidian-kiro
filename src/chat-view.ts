import { ItemView, WorkspaceLeaf, MarkdownRenderer } from "obsidian";
import { AcpClient, AcpMessage } from "./acp-client";

export const KIRO_VIEW_TYPE = "kiro-chat";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export class KiroChatView extends ItemView {
  private client: AcpClient;
  private messages: ChatMessage[] = [];
  private inputEl!: HTMLTextAreaElement;
  private messagesEl!: HTMLDivElement;
  private statusEl!: HTMLDivElement;
  private currentAssistantMsg = "";
  private isStreaming = false;

  constructor(leaf: WorkspaceLeaf, private kiroPath: string) {
    super(leaf);
    this.client = new AcpClient(kiroPath);
    this.client.setUpdateHandler((msg) => this.handleUpdate(msg));
  }

  getViewType(): string { return KIRO_VIEW_TYPE; }
  getDisplayText(): string { return "Kiro"; }
  getIcon(): string { return "bot"; }

  async onOpen() {
    console.log("[Kiro] ChatView onOpen called");
    const container = this.containerEl.children[1] as HTMLElement;
    container.empty();
    container.addClass("kiro-chat-container");

    this.statusEl = container.createDiv({ cls: "kiro-status" });
    this.statusEl.setText("Starting Kiro...");

    this.messagesEl = container.createDiv({ cls: "kiro-messages" });

    const inputRow = container.createDiv({ cls: "kiro-input-row" });
    this.inputEl = inputRow.createEl("textarea", {
      cls: "kiro-input",
      attr: { placeholder: "Ask Kiro anything...", rows: "2" },
    });
    const sendBtn = inputRow.createEl("button", { cls: "kiro-send-btn", text: "Send" });
    sendBtn.addEventListener("click", () => this.sendMessage());
    this.inputEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        this.sendMessage();
      }
    });

    try {
      console.log("[Kiro] Starting ACP client...");
      await this.client.start();
      console.log("[Kiro] ACP process started, initializing...");
      await this.client.initialize();
      console.log("[Kiro] Initialized, creating session...");
      const vaultPath = (this.app.vault.adapter as any).basePath || "/";
      console.log("[Kiro] Using vault path as cwd:", vaultPath);
      
      // Poll buffer every 2s to see if data is stuck
      const pollInterval = setInterval(() => {
        if (this.client.getBuffer().length > 0) {
          console.log("[Kiro] Buffer poll:", JSON.stringify(this.client.getBuffer()).substring(0, 500));
        }
      }, 2000);
      
      try {
        await this.client.newSession(vaultPath);
        console.log("[Kiro] Session created, ready!");
      } finally {
        clearInterval(pollInterval);
      }
      console.log("[Kiro] Session created, ready!");
      this.statusEl.setText("Connected");
      this.statusEl.addClass("kiro-status-connected");
      this.inputEl.focus();
    } catch (e) {
      console.error("[Kiro] Failed to start:", e);
      this.statusEl.setText(`Failed to start: ${e}`);
      this.statusEl.addClass("kiro-status-error");
    }
  }

  async onClose() {
    this.client.stop();
  }

  private async sendMessage() {
    const text = this.inputEl.value.trim();
    if (!text || this.isStreaming) return;

    this.inputEl.value = "";
    this.messages.push({ role: "user", content: text });
    this.currentAssistantMsg = "";
    this.isStreaming = true;
    this.statusEl.setText("Thinking...");
    this.renderMessages();

    try {
      await this.client.prompt(text);
      // Response received — finalize the message
      if (this.currentAssistantMsg) {
        this.messages.push({ role: "assistant", content: this.currentAssistantMsg });
        this.currentAssistantMsg = "";
      }
    } catch (e) {
      this.messages.push({ role: "assistant", content: `Error: ${e}` });
    }

    this.isStreaming = false;
    this.statusEl.setText("Connected");
    this.renderMessages();
  }

  private handleUpdate(msg: AcpMessage) {
    if (msg.method === "session/update") {
      const params = msg.params as Record<string, unknown>;
      const update = params?.update as Record<string, unknown>;
      if (!update) return;

      const type = update.sessionUpdate as string;
      if (type === "agent_message_chunk") {
        const content = update.content as Record<string, unknown>;
        if (content?.type === "text") {
          this.currentAssistantMsg += content.text as string;
          this.renderMessages();
        }
      }
    }

    // Handle end_turn response
    if (msg.id !== undefined && msg.result) {
      const result = msg.result as Record<string, unknown>;
      if (result.stopReason === "end_turn") {
        if (this.currentAssistantMsg) {
          this.messages.push({ role: "assistant", content: this.currentAssistantMsg });
          this.currentAssistantMsg = "";
        }
        this.isStreaming = false;
        this.statusEl.setText("Connected");
        this.renderMessages();
      }
    }
  }

  private renderMessages() {
    this.messagesEl.empty();
    for (const msg of this.messages) {
      const el = this.messagesEl.createDiv({ cls: `kiro-msg kiro-msg-${msg.role}` });
      if (msg.role === "assistant") {
        MarkdownRenderer.render(this.app, msg.content, el, "", this);
      } else {
        el.setText(msg.content);
      }
    }
    if (this.currentAssistantMsg) {
      const el = this.messagesEl.createDiv({ cls: "kiro-msg kiro-msg-assistant kiro-streaming" });
      MarkdownRenderer.render(this.app, this.currentAssistantMsg, el, "", this);
    }
    this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
  }
}

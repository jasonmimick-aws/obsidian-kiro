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
      await this.client.start();
      await this.client.initialize();
      await this.client.newSession();
      this.statusEl.setText("Connected");
      this.statusEl.addClass("kiro-status-connected");
      this.inputEl.focus();
    } catch (e) {
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
    this.renderMessages();
    this.statusEl.setText("Thinking...");

    try {
      await this.client.prompt(text);
    } catch (e) {
      this.currentAssistantMsg = `Error: ${e}`;
    }

    if (this.currentAssistantMsg) {
      this.messages.push({ role: "assistant", content: this.currentAssistantMsg });
    }
    this.currentAssistantMsg = "";
    this.isStreaming = false;
    this.statusEl.setText("Connected");
    this.renderMessages();
  }

  private handleUpdate(msg: AcpMessage) {
    if (msg.method === "session/notification" || msg.method === "session/update") {
      const params = msg.params as Record<string, unknown>;
      const updates = (params?.updates || [params]) as Record<string, unknown>[];
      for (const update of updates) {
        const type = update?.type as string;
        if (type === "AgentMessageChunk") {
          const content = update?.content as Record<string, unknown>[];
          if (content) {
            for (const block of content) {
              if (block.type === "text") {
                this.currentAssistantMsg += block.text as string;
              }
            }
          }
          this.renderMessages();
        } else if (type === "TurnEnd") {
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

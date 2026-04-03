import { ItemView, WorkspaceLeaf, MarkdownRenderer } from "obsidian";
import { AcpClient, AcpMessage } from "./acp-client";
import type KiroPlugin from "./main";
import { klog } from "./main";

export const KIRO_VIEW_TYPE = "kiro-chat";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export class KiroChatView extends ItemView {
  private client: AcpClient;
  private plugin: KiroPlugin;
  private messages: ChatMessage[] = [];
  private inputEl!: HTMLTextAreaElement;
  private messagesEl!: HTMLDivElement;
  private statusEl!: HTMLDivElement;
  private sendBtn!: HTMLButtonElement;
  private currentAssistantMsg = "";
  private isStreaming = false;

  constructor(leaf: WorkspaceLeaf, plugin: KiroPlugin) {
    super(leaf);
    this.plugin = plugin;
    this.client = new AcpClient(plugin.settings.kiroPath, plugin.settings);
    this.client.setUpdateHandler((msg) => this.handleUpdate(msg));
  }

  getViewType(): string { return KIRO_VIEW_TYPE; }
  getDisplayText(): string { return "Kiro"; }
  getIcon(): string { return "bot"; }

  async onOpen() {
    klog(this.plugin.settings, "ChatView onOpen");
    const container = this.containerEl.children[1] as HTMLElement;
    container.empty();
    container.addClass("kiro-chat-container");

    this.statusEl = container.createDiv({ cls: "kiro-status" });
    this.statusEl.setText("Starting Kiro...");

    this.messagesEl = container.createDiv({ cls: "kiro-messages" });

    const inputRow = container.createDiv({ cls: "kiro-input-row" });
    this.inputEl = inputRow.createEl("textarea", {
      cls: "kiro-input",
      attr: { placeholder: "Ask Kiro anything... Use @NoteName to include a note", rows: "2" },
    });
    this.sendBtn = inputRow.createEl("button", { cls: "kiro-send-btn", text: "Send" });
    this.sendBtn.addEventListener("click", () => this.onSendClick());
    this.inputEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        this.onSendClick();
      }
    });

    try {
      await this.client.start();
      await this.client.initialize();
      const vaultPath = (this.app.vault.adapter as any).basePath || "/";
      klog(this.plugin.settings, "cwd:", vaultPath);
      await this.client.newSession(vaultPath);
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

  private async onSendClick() {
    if (this.isStreaming) {
      // Cancel
      this.client.cancel();
      this.isStreaming = false;
      this.sendBtn.setText("Send");
      this.statusEl.setText("Cancelled");
      if (this.currentAssistantMsg) {
        this.messages.push({ role: "assistant", content: this.currentAssistantMsg + "\n\n*(cancelled)*" });
        this.currentAssistantMsg = "";
      }
      this.renderMessages();
      return;
    }
    await this.sendMessage();
  }

  private async sendMessage() {
    const text = this.inputEl.value.trim();
    if (!text) return;

    this.inputEl.value = "";
    this.currentAssistantMsg = "";
    this.isStreaming = true;
    this.sendBtn.setText("Stop");
    this.statusEl.setText("Thinking...");

    // Build prompt content
    const promptContent: Array<Record<string, unknown>> = [];

    // Resolve @mentions
    const mentionedNotes = await this.resolveMentions(text);
    for (const note of mentionedNotes) {
      promptContent.push({
        type: "resource",
        resource: {
          uri: `file:///${note.title}.md`,
          mimeType: "text/markdown",
          text: note.content,
        },
      });
    }

    // Auto-include active note if enabled and no @mentions
    if (this.plugin.settings.autoIncludeActiveNote && mentionedNotes.length === 0) {
      const activeNote = await this.plugin.readActiveNote();
      if (activeNote) {
        promptContent.push({
          type: "resource",
          resource: {
            uri: `file:///${activeNote.title}.md`,
            mimeType: "text/markdown",
            text: activeNote.content,
          },
        });
      }
    }

    // Clean @mentions from display text
    const displayText = text.replace(/@"[^"]+"/g, (m) => m).trim();
    this.messages.push({ role: "user", content: displayText });
    promptContent.push({ type: "text", text });

    this.renderMessages();

    try {
      await this.client.prompt(promptContent);
      if (this.currentAssistantMsg) {
        this.messages.push({ role: "assistant", content: this.currentAssistantMsg });
        this.currentAssistantMsg = "";
      }
    } catch (e) {
      if (String(e).includes("timed out")) {
        this.messages.push({ role: "assistant", content: "Request timed out. Try again." });
      } else {
        this.messages.push({ role: "assistant", content: `Error: ${e}` });
      }
    }

    this.isStreaming = false;
    this.sendBtn.setText("Send");
    this.statusEl.setText("Connected");
    this.renderMessages();
  }

  private async resolveMentions(text: string): Promise<Array<{ title: string; content: string }>> {
    const mentions: Array<{ title: string; content: string }> = [];
    // Match @"Note Name" or @NoteName (no spaces)
    const regex = /@"([^"]+)"|@(\S+)/g;
    let match;
    while ((match = regex.exec(text)) !== null) {
      const name = match[1] || match[2];
      const content = await this.plugin.readNoteByName(name);
      if (content) {
        mentions.push({ title: name, content });
        klog(this.plugin.settings, "Resolved @mention:", name);
      }
    }
    return mentions;
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
      } else if (type === "tool_call") {
        const title = update.title as string || "Tool call";
        this.currentAssistantMsg += `\n\n🔧 *${title}*\n`;
        this.renderMessages();
      } else if (type === "tool_call_update") {
        const status = update.status as string;
        if (status === "completed") {
          const content = update.content as Array<Record<string, unknown>>;
          if (content) {
            for (const block of content) {
              const inner = block.content as Record<string, unknown>;
              if (inner?.type === "text") {
                this.currentAssistantMsg += `\n${inner.text}\n`;
              }
            }
          }
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

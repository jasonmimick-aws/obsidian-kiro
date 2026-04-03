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
  private contextEl!: HTMLDivElement;
  private sendBtn!: HTMLButtonElement;
  private cancelBtn!: HTMLButtonElement;
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

    // Header bar
    const header = container.createDiv({ cls: "kiro-header" });
    const brand = header.createDiv({ cls: "kiro-brand" });
    brand.innerHTML = `<svg width="20" height="24" viewBox="0 0 20 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M3.8 18.57C1.32 24.06 6.6 25.43 10.49 22.22C11.63 25.82 15.93 23.14 17.47 20.34C20.86 14.19 19.49 7.91 19.14 6.62C16.72-2.21 4.67-2.22 2.6 6.66C2.11 8.22 2.1 9.99 1.83 11.82C1.69 12.75 1.59 13.34 1.23 14.31C1.03 14.87.75 15.37.3 16.21C-.39 17.51-.1 20.02 3.46 18.72L3.8 18.57Z" fill="currentColor"/><path d="M10.96 10.44C9.97 10.44 9.82 9.26 9.82 8.55C9.82 7.92 9.94 7.41 10.15 7.09C10.34 6.81 10.62 6.67 10.96 6.67C11.31 6.67 11.6 6.81 11.81 7.1C12.05 7.43 12.18 7.93 12.18 8.55C12.18 9.74 11.72 10.44 10.96 10.44Z" fill="var(--background-primary)"/><path d="M15.03 10.44C14.04 10.44 13.89 9.26 13.89 8.55C13.89 7.92 14.01 7.41 14.22 7.09C14.41 6.81 14.69 6.67 15.03 6.67C15.38 6.67 15.67 6.81 15.88 7.1C16.12 7.43 16.25 7.93 16.25 8.55C16.25 9.74 15.79 10.44 15.03 10.44Z" fill="var(--background-primary)"/></svg>`;
    brand.createSpan({ cls: "kiro-brand-text", text: "Kiro" });
    this.statusEl = header.createDiv({ cls: "kiro-status" });
    this.statusEl.setText("Starting...");
    const headerBtns = header.createDiv({ cls: "kiro-header-btns" });
    this.cancelBtn = headerBtns.createEl("button", { cls: "kiro-header-btn", text: "⏹ Stop", attr: { title: "Cancel current request" } });
    this.cancelBtn.addEventListener("click", () => this.cancelStream());
    this.cancelBtn.style.display = "none";
    const restartBtn = headerBtns.createEl("button", { cls: "kiro-header-btn", text: "↻ Restart", attr: { title: "Restart Kiro agent" } });
    restartBtn.addEventListener("click", () => this.restart());
    const clearBtn = headerBtns.createEl("button", { cls: "kiro-header-btn", text: "🗑 Clear", attr: { title: "Clear chat history" } });
    clearBtn.addEventListener("click", () => { this.messages = []; this.renderMessages(); });

    this.messagesEl = container.createDiv({ cls: "kiro-messages" });

    // Context bar - shows what note is attached
    this.contextEl = container.createDiv({ cls: "kiro-context-bar" });
    this.updateContextBar();

    // Listen for active file changes
    this.registerEvent(this.app.workspace.on("active-leaf-change", () => this.updateContextBar()));

    const inputRow = container.createDiv({ cls: "kiro-input-row" });
    this.inputEl = inputRow.createEl("textarea", {
      cls: "kiro-input",
      attr: { placeholder: "Ask Kiro anything... Use @NoteName to include a note", rows: "2" },
    });
    this.sendBtn = inputRow.createEl("button", { cls: "kiro-send-btn", text: "Send" });
    this.sendBtn.addEventListener("click", () => this.sendMessage());
    this.inputEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        this.sendMessage();
      }
    });

    await this.connectAgent();
  }

  async onClose() {
    this.client.stop();
  }

  private async connectAgent() {
    this.statusEl.setText("Starting...");
    this.statusEl.removeClass("kiro-status-connected");
    this.statusEl.removeClass("kiro-status-error");
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
      this.statusEl.setText(`Failed: ${e}`);
      this.statusEl.addClass("kiro-status-error");
    }
  }

  private async restart() {
    this.client.stop();
    this.client = new AcpClient(this.plugin.settings.kiroPath, this.plugin.settings);
    this.client.setUpdateHandler((msg) => this.handleUpdate(msg));
    this.isStreaming = false;
    this.currentAssistantMsg = "";
    this.cancelBtn.style.display = "none";
    await this.connectAgent();
  }

  private cancelStream() {
    if (!this.isStreaming) return;
    this.client.cancel();
    this.isStreaming = false;
    this.cancelBtn.style.display = "none";
    this.statusEl.setText("Cancelled");
    if (this.currentAssistantMsg) {
      this.messages.push({ role: "assistant", content: this.currentAssistantMsg + "\n\n*(cancelled)*" });
      this.currentAssistantMsg = "";
    }
    this.renderMessages();
  }

  private updateContextBar() {
    this.contextEl.empty();
    if (!this.plugin.settings.autoIncludeActiveNote) {
      this.contextEl.style.display = "none";
      return;
    }
    const file = this.app.workspace.getActiveFile();
    if (file && file.extension === "md") {
      this.contextEl.style.display = "flex";
      this.contextEl.setText(`📎 ${file.basename}`);
    } else {
      this.contextEl.style.display = "none";
    }
  }

  private async sendMessage() {
    const text = this.inputEl.value.trim();
    if (!text || this.isStreaming) return;

    this.inputEl.value = "";
    this.currentAssistantMsg = "";
    this.isStreaming = true;
    this.cancelBtn.style.display = "";
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

    // Build display text showing context
    const contextNames: string[] = [];
    for (const note of mentionedNotes) contextNames.push(`@${note.title}`);

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
        contextNames.push(`📎 ${activeNote.title}`);
      }
    }

    const displayText = contextNames.length > 0
      ? `${text}\n\n*Context: ${contextNames.join(", ")}*`
      : text;
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
    this.cancelBtn.style.display = "none";
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

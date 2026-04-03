import { Plugin, PluginSettingTab, Setting, WorkspaceLeaf, App } from "obsidian";
import { KiroChatView, KIRO_VIEW_TYPE } from "./chat-view";
import { existsSync } from "fs";
import { homedir } from "os";
import { join } from "path";

export interface KiroSettings {
  kiroPath: string;
  debug: boolean;
  autoIncludeActiveNote: boolean;
}

function findKiroCli(): string {
  const candidates = [
    join(homedir(), ".local", "bin", "kiro-cli"),
    "/usr/local/bin/kiro-cli",
    "/opt/homebrew/bin/kiro-cli",
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return "kiro-cli";
}

const DEFAULT_SETTINGS: KiroSettings = {
  kiroPath: findKiroCli(),
  debug: false,
  autoIncludeActiveNote: true,
};

export function klog(settings: KiroSettings, ...args: unknown[]) {
  if (settings.debug) console.log("[Kiro]", ...args);
}

export default class KiroPlugin extends Plugin {
  settings!: KiroSettings;

  async onload() {
    await this.loadSettings();
    klog(this.settings, "Plugin loading, kiroPath:", this.settings.kiroPath);

    this.registerView(KIRO_VIEW_TYPE, (leaf) => new KiroChatView(leaf, this));

    this.addRibbonIcon("bot", "Open Kiro", () => this.activateView());

    this.addCommand({
      id: "open-kiro-chat",
      name: "Open Kiro chat",
      callback: () => this.activateView(),
    });

    this.addSettingTab(new KiroSettingTab(this.app, this));
    klog(this.settings, "Plugin loaded");
  }

  async activateView() {
    const existing = this.app.workspace.getLeavesOfType(KIRO_VIEW_TYPE);
    if (existing.length) {
      this.app.workspace.revealLeaf(existing[0]);
      return;
    }
    const leaf = this.app.workspace.getRightLeaf(false);
    if (leaf) {
      await leaf.setViewState({ type: KIRO_VIEW_TYPE, active: true });
      this.app.workspace.revealLeaf(leaf);
    }
  }

  getActiveNoteContent(): { title: string; content: string } | null {
    const file = this.app.workspace.getActiveFile();
    if (!file) return null;
    const cache = this.app.vault.cachedRead(file);
    return cache ? null : null; // async, handle below
  }

  async readActiveNote(): Promise<{ title: string; content: string } | null> {
    const file = this.app.workspace.getActiveFile();
    if (!file || file.extension !== "md") return null;
    const content = await this.app.vault.read(file);
    return { title: file.basename, content };
  }

  async getAllNotes(): Promise<string[]> {
    return this.app.vault.getMarkdownFiles().map((f) => f.basename);
  }

  async readNoteByName(name: string): Promise<string | null> {
    const file = this.app.vault.getMarkdownFiles().find(
      (f) => f.basename.toLowerCase() === name.toLowerCase()
    );
    if (!file) return null;
    return this.app.vault.read(file);
  }

  onunload() {}

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}

class KiroSettingTab extends PluginSettingTab {
  plugin: KiroPlugin;

  constructor(app: App, plugin: KiroPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName("Kiro CLI path")
      .setDesc("Full path to kiro-cli binary")
      .addText((text) =>
        text.setValue(this.plugin.settings.kiroPath).onChange(async (value) => {
          this.plugin.settings.kiroPath = value;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Auto-include active note")
      .setDesc("Automatically include the active note as context when sending messages")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.autoIncludeActiveNote).onChange(async (value) => {
          this.plugin.settings.autoIncludeActiveNote = value;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Debug logging")
      .setDesc("Enable verbose logging in the developer console (Cmd+Option+I)")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.debug).onChange(async (value) => {
          this.plugin.settings.debug = value;
          await this.plugin.saveSettings();
        })
      );
  }
}

import { Plugin, PluginSettingTab, Setting, WorkspaceLeaf, App, addIcon } from "obsidian";
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

    addIcon("kiro-ghost", `<svg viewBox="0 0 20 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M3.8 18.57C1.32 24.06 6.6 25.43 10.49 22.22C11.63 25.82 15.93 23.14 17.47 20.34C20.86 14.19 19.49 7.91 19.14 6.62C16.72-2.21 4.67-2.22 2.6 6.66C2.11 8.22 2.1 9.99 1.83 11.82C1.69 12.75 1.59 13.34 1.23 14.31C1.03 14.87.75 15.37.3 16.21C-.39 17.51-.1 20.02 3.46 18.72L3.8 18.57Z" fill="currentColor"/><path d="M10.96 10.44C9.97 10.44 9.82 9.26 9.82 8.55C9.82 7.92 9.94 7.41 10.15 7.09C10.34 6.81 10.62 6.67 10.96 6.67C11.31 6.67 11.6 6.81 11.81 7.1C12.05 7.43 12.18 7.93 12.18 8.55C12.18 9.74 11.72 10.44 10.96 10.44Z" fill="white"/><path d="M15.03 10.44C14.04 10.44 13.89 9.26 13.89 8.55C13.89 7.92 14.01 7.41 14.22 7.09C14.41 6.81 14.69 6.67 15.03 6.67C15.38 6.67 15.67 6.81 15.88 7.1C16.12 7.43 16.25 7.93 16.25 8.55C16.25 9.74 15.79 10.44 15.03 10.44Z" fill="white"/></svg>`);
    this.addRibbonIcon("kiro-ghost", "Open Kiro", () => this.activateView());

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
      (f) => f.basename.toLowerCase() === name.toLowerCase() &&
        !f.path.startsWith("node_modules/") && !f.path.startsWith(".obsidian/")
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

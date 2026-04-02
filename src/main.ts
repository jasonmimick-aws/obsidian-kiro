import { Plugin, WorkspaceLeaf } from "obsidian";
import { KiroChatView, KIRO_VIEW_TYPE } from "./chat-view";

interface KiroSettings {
  kiroPath: string;
}

const DEFAULT_SETTINGS: KiroSettings = {
  kiroPath: "kiro-cli",
};

export default class KiroPlugin extends Plugin {
  settings!: KiroSettings;

  async onload() {
    await this.loadSettings();

    this.registerView(KIRO_VIEW_TYPE, (leaf) => new KiroChatView(leaf, this.settings.kiroPath));

    this.addRibbonIcon("bot", "Open Kiro", () => this.activateView());

    this.addCommand({
      id: "open-kiro-chat",
      name: "Open Kiro chat",
      callback: () => this.activateView(),
    });
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

  onunload() {}

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}

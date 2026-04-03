import { Plugin, WorkspaceLeaf } from "obsidian";
import { KiroChatView, KIRO_VIEW_TYPE } from "./chat-view";
import { existsSync } from "fs";
import { homedir } from "os";
import { join } from "path";

interface KiroSettings {
  kiroPath: string;
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
};

export default class KiroPlugin extends Plugin {
  settings!: KiroSettings;

  async onload() {
    console.log("[Kiro] Plugin loading...");
    await this.loadSettings();
    console.log("[Kiro] Settings loaded, kiroPath:", this.settings.kiroPath);

    this.registerView(KIRO_VIEW_TYPE, (leaf) => {
      console.log("[Kiro] Creating chat view");
      return new KiroChatView(leaf, this.settings.kiroPath);
    });

    this.addRibbonIcon("bot", "Open Kiro", () => {
      console.log("[Kiro] Ribbon icon clicked");
      this.activateView();
    });

    this.addCommand({
      id: "open-kiro-chat",
      name: "Open Kiro chat",
      callback: () => this.activateView(),
    });

    console.log("[Kiro] Plugin loaded successfully");
  }

  async activateView() {
    console.log("[Kiro] Activating view...");
    const existing = this.app.workspace.getLeavesOfType(KIRO_VIEW_TYPE);
    if (existing.length) {
      console.log("[Kiro] Found existing view, revealing");
      this.app.workspace.revealLeaf(existing[0]);
      return;
    }
    const leaf = this.app.workspace.getRightLeaf(false);
    if (leaf) {
      console.log("[Kiro] Creating new view in right leaf");
      await leaf.setViewState({ type: KIRO_VIEW_TYPE, active: true });
      this.app.workspace.revealLeaf(leaf);
    } else {
      console.error("[Kiro] Could not get right leaf");
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

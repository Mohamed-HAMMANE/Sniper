import * as fs from 'fs';
import * as path from 'path';
import { Config, TargetCollection } from '../types';

const CONFIG_PATH = path.join(process.cwd(), 'config.json');

export class ConfigManager {
  private config: Config;

  constructor() {
    this.config = this.loadConfig();
  }

  private loadConfig(): Config {
    try {
      if (fs.existsSync(CONFIG_PATH)) {
        const data = fs.readFileSync(CONFIG_PATH, 'utf-8');
        return JSON.parse(data);
      }
    } catch (error) {
      console.error('Error loading config:', error);
    }

    // Return default config
    return { targets: [] };
  }

  public async saveConfig(): Promise<void> {
    try {
      await fs.promises.writeFile(CONFIG_PATH, JSON.stringify(this.config, null, 2), 'utf-8');
      console.log('Config saved successfully');
    } catch (error) {
      console.error('Error saving config:', error);
    }
  }

  public getConfig(): Config {
    return this.config;
  }

  public getTargets(): TargetCollection[] {
    return this.config.targets || [];
  }

  public async addTarget(target: TargetCollection): Promise<void> {
    if (!this.config.targets) {
      this.config.targets = [];
    }

    // Remove existing target for same symbol if exists (update)
    this.config.targets = this.config.targets.filter(t => t.symbol !== target.symbol);
    this.config.targets.push(target);
    await this.saveConfig();
  }

  public async removeTarget(symbol: string): Promise<void> {
    if (!this.config.targets) return;
    this.config.targets = this.config.targets.filter(t => t.symbol !== symbol);
    await this.saveConfig();
  }
}

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
    return {};
  }

  public saveConfig(): void {
    try {
      fs.writeFileSync(CONFIG_PATH, JSON.stringify(this.config, null, 2), 'utf-8');
      console.log('Config saved successfully');
    } catch (error) {
      console.error('Error saving config:', error);
    }
  }

  public getConfig(): Config {
    return this.config;
  }

  public getTarget(): TargetCollection | undefined {
    return this.config.target;
  }

  public setTarget(target: TargetCollection): void {
    this.config.target = target;
    this.saveConfig();
  }

  public removeTarget(): void {
    delete this.config.target;
    this.saveConfig();
  }
}

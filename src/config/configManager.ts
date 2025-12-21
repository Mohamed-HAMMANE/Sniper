import * as fs from 'fs';
import * as path from 'path';
import { Config, TargetCollection, FilterRule } from '../types';

const CONFIG_PATH = path.join(process.cwd(), 'config.json');

// Generate simple unique ID
function generateId(): string {
  return 'f_' + Date.now().toString(36) + Math.random().toString(36).substring(2, 7);
}

export class ConfigManager {
  private config: Config;

  constructor() {
    this.config = this.loadConfig();
  }

  private loadConfig(): Config {
    try {
      if (fs.existsSync(CONFIG_PATH)) {
        const data = fs.readFileSync(CONFIG_PATH, 'utf-8');
        if (!data || data.trim().length === 0) return { targets: [] };
        const parsed = JSON.parse(data);

        // Migration: Convert old flat targets to new nested filters format
        if (parsed.targets && parsed.targets.length > 0) {
          parsed.targets = parsed.targets.map((t: any) => this.migrateTarget(t));
        }

        return parsed;
      }
    } catch (error) {
      // User requested no logging and no auto-repair.
      // Silently fall back to default empty config in-memory.
    }

    // Return default config
    return { targets: [] };
  }

  // Migrate old flat target format to new nested filters format
  private migrateTarget(target: any): TargetCollection {
    // Already new format
    if (target.filters && Array.isArray(target.filters)) {
      // Ensure all filters have IDs
      target.filters = target.filters.map((f: any) => ({
        ...f,
        id: f.id || generateId(),
        autoBuy: f.autoBuy ?? false,
        buyLimit: f.buyLimit,
        buyCount: f.buyCount ?? 0
      }));
      return target;
    }

    // Old format: convert to new
    console.log(`[Config] Migrating old target format for ${target.symbol}`);
    return {
      symbol: target.symbol,
      filters: [{
        id: generateId(),
        priceMax: target.priceMax ?? 1000,
        maxRank: target.maxRank,
        minRarity: target.minRarity ?? 'COMMON',
        rarityType: target.rarityType ?? 'statistical',
        traitFilters: target.traitFilters,
        autoBuy: target.autoBuy ?? false,
        buyLimit: target.buyLimit,
        buyCount: target.buyCount ?? 0
      }]
    };
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

  // Add or update entire target (used when adding a new collection with first filter)
  public async addTarget(target: TargetCollection): Promise<void> {
    if (!this.config.targets) {
      this.config.targets = [];
    }

    // Ensure all filters have IDs
    if (target.filters) {
      target.filters = target.filters.map(f => ({
        ...f,
        id: f.id || generateId()
      }));
    }

    // Remove existing target for same symbol if exists (update)
    this.config.targets = this.config.targets.filter(t => t.symbol !== target.symbol);
    this.config.targets.push(target);
    await this.saveConfig();
  }

  // Add a new filter to an existing collection
  public async addFilter(symbol: string, filter: Omit<FilterRule, 'id'>): Promise<FilterRule | null> {
    const target = this.config.targets.find(t => t.symbol === symbol);
    if (!target) return null;

    const newFilter: FilterRule = {
      ...filter,
      id: generateId()
    };

    target.filters.push(newFilter);
    await this.saveConfig();
    return newFilter;
  }

  // Update a specific filter
  public async updateFilter(symbol: string, filterId: string, updates: Partial<FilterRule>): Promise<boolean> {
    const target = this.config.targets.find(t => t.symbol === symbol);
    if (!target) return false;

    const filter = target.filters.find(f => f.id === filterId);
    if (!filter) return false;

    Object.assign(filter, updates);
    await this.saveConfig();
    return true;
  }

  // Remove a specific filter (removes collection if last filter)
  public async removeFilter(symbol: string, filterId: string): Promise<{ removed: boolean; collectionRemoved: boolean }> {
    const target = this.config.targets.find(t => t.symbol === symbol);
    if (!target) return { removed: false, collectionRemoved: false };

    const idx = target.filters.findIndex(f => f.id === filterId);
    if (idx === -1) return { removed: false, collectionRemoved: false };

    target.filters.splice(idx, 1);

    // If no filters left, remove the entire collection
    if (target.filters.length === 0) {
      this.config.targets = this.config.targets.filter(t => t.symbol !== symbol);
      await this.saveConfig();
      return { removed: true, collectionRemoved: true };
    }

    await this.saveConfig();
    return { removed: true, collectionRemoved: false };
  }

  // Remove entire collection
  public async removeTarget(symbol: string): Promise<boolean> {
    if (!this.config.targets) return false;
    const initialLength = this.config.targets.length;
    this.config.targets = this.config.targets.filter(t => t.symbol !== symbol);
    if (this.config.targets.length < initialLength) {
      await this.saveConfig();
      return true;
    }
    return false;
  }

  // Increment buy count for a specific filter
  public async incrementBuyCount(symbol: string, filterId: string): Promise<void> {
    const target = this.config.targets.find(t => t.symbol === symbol);
    if (!target) return;

    const filter = target.filters.find(f => f.id === filterId);
    if (!filter) return;

    filter.buyCount = (filter.buyCount || 0) + 1;
    await this.saveConfig();
  }

  public async setTargetCollapsed(symbol: string, collapsed: boolean): Promise<boolean> {
    const target = this.config.targets.find(t => t.symbol === symbol);
    if (!target) return false;

    target.collapsed = collapsed;
    await this.saveConfig();
    return true;
  }
}

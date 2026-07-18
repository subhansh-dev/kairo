/**
 * Plugin marketplace — discover and manage plugins.
 */

export interface PluginInfo {
  id: string;
  name: string;
  description: string;
  author: string;
  version: string;
  downloads: number;
  rating: number;
  installed: boolean;
  category: string;
  tags: string[];
  repository?: string;
}

export interface PluginMarketplace {
  plugins: PluginInfo[];
  installed: Set<string>;
  search(query: string): PluginInfo[];
  get(id: string): PluginInfo | undefined;
  install(id: string): boolean;
  uninstall(id: string): boolean;
  isInstalled(id: string): boolean;
  listInstalled(): PluginInfo[];
  listByCategory(category: string): PluginInfo[];
}

/**
 * Create a plugin marketplace.
 */
export function createPluginMarketplace(): PluginMarketplace {
  const plugins: PluginInfo[] = [];
  const installed = new Set<string>();

  return {
    plugins,
    installed,

    search(query) {
      const q = query.toLowerCase();
      return plugins.filter(
        p => p.name.toLowerCase().includes(q) ||
             p.description.toLowerCase().includes(q) ||
             p.tags.some(t => t.toLowerCase().includes(q)),
      );
    },

    get(id) {
      return plugins.find(p => p.id === id);
    },

    install(id) {
      const plugin = plugins.find(p => p.id === id);
      if (!plugin) return false;
      installed.add(id);
      plugin.installed = true;
      return true;
    },

    uninstall(id) {
      const plugin = plugins.find(p => p.id === id);
      if (!plugin) return false;
      installed.delete(id);
      plugin.installed = false;
      return true;
    },

    isInstalled(id) {
      return installed.has(id);
    },

    listInstalled() {
      return plugins.filter(p => installed.has(p.id));
    },

    listByCategory(category) {
      return plugins.filter(p => p.category === category);
    },
  };
}

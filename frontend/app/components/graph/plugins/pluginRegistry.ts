/**
 * Plugin Registry - Central registry for domain plugins
 */

import type { DomainPlugin } from './types';

// Import plugins (lazy-loaded to avoid circular dependencies)
let lecturePlugin: DomainPlugin | null = null;

export function registerLecturePlugin(plugin: DomainPlugin) {
  lecturePlugin = plugin;
}

export function getPlugin(pluginId: string): DomainPlugin | null {
  switch (pluginId) {
    case 'lecture':
      return lecturePlugin;
    default:
      return null;
  }
}

export function getAllPlugins(): DomainPlugin[] {
  const plugins: DomainPlugin[] = [];
  if (lecturePlugin) plugins.push(lecturePlugin);
  return plugins;
}

export function getPluginForDomain(domain: string): DomainPlugin | null {
  // Map domain strings to plugin IDs
  const domainMap: Record<string, string> = {
    'lecture': 'lecture',
    'learning': 'lecture',
  };
  
  const pluginId = domainMap[domain?.toLowerCase() || ''];
  return pluginId ? getPlugin(pluginId) : null;
}

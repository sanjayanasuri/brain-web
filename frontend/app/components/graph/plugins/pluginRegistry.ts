/**
 * Plugin Registry - Central registry for domain plugins
 */

import type { DomainPlugin } from './types';

// Import plugins (lazy-loaded to avoid circular dependencies)
let financePlugin: DomainPlugin | null = null;
let lecturePlugin: DomainPlugin | null = null;

export function registerFinancePlugin(plugin: DomainPlugin) {
  financePlugin = plugin;
}

export function registerLecturePlugin(plugin: DomainPlugin) {
  lecturePlugin = plugin;
}

export function getPlugin(pluginId: string): DomainPlugin | null {
  switch (pluginId) {
    case 'finance':
      return financePlugin;
    case 'lecture':
      return lecturePlugin;
    default:
      return null;
  }
}

export function getAllPlugins(): DomainPlugin[] {
  const plugins: DomainPlugin[] = [];
  if (financePlugin) plugins.push(financePlugin);
  if (lecturePlugin) plugins.push(lecturePlugin);
  return plugins;
}

export function getPluginForDomain(domain: string): DomainPlugin | null {
  // Map domain strings to plugin IDs
  const domainMap: Record<string, string> = {
    'finance': 'finance',
    'financial': 'finance',
    'lecture': 'lecture',
    'learning': 'lecture',
  };
  
  const pluginId = domainMap[domain?.toLowerCase() || ''];
  return pluginId ? getPlugin(pluginId) : null;
}


/**
 * Skill bundles — aliases that load multiple skills under one slash command.
 *
 * A skill bundle is a YAML file that names a set of skills to load together.
 * Invoking /<bundle-name> loads every referenced skill's content into a single message.
 */

import { existsSync, readFileSync, readdirSync, statSync, mkdirSync, writeFileSync, unlinkSync } from 'fs';
import { join, basename, extname } from 'path';
import { homedir } from 'os';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';

export interface SkillBundle {
  name: string;
  slug: string;
  description: string;
  skills: string[];
  instruction: string;
  path: string;
}

// Cache
let bundlesCache: Map<string, SkillBundle> = new Map();
let bundlesCacheMtime = 0;

const INVALID_CHARS = /[^a-z0-9-]/g;
const MULTI_HYPHEN = /-{2,}/g;

/**
 * Normalize a name into a URL-friendly slug.
 */
function slugify(name: string): string {
  let cmd = name.toLowerCase().replace(/[\s_]/g, '-');
  cmd = cmd.replace(INVALID_CHARS, '');
  cmd = cmd.replace(MULTI_HYPHEN, '-').replace(/^-|-$/g, '');
  return cmd;
}

/**
 * Get the bundles directory path.
 */
function bundlesDir(): string {
  const override = process.env.KAIRO_BUNDLES_DIR;
  if (override) return override;
  return join(homedir(), '.kairo', 'skill-bundles');
}

/**
 * Load a single bundle YAML file.
 */
function loadBundleFile(path: string): SkillBundle | null {
  try {
    const raw = readFileSync(path, 'utf-8');
    const data = parseYaml(raw);
    if (typeof data !== 'object' || data === null) return null;

    const name = String(data.name || basename(path, extname(path))).trim();
    if (!name) return null;

    const skills = Array.isArray(data.skills) ? data.skills.map((s: any) => String(s).trim()).filter(Boolean) : [];
    if (skills.length === 0) return null;

    const description = String(data.description || '').trim() || `Load ${skills.length} skills as a bundle`;
    const instruction = String(data.instruction || '').trim();
    const slug = slugify(name);
    if (!slug) return null;

    return { name, slug, description, skills, instruction, path };
  } catch {
    return null;
  }
}

/**
 * Scan the bundles directory and rebuild the cache.
 */
export function scanBundles(): Map<string, SkillBundle> {
  const dir = bundlesDir();
  const out = new Map<string, SkillBundle>();

  if (!existsSync(dir)) {
    bundlesCache = out;
    return out;
  }

  try {
    const files = readdirSync(dir)
      .filter(f => f.endsWith('.yaml') || f.endsWith('.yml'))
      .sort();

    let maxMtime = 0;
    try { maxMtime = statSync(dir).mtimeMs; } catch { /* ok */ }

    for (const file of files) {
      const filePath = join(dir, file);
      try {
        const mtime = statSync(filePath).mtimeMs;
        if (mtime > maxMtime) maxMtime = mtime;
      } catch { /* ok */ }

      const info = loadBundleFile(filePath);
      if (!info) continue;
      const key = `/${info.slug}`;
      if (out.has(key)) continue; // first wins
      out.set(key, info);
    }

    bundlesCache = out;
    bundlesCacheMtime = maxMtime;
  } catch { /* dir read error */ }

  return out;
}

/**
 * Get the current bundle mapping, rescanning when disk changed.
 */
export function getSkillBundles(): Map<string, SkillBundle> {
  const dir = bundlesDir();
  if (!existsSync(dir)) return bundlesCache;

  try {
    const files = readdirSync(dir).filter(f => f.endsWith('.yaml') || f.endsWith('.yml'));
    let maxMtime = 0;
    try { maxMtime = statSync(dir).mtimeMs; } catch { /* ok */ }
    for (const file of files) {
      try {
        const mtime = statSync(join(dir, file)).mtimeMs;
        if (mtime > maxMtime) maxMtime = mtime;
      } catch { /* ok */ }
    }
    if (maxMtime > bundlesCacheMtime) return scanBundles();
  } catch { /* ok */ }

  return bundlesCache;
}

/**
 * Build the full user message for a bundle invocation.
 */
export function buildBundleInvocationMessage(
  bundle: SkillBundle,
  skillContents: Map<string, string>,
): string | null {
  const parts: string[] = [];
  if (bundle.instruction) parts.push(bundle.instruction);

  for (const skillName of bundle.skills) {
    const content = skillContents.get(skillName);
    if (content) {
      parts.push(`### ${skillName}\n${content}`);
    }
  }

  return parts.length > 0 ? parts.join('\n\n') : null;
}

/**
 * List all bundles for display.
 */
export function listBundles(): SkillBundle[] {
  return [...getSkillBundles().values()];
}

/**
 * Save a bundle to disk.
 */
export function saveBundle(bundle: Omit<SkillBundle, 'path' | 'slug'>): SkillBundle {
  const dir = bundlesDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const slug = slugify(bundle.name);
  const path = join(dir, `${slug}.yaml`);
  const data = {
    name: bundle.name,
    description: bundle.description,
    skills: bundle.skills,
    instruction: bundle.instruction || '',
  };
  writeFileSync(path, stringifyYaml(data), 'utf-8');
  const full: SkillBundle = { ...bundle, slug, path };
  bundlesCache.set(`/${slug}`, full);
  return full;
}

/**
 * Delete a bundle from disk.
 */
export function deleteBundle(slug: string): boolean {
  const key = `/${slugify(slug)}`;
  const bundle = bundlesCache.get(key);
  if (!bundle) return false;
  try {
    unlinkSync(bundle.path);
    bundlesCache.delete(key);
    return true;
  } catch {
    return false;
  }
}

/**
 * A slice of the project file owned by a panel or another editor package.
 *
 * `save` must return JSON (objects, arrays, strings, numbers, booleans, or null).
 * `load` receives that value on project open. The shell skips a section that is
 * not registered, and skips a registered section that is absent from the file.
 */
export interface ProjectSection {
  save(): unknown;
  load(data: unknown): void;
}

export interface ProjectSectionWarning {
  id: string;
  reason: 'unknown' | 'missing';
  message: string;
}

const sections = new Map<string, ProjectSection>();

/**
 * Register a project-file section. The returned function removes it when this
 * registration is still the current one.
 */
export function registerProjectSection(id: string, section: ProjectSection): () => void {
  if (id.trim() === '') throw new Error('Project section id must be a non-empty string');
  sections.set(id, section);
  return () => {
    if (sections.get(id) !== section) return;
    sections.delete(id);
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function jsonValue(value: unknown): unknown {
  if (value === undefined) return null;
  return JSON.parse(JSON.stringify(value)) as unknown;
}

/** Snapshot every registered section. A section that cannot be serialized is omitted. */
export function collectProjectSections(): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [id, section] of sections) {
    try {
      out[id] = jsonValue(section.save());
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'not JSON-serializable';
      console.warn(`Skipped project section "${id}" while saving: ${detail}`);
    }
  }
  return out;
}

/**
 * Restore registered sections from a project file.
 *
 * An id in `data` with no registration is skipped. A registration whose id is
 * absent from `data` is skipped and `load` is not called. Both cases warn.
 */
export function applyProjectSections(data: unknown): ProjectSectionWarning[] {
  const warnings: ProjectSectionWarning[] = [];
  const saved = isRecord(data) ? data : {};
  if (data !== undefined && !isRecord(data)) {
    const message = 'Skipped project sections: expected an object';
    console.warn(message);
    warnings.push({ id: '', reason: 'unknown', message });
  }
  const known = new Set(sections.keys());
  if (isRecord(data)) {
    for (const id of Object.keys(data)) {
      if (known.has(id)) continue;
      const message = `Skipped unknown project section "${id}"`;
      console.warn(message);
      warnings.push({ id, reason: 'unknown', message });
    }
  }
  for (const [id, section] of sections) {
    if (!Object.prototype.hasOwnProperty.call(saved, id)) {
      const message = `Skipped missing project section "${id}"`;
      console.warn(message);
      warnings.push({ id, reason: 'missing', message });
      continue;
    }
    section.load(saved[id]);
  }
  return warnings;
}

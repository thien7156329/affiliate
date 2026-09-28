import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";

export interface WorkspaceProject {
  id: string;
  name: string;
  root: string;
  createdAt: string;
}

export interface FileEntry {
  name: string;
  path: string;
  type: "file" | "directory";
  size?: number;
}

const IGNORED_NAMES = new Set([
  ".git",
  ".workspace-bridge",
  "node_modules",
  "build",
  "dist",
  ".next",
  ".cache",
  "coverage",
]);

const MAX_FILE_BYTES = Number(process.env.WORKSPACE_BRIDGE_MAX_FILE_BYTES || 2 * 1024 * 1024);
const MAX_TREE_ENTRIES = Number(process.env.WORKSPACE_BRIDGE_MAX_TREE_ENTRIES || 5_000);

function isWithin(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function projectId(name: string, root: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 32) || "project";
  const hash = createHash("sha256").update(root).digest("hex").slice(0, 8);
  return `${slug}-${hash}`;
}

export class WorkspaceRegistry {
  constructor(private readonly registryFile: string) {}

  async list(): Promise<WorkspaceProject[]> {
    try {
      const value = JSON.parse(await fs.readFile(this.registryFile, "utf8"));
      return Array.isArray(value) ? value : [];
    } catch (error: any) {
      if (error?.code === "ENOENT") return [];
      throw error;
    }
  }

  async add(name: string, requestedRoot: string): Promise<WorkspaceProject> {
    if (!name.trim()) throw new Error("Project name is required");
    if (!requestedRoot.trim()) throw new Error("Project root is required");
    const root = await fs.realpath(path.resolve(requestedRoot));
    const stat = await fs.stat(root);
    if (!stat.isDirectory()) throw new Error("Project root must be a directory");

    const projects = await this.list();
    const existing = projects.find((project) => project.root === root);
    if (existing) return existing;

    const project: WorkspaceProject = {
      id: projectId(name, root),
      name: name.trim(),
      root,
      createdAt: new Date().toISOString(),
    };
    projects.push(project);
    await this.save(projects);
    return project;
  }

  async remove(id: string): Promise<boolean> {
    const projects = await this.list();
    const remaining = projects.filter((project) => project.id !== id);
    if (remaining.length === projects.length) return false;
    await this.save(remaining);
    return true;
  }

  async get(id: string): Promise<WorkspaceProject> {
    const project = (await this.list()).find((item) => item.id === id);
    if (!project) throw new Error(`Unknown project: ${id}`);
    return project;
  }

  private async save(projects: WorkspaceProject[]): Promise<void> {
    await fs.mkdir(path.dirname(this.registryFile), { recursive: true });
    const temporary = `${this.registryFile}.${randomUUID()}.tmp`;
    await fs.writeFile(temporary, `${JSON.stringify(projects, null, 2)}\n`, { mode: 0o600 });
    await fs.rename(temporary, this.registryFile);
  }
}

export class WorkspaceFiles {
  constructor(private readonly registry: WorkspaceRegistry) {}

  async tree(projectIdValue: string): Promise<FileEntry[]> {
    const project = await this.registry.get(projectIdValue);
    const entries: FileEntry[] = [];

    const visit = async (directory: string, relativeDirectory: string): Promise<void> => {
      if (entries.length >= MAX_TREE_ENTRIES) return;
      const children = await fs.readdir(directory, { withFileTypes: true });
      children.sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name));
      for (const child of children) {
        if (entries.length >= MAX_TREE_ENTRIES || IGNORED_NAMES.has(child.name) || child.isSymbolicLink()) continue;
        const relativePath = path.posix.join(relativeDirectory.split(path.sep).join(path.posix.sep), child.name);
        const absolutePath = path.join(directory, child.name);
        if (child.isDirectory()) {
          entries.push({ name: child.name, path: relativePath, type: "directory" });
          await visit(absolutePath, relativePath);
        } else if (child.isFile()) {
          const stat = await fs.stat(absolutePath);
          entries.push({ name: child.name, path: relativePath, type: "file", size: stat.size });
        }
      }
    };

    await visit(project.root, "");
    return entries;
  }

  async read(projectIdValue: string, relativePath: string): Promise<{ content: string; etag: string; size: number }> {
    const absolutePath = await this.resolveExisting(projectIdValue, relativePath);
    const stat = await fs.stat(absolutePath);
    if (!stat.isFile()) throw new Error("Path is not a file");
    if (stat.size > MAX_FILE_BYTES) throw new Error(`File exceeds ${MAX_FILE_BYTES} byte limit`);
    const content = await fs.readFile(absolutePath, "utf8");
    return { content, etag: createHash("sha256").update(content).digest("hex"), size: stat.size };
  }

  async write(projectIdValue: string, relativePath: string, content: string, expectedEtag?: string): Promise<{ etag: string; size: number }> {
    const bytes = Buffer.byteLength(content);
    if (bytes > MAX_FILE_BYTES) throw new Error(`Content exceeds ${MAX_FILE_BYTES} byte limit`);
    const absolutePath = await this.resolveForWrite(projectIdValue, relativePath);

    try {
      const current = await fs.readFile(absolutePath, "utf8");
      const currentEtag = createHash("sha256").update(current).digest("hex");
      if (expectedEtag && currentEtag !== expectedEtag) {
        const error: any = new Error("File changed since it was opened");
        error.code = "ETAG_MISMATCH";
        throw error;
      }
    } catch (error: any) {
      if (error?.code !== "ENOENT") throw error;
      if (expectedEtag) throw new Error("File no longer exists");
    }

    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    const temporary = `${absolutePath}.${randomUUID()}.tmp`;
    await fs.writeFile(temporary, content, "utf8");
    await fs.rename(temporary, absolutePath);
    return { etag: createHash("sha256").update(content).digest("hex"), size: bytes };
  }

  async search(projectIdValue: string, query: string, limit = 100): Promise<Array<{ path: string; line: number; text: string }>> {
    const needle = query.trim().toLowerCase();
    if (!needle) return [];
    const project = await this.registry.get(projectIdValue);
    const results: Array<{ path: string; line: number; text: string }> = [];
    const entries = await this.tree(projectIdValue);

    for (const entry of entries) {
      if (results.length >= limit || entry.type !== "file" || (entry.size || 0) > MAX_FILE_BYTES) continue;
      const absolutePath = path.join(project.root, entry.path);
      let content: string;
      try {
        const buffer = await fs.readFile(absolutePath);
        if (buffer.includes(0)) continue;
        content = buffer.toString("utf8");
      } catch {
        continue;
      }
      content.split(/\r?\n/).forEach((line, index) => {
        if (results.length < limit && line.toLowerCase().includes(needle)) {
          results.push({ path: entry.path, line: index + 1, text: line.slice(0, 500) });
        }
      });
    }
    return results;
  }

  private validateRelativePath(relativePath: string): string {
    if (!relativePath || path.isAbsolute(relativePath) || relativePath.includes("\0")) throw new Error("A relative file path is required");
    const normalized = path.normalize(relativePath);
    if (normalized === ".." || normalized.startsWith(`..${path.sep}`)) throw new Error("Path escapes the project root");
    return normalized;
  }

  private async resolveExisting(projectIdValue: string, relativePath: string): Promise<string> {
    const project = await this.registry.get(projectIdValue);
    const candidate = await fs.realpath(path.resolve(project.root, this.validateRelativePath(relativePath)));
    if (!isWithin(project.root, candidate)) throw new Error("Path escapes the project root");
    return candidate;
  }

  private async resolveForWrite(projectIdValue: string, relativePath: string): Promise<string> {
    const project = await this.registry.get(projectIdValue);
    const candidate = path.resolve(project.root, this.validateRelativePath(relativePath));
    if (!isWithin(project.root, candidate)) throw new Error("Path escapes the project root");
    try {
      return await this.resolveExisting(projectIdValue, relativePath);
    } catch (error: any) {
      if (error?.code !== "ENOENT") throw error;
      let existingParent = path.dirname(candidate);
      while (existingParent !== project.root) {
        try {
          existingParent = await fs.realpath(existingParent);
          break;
        } catch (parentError: any) {
          if (parentError?.code !== "ENOENT") throw parentError;
          existingParent = path.dirname(existingParent);
        }
      }
      if (!isWithin(project.root, existingParent)) throw new Error("Path escapes the project root");
      return candidate;
    }
  }
}

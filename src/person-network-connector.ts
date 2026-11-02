import { App, getAllTags, TFile } from "obsidian";

export interface ConnectedPerson {
  path: string;
  name: string;
  photoUrl?: string;
}

interface PersonNetworkSettingsShape {
  personTag: string;
  nameField: string;
  photoField: string;
  excludePaths?: string;
}

interface PersonNetworkPluginShape { settings: PersonNetworkSettingsShape; }
interface AppWithPlugins extends App { plugins?: { getPlugin(id: string): unknown }; }

export class PersonNetworkConnector {
  constructor(private readonly app: App) {}

  isAvailable(): boolean { return this.plugin() !== undefined; }

  isPersonFile(file: TFile): boolean {
    const plugin = this.plugin();
    if (!plugin || this.isExcluded(file.path, plugin.settings.excludePaths ?? "")) return false;
    const tag = plugin.settings.personTag.trim().replace(/^#/, "").toLocaleLowerCase();
    const cache = this.app.metadataCache.getFileCache(file);
    const tags = cache ? getAllTags(cache) : null;
    return Boolean(tag && tags?.some((value) => value.replace(/^#/, "").toLocaleLowerCase() === tag));
  }

  getPerson(path: string): ConnectedPerson | undefined {
    const plugin = this.plugin();
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!plugin || !(file instanceof TFile) || !this.isPersonFile(file)) return undefined;
    const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
    const rawName: unknown = frontmatter?.[plugin.settings.nameField];
    const name = typeof rawName === "string" && rawName.trim() ? rawName.trim() : file.basename;
    const rawPhoto: unknown = frontmatter?.[plugin.settings.photoField];
    const photoFile = rawPhoto ? this.resolvePhotoFile(String(rawPhoto), file.path) : undefined;
    return { path: file.path, name, photoUrl: photoFile ? this.app.vault.getResourcePath(photoFile) : undefined };
  }

  private plugin(): PersonNetworkPluginShape | undefined {
    // Obsidian has no public inter-plugin registry API. Keep the compatibility
    // boundary isolated here and validate the exposed Person Network shape.
    const candidate = (this.app as AppWithPlugins).plugins?.getPlugin("person-network");
    if (!candidate || typeof candidate !== "object" || !("settings" in candidate)) return undefined;
    const settings = (candidate as { settings?: unknown }).settings;
    if (!settings || typeof settings !== "object") return undefined;
    const value = settings as Partial<PersonNetworkSettingsShape>;
    if (typeof value.personTag !== "string" || typeof value.nameField !== "string" || typeof value.photoField !== "string") return undefined;
    return candidate as PersonNetworkPluginShape;
  }

  private resolvePhotoFile(rawPath: string, sourcePath: string): TFile | undefined {
    const cleaned = stripWikilink(rawPath);
    const direct = this.app.vault.getAbstractFileByPath(cleaned);
    if (direct instanceof TFile) return direct;
    return this.app.metadataCache.getFirstLinkpathDest(cleaned, sourcePath) ?? undefined;
  }

  private isExcluded(path: string, rawPaths: string): boolean {
    const normalized = path.toLocaleLowerCase();
    return rawPaths.split(",").map((item) => item.trim().toLocaleLowerCase()).filter(Boolean)
      .some((item) => normalized === item || normalized.startsWith(`${item}/`));
  }
}

function stripWikilink(value: string): string {
  const trimmed = value.trim();
  if (!trimmed.startsWith("[[") || !trimmed.endsWith("]]")) return trimmed;
  return trimmed.slice(2, -2).split("|", 1)[0] ?? "";
}

import * as fs from 'fs';
import * as path from 'path';
import type {CoreConfig, MinimalProject, Project} from '../../../src/app/model/project.types';
import type {ProjectSettings} from '../../../src/app/model/settings.types';
import {ROOT_CATALOG_ID} from '../../../src/app/shared/types/catalog.types';

export const FIXTURES_DIR = path.resolve(__dirname, '..', 'fixtures');
export const fixture = (name: string): string => path.join(FIXTURES_DIR, name);

export const SEED_PROJECT_ID = '00000000-0000-4000-8000-00000000e2e0';

// Mirrors DEFAULT_PROJECT_SETTINGS; the enum is a string enum, so a cast avoids a runtime import of the Angular model
const DEFAULT_SETTINGS = {
  autoPauseAtStart: false,
  autoPauseAtEnd: false,
  subtitledClipSpeed: 1.0,
  gapSpeed: 2.0,
  skipGaps: false,
  speedOverride: 0.5,
  subtitleBehavior: 'DoNothing',
  selectedAudioTrackIndex: null,
  useMpvSubtitles: false,
  assScale: 1.0,
  assScalePercentage: 100.0,
  subtitlesVisible: true,
  subtitlesLanguage: 'other',
  defaultSubtitleLookupServiceId: null
} as unknown as ProjectSettings;

export const SEED_PROJECT_ID_2 = '00000000-0000-4000-8000-00000000e2e1';

/** Project settings as seeded; the behaviour is spelled as its string value so specs need no runtime import of the Angular model. */
export type SeedSettings = Omit<Partial<ProjectSettings>, 'subtitleBehavior'> & { subtitleBehavior?: 'DoNothing' | 'ForceShow' | 'ForceHide' };

export interface SeedOptions {
  /** Defaults to SEED_PROJECT_ID; set it to seed a second project */
  id?: string;
  media?: string;
  subtitle?: string;
  duration?: number;
  subtitleCount?: number;
  lastSubtitleEndTime?: number;
  lastPlaybackTime?: number;
  settings?: SeedSettings;
  /** Merged over the app's default global settings, e.g. {hardwareAcceleration: true, volume: 40} */
  globalSettings?: Record<string, unknown>;
}

function buildProject(opts: SeedOptions): { project: Project, minimal: MinimalProject } {
  const media = opts.media ?? fixture('sample.mp4');
  const subtitle = opts.subtitle ?? fixture('sample.srt');
  const now = Date.now();
  const lastPlaybackTime = opts.lastPlaybackTime ?? 0;

  const minimal: MinimalProject = {
    id: opts.id ?? SEED_PROJECT_ID,
    catalogId: ROOT_CATALOG_ID,
    mediaFileName: path.basename(media),
    subtitleFileName: path.basename(subtitle),
    mediaPath: media,
    createdDate: now,
    lastOpenedDate: now,
    duration: opts.duration ?? 10,
    lastPlaybackTime,
    subtitleCount: opts.subtitleCount ?? 3,
    lastSubtitleEndTime: opts.lastSubtitleEndTime ?? 8.5
  };

  const project: Project = {
    ...minimal,
    subtitleSelection: {type: 'external', filePath: subtitle},
    detectedLanguage: 'other',
    settings: {...DEFAULT_SETTINGS, ...opts.settings} as ProjectSettings,
    subtitles: [],
    audioTracks: [],
    subtitleTracks: [],
    ankiTags: []
  };

  return {project, minimal};
}

function write(userDataDir: string, projects: SeedOptions[], lastOpenedProjectId: string | null): void {
  const built = projects.map(buildProject);
  // Other keys (ankiSettings, catalogs) are omitted so the app deep-merges its defaults; globalSettings only when seeded
  const globalSettings = projects.find(p => p.globalSettings)?.globalSettings;
  const coreConfig = {
    projects: built.map(b => b.minimal),
    lastOpenedProjectId,
    ...(globalSettings ? {globalSettings} : {})
  } as Partial<CoreConfig>;

  fs.mkdirSync(path.join(userDataDir, 'projects'), {recursive: true});
  fs.writeFileSync(path.join(userDataDir, 'yall-mp-app-data.json'), JSON.stringify(coreConfig));
  for (const {project} of built) {
    fs.writeFileSync(path.join(userDataDir, 'projects', `${project.id}.json`), JSON.stringify(project));
  }
}

/** The app opens straight into the player for this project. */
export function seedProject(userDataDir: string, opts: SeedOptions = {}): void {
  write(userDataDir, [opts], opts.id ?? SEED_PROJECT_ID);
}

/** The app opens the project list, which contains this project. */
export function seedListOnly(userDataDir: string, opts: SeedOptions = {}): void {
  write(userDataDir, [opts], null);
}

/** Several projects (give each its own `id`); the app opens the first one. Global settings are taken from the first entry that has them. */
export function seedProjects(userDataDir: string, projects: SeedOptions[]): void {
  write(userDataDir, projects, projects[0].id ?? SEED_PROJECT_ID);
}

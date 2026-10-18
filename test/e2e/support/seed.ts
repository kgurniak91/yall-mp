import * as fs from 'fs';
import * as path from 'path';
import type {CoreConfig, MinimalProject, Project} from '../../../src/app/model/project.types';
import type {ProjectSettings} from '../../../src/app/model/settings.types';

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

export interface SeedOptions {
  media?: string;
  subtitle?: string;
  duration?: number;
  lastPlaybackTime?: number;
  settings?: Partial<ProjectSettings>;
}

function buildProject(opts: SeedOptions): { project: Project, minimal: MinimalProject } {
  const media = opts.media ?? fixture('sample.mp4');
  const subtitle = opts.subtitle ?? fixture('sample.srt');
  const now = Date.now();
  const lastPlaybackTime = opts.lastPlaybackTime ?? 0;

  const minimal: MinimalProject = {
    id: SEED_PROJECT_ID,
    catalogId: '',
    mediaFileName: path.basename(media),
    subtitleFileName: path.basename(subtitle),
    mediaPath: media,
    createdDate: now,
    lastOpenedDate: now,
    duration: opts.duration ?? 10,
    lastPlaybackTime,
    subtitleCount: 3,
    lastSubtitleEndTime: 8.5
  };

  const project: Project = {
    ...minimal,
    subtitleSelection: {type: 'external', filePath: subtitle},
    detectedLanguage: 'other',
    settings: {...DEFAULT_SETTINGS, ...opts.settings},
    subtitles: [],
    audioTracks: [],
    subtitleTracks: [],
    ankiTags: []
  };

  return {project, minimal};
}

function write(userDataDir: string, opts: SeedOptions, lastOpenedProjectId: string | null): void {
  const {project, minimal} = buildProject(opts);
  // Other keys (globalSettings, ankiSettings, catalogs) are omitted so the app deep-merges its defaults
  const coreConfig: Pick<CoreConfig, 'projects' | 'lastOpenedProjectId'> = {
    projects: [minimal],
    lastOpenedProjectId
  };

  fs.mkdirSync(path.join(userDataDir, 'projects'), {recursive: true});
  fs.writeFileSync(path.join(userDataDir, 'yall-mp-app-data.json'), JSON.stringify(coreConfig));
  fs.writeFileSync(path.join(userDataDir, 'projects', `${SEED_PROJECT_ID}.json`), JSON.stringify(project));
}

/** The app opens straight into the player for this project. */
export function seedProject(userDataDir: string, opts: SeedOptions = {}): void {
  write(userDataDir, opts, SEED_PROJECT_ID);
}

/** The app opens the project list, which contains this project. */
export function seedListOnly(userDataDir: string, opts: SeedOptions = {}): void {
  write(userDataDir, opts, null);
}

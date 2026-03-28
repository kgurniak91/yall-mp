import {effect, inject, Injectable, OnDestroy, untracked} from '@angular/core';
import {ClipsStateService} from '../../../../state/clips/clips-state.service';
import {AppStateService} from '../../../../state/app/app-state.service';
import {GlobalSettingsStateService} from '../../../../state/global-settings/global-settings-state.service';
import {ToastService} from '../../../../shared/services/toast/toast.service';
import {Project, ProjectClipNotes} from '../../../../model/project.types';
import {isEqual} from 'lodash-es';

@Injectable()
export class UnexportedNotesWarningService implements OnDestroy {
  private readonly clipsStateService = inject(ClipsStateService);
  private readonly appStateService = inject(AppStateService);
  private readonly globalSettingsStateService = inject(GlobalSettingsStateService);
  private readonly toastService = inject(ToastService);

  private activeSubtitledIds: string[] = [];
  private pendingWarnTimer: any = null;
  private lastWarnedClipId: string | null = null;

  constructor() {
    effect(() => {
      const currentClip = this.clipsStateService.currentClipForAllTracks();
      const project = this.appStateService.currentProject();
      const warnEnabled = this.globalSettingsStateService.warnUnexportedNotes();

      if (!project || !currentClip) {
        return;
      }

      untracked(() => {
        const currentSourceIds = currentClip.hasSubtitle ? currentClip.sourceSubtitles.map(s => s.id) : [];

        if (currentClip.hasSubtitle) {
          // If user returned to the same clip with a pending warning, cancel it
          if (this.lastWarnedClipId && currentSourceIds.includes(this.lastWarnedClipId)) {
            if (this.pendingWarnTimer) {
              clearTimeout(this.pendingWarnTimer);
              this.pendingWarnTimer = null;
            }
            this.lastWarnedClipId = null;
          }

          const isSameAsActive = this.activeSubtitledIds.some(id => currentSourceIds.includes(id)) || this.activeSubtitledIds.length === 0;

          if (isSameAsActive) {
            this.activeSubtitledIds = currentSourceIds;
          } else {
            // User moved to a DIFFERENT subtitled clip
            this.checkAndWarnUnexportedNotes(project, this.activeSubtitledIds, currentSourceIds, warnEnabled);
            this.activeSubtitledIds = currentSourceIds;
          }
        } else {
          // User moved into a gap
          this.checkAndWarnUnexportedNotes(project, this.activeSubtitledIds, currentSourceIds, warnEnabled);
        }
      });
    });
  }

  ngOnDestroy(): void {
    if (this.pendingWarnTimer) {
      clearTimeout(this.pendingWarnTimer);
    }
  }

  private checkAndWarnUnexportedNotes(project: Project, oldSourceIds: string[], currentSourceIds: string[], warnEnabled: boolean): void {
    if (!warnEnabled || oldSourceIds.length === 0) {
      return;
    }

    const representativeId = oldSourceIds[0];

    // If warning for this clip was already shown, or is awaiting to be shown, do nothing
    if (this.lastWarnedClipId === representativeId) {
      return;
    }

    // If the old clip doesn't exist in the project anymore (e.g., deleted), abort warning
    const oldClipExists = oldSourceIds.some(id => project.subtitles.some(s => s.id === id));
    if (!oldClipExists) {
      return;
    }

    const oldNotes = project.notes?.[representativeId];

    let hasNotes = false;
    if (oldNotes) {
      const hasManualNote = Boolean(oldNotes.manualNote && oldNotes.manualNote.trim().length > 0);
      const hasLookupNotes = Boolean(oldNotes.lookupNotes && Object.values(oldNotes.lookupNotes).some(list => list.length > 0));
      hasNotes = hasManualNote || hasLookupNotes;
    }

    const isExported = project.ankiExportHistory?.includes(representativeId);

    if (hasNotes && !isExported) {
      const currentNotes = currentSourceIds.length > 0 ? project.notes?.[currentSourceIds[0]] : undefined;

      const normalize = (n: ProjectClipNotes | undefined) => ({
        lookupNotes: n?.lookupNotes && Object.keys(n.lookupNotes).length > 0 ? n.lookupNotes : undefined,
        manualNote: n?.manualNote?.trim() || undefined,
        hint: n?.hint?.trim() || undefined
      });

      const notesAreDifferent = !isEqual(normalize(oldNotes), normalize(currentNotes));

      if (notesAreDifferent) {
        this.lastWarnedClipId = representativeId;

        // Clear any old unrelated timer just in case
        if (this.pendingWarnTimer) {
          clearTimeout(this.pendingWarnTimer);
        }

        this.pendingWarnTimer = setTimeout(() => {
          this.toastService.warn('You moved past a clip with notes without exporting it to Anki');
          this.pendingWarnTimer = null;
        }, 250);
      }
    }
  }
}

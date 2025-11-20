import {inject, Injectable, signal} from '@angular/core';
import {Router} from '@angular/router';
import {ToastService} from '../../../shared/services/toast/toast.service';
import {SUPPORTED_MEDIA_TYPES, SUPPORTED_SUBTITLE_TYPES} from '../../../model/video.types';
import {AppStateService} from '../../../state/app/app-state.service';

@Injectable({
  providedIn: 'root'
})
export class FileOpenIntentService {
  public readonly intentMedia = signal<string | null>(null);
  public readonly intentSubtitle = signal<string | null>(null);
  public readonly hasIntent = signal<boolean>(false);
  private readonly router = inject(Router);
  private readonly toastService = inject(ToastService);
  private readonly appStateService = inject(AppStateService);

  public async processFiles(filePaths: string[]): Promise<string | null> {
    if (!filePaths || filePaths.length === 0) {
      return null;
    }

    if (filePaths.length > 2) {
      return 'Too many files selected. Please select at most 1 media file and 1 subtitle file.';
    }

    let media: string | null = null;
    let sub: string | null = null;

    for (const filePath of filePaths) {
      const lower = filePath.toLowerCase();
      const isMedia = SUPPORTED_MEDIA_TYPES.some(ext => lower.endsWith('.' + ext));
      const isSub = SUPPORTED_SUBTITLE_TYPES.some(ext => lower.endsWith('.' + ext));

      if (isMedia) {
        if (media) {
          return 'Multiple media files selected. Please select only one.';
        }
        media = filePath;
      } else if (isSub) {
        if (sub) {
          return 'Multiple subtitle files selected. Please select only one.';
        }
        sub = filePath;
      } else {
        return `Unsupported file type: ${filePath}`;
      }
    }

    if (!media) {
      if (sub) {
        return 'Cannot open a subtitle file without a media file. Please select the media file as well.';
      }
      return 'No valid media file found.';
    }

    const existingProject = this.appStateService.projects().find(p => p.mediaPath === media);
    if (existingProject) {
      this.toastService.success('Opened existing project');
      await this.appStateService.setCurrentProject(existingProject.id);
      this.router.navigate(['/project', existingProject.id]);
      return null;
    }

    if (media && !sub) {
      const autoSub = await window.electronAPI.findCompanionSubtitle(media);
      if (autoSub) {
        sub = autoSub;
      }
    }

    this.setManualIntent(media, sub);
    this.router.navigate(['/project/new']);

    return null;
  }

  public async openMedia(mediaPath: string): Promise<void> {
    const existingProject = this.appStateService.projects().find(p => p.mediaPath === mediaPath);

    if (existingProject) {
      this.toastService.success('Opened existing project');
      await this.appStateService.setCurrentProject(existingProject.id);
      this.router.navigate(['/project', existingProject.id]);
      return;
    }

    const subtitlePath = await window.electronAPI.findCompanionSubtitle(mediaPath);
    this.setManualIntent(mediaPath, subtitlePath);
    this.router.navigate(['/project/new']);
  }

  public clearIntent(): void {
    this.intentMedia.set(null);
    this.intentSubtitle.set(null);
    this.hasIntent.set(false);
  }

  public setManualIntent(mediaPath: string, subtitlePath: string | null): void {
    this.intentMedia.set(mediaPath);
    this.intentSubtitle.set(subtitlePath);
    this.hasIntent.set(true);
  }
}

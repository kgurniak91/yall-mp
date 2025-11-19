import {Injectable, signal} from '@angular/core';
import {SUPPORTED_MEDIA_TYPES, SUPPORTED_SUBTITLE_TYPES} from '../../../model/video.types';

@Injectable({
  providedIn: 'root'
})
export class FileOpenIntentService {
  public readonly intentMedia = signal<string | null>(null);
  public readonly intentSubtitle = signal<string | null>(null);
  public readonly hasIntent = signal<boolean>(false);

  public processFiles(filePaths: string[]): string | null {
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

    this.intentMedia.set(media);
    this.intentSubtitle.set(sub);
    this.hasIntent.set(true);

    return null;
  }

  public clearIntent(): void {
    this.intentMedia.set(null);
    this.intentSubtitle.set(null);
    this.hasIntent.set(false);
  }
}

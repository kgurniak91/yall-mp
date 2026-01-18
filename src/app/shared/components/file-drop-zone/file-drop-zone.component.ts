import {ChangeDetectionStrategy, Component, computed, input, output, signal} from '@angular/core';

@Component({
  selector: 'app-file-drop-zone',
  imports: [],
  templateUrl: './file-drop-zone.component.html',
  styleUrl: './file-drop-zone.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class FileDropZoneComponent {
  public readonly label = input.required<string>();
  public readonly icon = input.required<string>();
  public readonly accept = input.required<string[]>();
  public readonly existingFileName = input<string | null>(null);
  public readonly filePathChange = output<string | null>();
  protected readonly displayLabel = computed(() => this.newFileName() ?? this.existingFileName() ?? this.label());
  protected readonly isFileSelected = computed(() => !!(this.newFileName() || this.existingFileName()));
  protected readonly isDragging = signal(false);
  protected readonly newFileName = signal<string | null>(null);
  private isFileDialogOpen = false;

  protected onDragOver(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.isDragging.set(true);
  }

  protected onDragLeave(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.isDragging.set(false);
  }

  protected onDrop(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.isDragging.set(false);
    const file = event.dataTransfer?.files[0];

    if (file) {
      const filePath = window.electronAPI.getPathForFile(file);

      if (filePath) {
        this.newFileName.set(file.name);
        this.filePathChange.emit(filePath);
      } else {
        console.error('Could not get path for the dropped file.');
      }
    }
  }

  protected onClearFile(event: MouseEvent): void {
    event.stopPropagation(); // Prevent the click from opening the file dialog
    this.newFileName.set(null);
    this.filePathChange.emit(null);
  }

  protected async onZoneClicked() {
    if (this.isFileDialogOpen) {
      return;
    }

    this.isFileDialogOpen = true;

    try {
      const dialogFilters = [{name: 'Allowed Files', extensions: this.accept()}];

      const filePaths = await window.electronAPI.openFileDialog({
        title: 'Select a file',
        properties: ['openFile'],
        filters: dialogFilters
      });

      if (filePaths && filePaths.length > 0) {
        const filePath = filePaths[0];
        this.newFileName.set(this.getBaseName(filePath));
        this.filePathChange.emit(filePath);
      }
    } finally {
      this.isFileDialogOpen = false;
    }
  }

  private getBaseName(filePath: string): string {
    return filePath.split(/[\\/]/).pop() || '';
  }
}

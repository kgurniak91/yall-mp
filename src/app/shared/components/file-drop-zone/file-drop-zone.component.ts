import {Component, computed, input, output, signal} from '@angular/core';

@Component({
  selector: 'app-file-drop-zone',
  imports: [],
  templateUrl: './file-drop-zone.component.html',
  styleUrl: './file-drop-zone.component.scss'
})
export class FileDropZoneComponent {
  label = input.required<string>();
  isRequired = input.required<boolean>();
  icon = input.required<string>();
  accept = input.required<string[]>();
  existingFileName = input<string | null>(null);
  filePathChange = output<string | null>();
  protected displayLabel = computed(() => this.newFileName() ?? this.existingFileName() ?? this.label());
  protected isFileSelected = computed(() => !!(this.newFileName() || this.existingFileName()));
  protected isDragging = false;
  protected newFileName = signal<string | null>(null);

  protected onDragOver(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.isDragging = true;
  }

  protected onDragLeave(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.isDragging = false;
  }

  protected onDrop(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.isDragging = false;
    const file = event.dataTransfer?.files[0];
    if (file) {
      const filePath = (file as any).path;
      if (filePath) {
        this.newFileName.set(file.name);
        this.filePathChange.emit(filePath);
      }
    }
  }

  protected onClearFile(event: MouseEvent): void {
    event.stopPropagation(); // Prevent the click from opening the file dialog
    this.newFileName.set(null);
    this.filePathChange.emit(null);
  }

  protected async onZoneClicked() {
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
  }

  private getBaseName(filePath: string): string {
    return filePath.split(/[\\/]/).pop() || '';
  }
}

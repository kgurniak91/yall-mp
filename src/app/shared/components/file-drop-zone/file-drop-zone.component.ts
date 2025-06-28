import {Component, input, output} from '@angular/core';

@Component({
  selector: 'app-file-drop-zone',
  imports: [],
  templateUrl: './file-drop-zone.component.html',
  styleUrl: './file-drop-zone.component.scss'
})
export class FileDropZoneComponent {
  label = input.required<string>();
  icon = input.required<string>();
  accept = input.required<string>();
  selectedFile = input<File | null>(null);
  fileChange = output<File | null>();
  protected isDragging = false;

  onDragOver(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.isDragging = true;
  }

  onDragLeave(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.isDragging = false;
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.isDragging = false;
    const file = event.dataTransfer?.files[0];
    if (file) {
      this.fileChange.emit(file);
    }
  }

  onFileSelect(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file) {
      this.fileChange.emit(file);
    }
    // Clear the input value so the (change) event fires even if the same file is selected again
    input.value = '';
  }

  onClearFile(event: MouseEvent): void {
    event.stopPropagation(); // Prevent the click from opening the file dialog
    this.fileChange.emit(null);
  }
}

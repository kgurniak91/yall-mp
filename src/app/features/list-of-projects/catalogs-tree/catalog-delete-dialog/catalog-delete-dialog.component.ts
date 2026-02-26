import {ChangeDetectionStrategy, Component, inject, signal} from '@angular/core';
import {Button} from 'primeng/button';
import {Checkbox} from 'primeng/checkbox';
import {DynamicDialogConfig, DynamicDialogRef} from 'primeng/dynamicdialog';
import {FormsModule} from '@angular/forms';

export interface CatalogDeleteDialogData {
  catalogName: string;
  projectCount: number;
}

@Component({
  selector: 'app-catalog-delete-dialog',
  standalone: true,
  imports: [Button, Checkbox, FormsModule],
  templateUrl: './catalog-delete-dialog.component.html',
  styleUrl: './catalog-delete-dialog.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class CatalogDeleteDialogComponent {
  public readonly ref = inject(DynamicDialogRef);
  public readonly config = inject(DynamicDialogConfig);
  protected readonly data: CatalogDeleteDialogData = this.config.data;
  protected readonly confirmed = signal(false);
}

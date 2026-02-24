import {ChangeDetectionStrategy, Component, inject, OnInit} from '@angular/core';
import {FormBuilder, FormGroup, ReactiveFormsModule, Validators} from '@angular/forms';
import {DynamicDialogConfig, DynamicDialogRef} from 'primeng/dynamicdialog';
import {Button} from 'primeng/button';
import {InputNumber} from 'primeng/inputnumber';
import {Select} from 'primeng/select';
import {Checkbox} from 'primeng/checkbox';
import {AnkiDailyGoal} from '../../../../model/anki.types';
import {FormControlErrorComponent} from '../../../../shared/components/form-control-error/form-control-error.component';
import {FormValidationService} from '../../../../core/services/form-validation/form-validation.service';

@Component({
  selector: 'app-anki-daily-goal-dialog',
  imports: [
    ReactiveFormsModule,
    Button,
    InputNumber,
    Select,
    Checkbox,
    FormControlErrorComponent
  ],
  templateUrl: './anki-daily-goal-dialog.component.html',
  styleUrl: './anki-daily-goal-dialog.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class AnkiDailyGoalDialogComponent implements OnInit {
  protected form!: FormGroup;
  protected intervalOptions = [
    {label: 'Only when reached', value: 0},
    {label: 'Every card', value: 1},
    {label: 'Every 2 cards', value: 2},
    {label: 'Every 5 cards', value: 5},
    {label: 'Every 10 cards', value: 10},
    {label: 'Every 20 cards', value: 20}
  ];
  private readonly fb = inject(FormBuilder);
  private readonly ref = inject(DynamicDialogRef);
  private readonly config = inject(DynamicDialogConfig);
  private readonly formValidationService = inject(FormValidationService);

  ngOnInit() {
    const existingGoal = this.config.data?.goal as AnkiDailyGoal | undefined;

    this.form = this.fb.group({
      targetCount: [existingGoal?.targetCount ?? 20, [Validators.required, Validators.min(1), Validators.max(1000)]],
      notifyInterval: [existingGoal?.notifyInterval ?? 1, [Validators.required]],
      notifyAfterReached: [existingGoal?.notifyAfterReached ?? false],
      playSound: [existingGoal?.playSound ?? true]
    });
  }

  onSave() {
    if (!this.formValidationService.isFormValid(this.form)) {
      return;
    }
    const val = this.form.getRawValue();
    this.ref.close(val);
  }

  onCancel() {
    this.ref.close();
  }
}

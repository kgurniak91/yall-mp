import { ComponentFixture, TestBed } from '@angular/core/testing';

import { AnkiDailyGoalDialogComponent } from './anki-daily-goal-dialog.component';

xdescribe('AnkiDailyGoalDialogComponent', () => {
  let component: AnkiDailyGoalDialogComponent;
  let fixture: ComponentFixture<AnkiDailyGoalDialogComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AnkiDailyGoalDialogComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(AnkiDailyGoalDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});

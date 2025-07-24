import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ExportToAnkiDialogComponent } from './export-to-anki-dialog.component';

describe('ExportToAnkiDialogComponent', () => {
  let component: ExportToAnkiDialogComponent;
  let fixture: ComponentFixture<ExportToAnkiDialogComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ExportToAnkiDialogComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(ExportToAnkiDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});

import { ComponentFixture, TestBed } from '@angular/core/testing';

import { AnkiTemplateFormDialogComponent } from './anki-template-form-dialog.component';

xdescribe('AnkiTemplateFormDialogComponent', () => {
  let component: AnkiTemplateFormDialogComponent;
  let fixture: ComponentFixture<AnkiTemplateFormDialogComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AnkiTemplateFormDialogComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(AnkiTemplateFormDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});

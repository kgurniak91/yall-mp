import { ComponentFixture, TestBed } from '@angular/core/testing';

import { NoteFormDialogComponent } from './note-form-dialog.component';

xdescribe('NoteFormDialogComponent', () => {
  let component: NoteFormDialogComponent;
  let fixture: ComponentFixture<NoteFormDialogComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [NoteFormDialogComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(NoteFormDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});

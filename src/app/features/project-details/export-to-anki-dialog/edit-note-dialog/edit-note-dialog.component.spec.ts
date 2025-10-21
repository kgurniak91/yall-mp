import { ComponentFixture, TestBed } from '@angular/core/testing';

import { EditNoteDialogComponent } from './edit-note-dialog.component';

xdescribe('EditNoteDialogComponent', () => {
  let component: EditNoteDialogComponent;
  let fixture: ComponentFixture<EditNoteDialogComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [EditNoteDialogComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(EditNoteDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});

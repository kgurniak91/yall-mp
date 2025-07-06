import { ComponentFixture, TestBed } from '@angular/core/testing';

import { EditSubtitlesDialogComponent } from './edit-subtitles-dialog.component';

describe('EditSubtitlesDialogComponent', () => {
  let component: EditSubtitlesDialogComponent;
  let fixture: ComponentFixture<EditSubtitlesDialogComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [EditSubtitlesDialogComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(EditSubtitlesDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});

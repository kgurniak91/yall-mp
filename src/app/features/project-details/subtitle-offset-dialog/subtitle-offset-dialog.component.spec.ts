import { ComponentFixture, TestBed } from '@angular/core/testing';

import { SubtitleOffsetDialogComponent } from './subtitle-offset-dialog.component';

xdescribe('SubtitleOffsetDialogComponent', () => {
  let component: SubtitleOffsetDialogComponent;
  let fixture: ComponentFixture<SubtitleOffsetDialogComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SubtitleOffsetDialogComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(SubtitleOffsetDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});

import { ComponentFixture, TestBed } from '@angular/core/testing';

import { SubtitlesOverlayComponent } from './subtitles-overlay.component';

xdescribe('SubtitlesOverlayComponent', () => {
  let component: SubtitlesOverlayComponent;
  let fixture: ComponentFixture<SubtitlesOverlayComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SubtitlesOverlayComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(SubtitlesOverlayComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});

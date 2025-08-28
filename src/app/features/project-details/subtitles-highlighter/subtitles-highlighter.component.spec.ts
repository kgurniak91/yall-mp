import { ComponentFixture, TestBed } from '@angular/core/testing';

import { SubtitlesHighlighterComponent } from './subtitles-highlighter.component';

describe('SubtitlesHighlighterComponent', () => {
  let component: SubtitlesHighlighterComponent;
  let fixture: ComponentFixture<SubtitlesHighlighterComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SubtitlesHighlighterComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(SubtitlesHighlighterComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});

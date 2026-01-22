import { ComponentFixture, TestBed } from '@angular/core/testing';

import { SearchSubtitlesDialogComponent } from './search-subtitles-dialog.component';

xdescribe('SearchSubtitlesDialogComponent', () => {
  let component: SearchSubtitlesDialogComponent;
  let fixture: ComponentFixture<SearchSubtitlesDialogComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SearchSubtitlesDialogComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(SearchSubtitlesDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});

import { ComponentFixture, TestBed } from '@angular/core/testing';

import { TimelineEditorComponent } from './timeline-editor.component';

xdescribe('TimelineEditorComponent', () => {
  let component: TimelineEditorComponent;
  let fixture: ComponentFixture<TimelineEditorComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TimelineEditorComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(TimelineEditorComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});

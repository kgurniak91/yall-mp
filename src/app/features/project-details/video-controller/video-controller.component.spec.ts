import { ComponentFixture, TestBed } from '@angular/core/testing';

import { VideoControllerComponent } from './video-controller.component';

xdescribe('VideoControllerComponent', () => {
  let component: VideoControllerComponent;
  let fixture: ComponentFixture<VideoControllerComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [VideoControllerComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(VideoControllerComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});

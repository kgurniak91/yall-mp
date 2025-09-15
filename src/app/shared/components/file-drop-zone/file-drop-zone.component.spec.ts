import { ComponentFixture, TestBed } from '@angular/core/testing';

import { FileDropZoneComponent } from './file-drop-zone.component';

xdescribe('FileDropZoneComponent', () => {
  let component: FileDropZoneComponent;
  let fixture: ComponentFixture<FileDropZoneComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [FileDropZoneComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(FileDropZoneComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});

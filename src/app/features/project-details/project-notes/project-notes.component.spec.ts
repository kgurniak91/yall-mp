import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ProjectNotesComponent } from './project-notes.component';

xdescribe('ProjectNotesComponent', () => {
  let component: ProjectNotesComponent;
  let fixture: ComponentFixture<ProjectNotesComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ProjectNotesComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(ProjectNotesComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});

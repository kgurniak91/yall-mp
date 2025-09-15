import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ListOfProjectsComponent } from './list-of-projects.component';

xdescribe('ListOfProjectsComponent', () => {
  let component: ListOfProjectsComponent;
  let fixture: ComponentFixture<ListOfProjectsComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ListOfProjectsComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(ListOfProjectsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});

import { ComponentFixture, TestBed } from '@angular/core/testing';

import { LanguagePriorityListComponent } from './language-priority-list.component';

xdescribe('LanguagePriorityListComponent', () => {
  let component: LanguagePriorityListComponent;
  let fixture: ComponentFixture<LanguagePriorityListComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [LanguagePriorityListComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(LanguagePriorityListComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});

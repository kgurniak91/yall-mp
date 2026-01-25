import { ComponentFixture, TestBed } from '@angular/core/testing';

import { MoveProjectDialogComponent } from './move-project-dialog.component';

xdescribe('MoveProjectDialogComponent', () => {
  let component: MoveProjectDialogComponent;
  let fixture: ComponentFixture<MoveProjectDialogComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MoveProjectDialogComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(MoveProjectDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});

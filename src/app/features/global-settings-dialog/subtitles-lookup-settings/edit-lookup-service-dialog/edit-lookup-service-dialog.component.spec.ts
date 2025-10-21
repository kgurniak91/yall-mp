import { ComponentFixture, TestBed } from '@angular/core/testing';

import { EditLookupServiceDialogComponent } from './edit-lookup-service-dialog.component';

xdescribe('EditLookupServiceDialogComponent', () => {
  let component: EditLookupServiceDialogComponent;
  let fixture: ComponentFixture<EditLookupServiceDialogComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [EditLookupServiceDialogComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(EditLookupServiceDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});

import { ComponentFixture, TestBed } from '@angular/core/testing';

import { CatalogFormDialogComponent } from './catalog-form-dialog.component';

xdescribe('CatalogFormDialogComponent', () => {
  let component: CatalogFormDialogComponent;
  let fixture: ComponentFixture<CatalogFormDialogComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CatalogFormDialogComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(CatalogFormDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});

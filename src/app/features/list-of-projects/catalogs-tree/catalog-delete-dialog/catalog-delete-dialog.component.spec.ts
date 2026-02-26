import { ComponentFixture, TestBed } from '@angular/core/testing';

import { CatalogDeleteDialogComponent } from './catalog-delete-dialog.component';

xdescribe('CatalogDeleteDialogComponent', () => {
  let component: CatalogDeleteDialogComponent;
  let fixture: ComponentFixture<CatalogDeleteDialogComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CatalogDeleteDialogComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(CatalogDeleteDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});

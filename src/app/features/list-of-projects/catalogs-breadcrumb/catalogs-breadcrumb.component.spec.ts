import { ComponentFixture, TestBed } from '@angular/core/testing';

import { CatalogsBreadcrumbComponent } from './catalogs-breadcrumb.component';

xdescribe('CatalogsBreadcrumbComponent', () => {
  let component: CatalogsBreadcrumbComponent;
  let fixture: ComponentFixture<CatalogsBreadcrumbComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CatalogsBreadcrumbComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(CatalogsBreadcrumbComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});

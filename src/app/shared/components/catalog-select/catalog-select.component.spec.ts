import { ComponentFixture, TestBed } from '@angular/core/testing';

import { CatalogSelectComponent } from './catalog-select.component';

xdescribe('CatalogSelectComponent', () => {
  let component: CatalogSelectComponent;
  let fixture: ComponentFixture<CatalogSelectComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CatalogSelectComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(CatalogSelectComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});

import { ComponentFixture, TestBed } from '@angular/core/testing';

import { CatalogsTreeComponent } from './catalogs-tree.component';

xdescribe('CatalogsTreeComponent', () => {
  let component: CatalogsTreeComponent;
  let fixture: ComponentFixture<CatalogsTreeComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CatalogsTreeComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(CatalogsTreeComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});

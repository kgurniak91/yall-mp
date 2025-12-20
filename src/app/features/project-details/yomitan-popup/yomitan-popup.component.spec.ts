import { ComponentFixture, TestBed } from '@angular/core/testing';

import { YomitanPopupComponent } from './yomitan-popup.component';

xdescribe('YomitanPopupComponent', () => {
  let component: YomitanPopupComponent;
  let fixture: ComponentFixture<YomitanPopupComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [YomitanPopupComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(YomitanPopupComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});

import { ComponentFixture, TestBed } from '@angular/core/testing';

import { HomeRedirectComponent } from './home-redirect.component';

xdescribe('HomeRedirectComponent', () => {
  let component: HomeRedirectComponent;
  let fixture: ComponentFixture<HomeRedirectComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HomeRedirectComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(HomeRedirectComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});

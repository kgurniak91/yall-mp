import { ComponentFixture, TestBed } from '@angular/core/testing';

import { AnkiCardTemplateFormComponent } from './anki-card-template-form.component';

describe('AnkiCardTemplateFormComponent', () => {
  let component: AnkiCardTemplateFormComponent;
  let fixture: ComponentFixture<AnkiCardTemplateFormComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AnkiCardTemplateFormComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(AnkiCardTemplateFormComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});

import {BaseComponent} from 'primeng/basecomponent';
import {Drawer} from 'primeng/drawer';
import {ScrollPanel} from 'primeng/scrollpanel';

// PrimeNG 19.1 components that override ngOnDestroy without calling super leave their theme-change listener registered on
// the global ThemeService, which keeps the component and its whole view (canvases, waveform, other components) alive after
// the page is destroyed. Running the base cleanup as well is harmless for the ones that already do (it is idempotent).
const COMPONENTS_MISSING_SUPER_DESTROY = [Drawer, ScrollPanel];

for (const component of COMPONENTS_MISSING_SUPER_DESTROY) {
  const original = component.prototype.ngOnDestroy;
  component.prototype.ngOnDestroy = function (this: BaseComponent): void {
    try {
      original.call(this);
    } finally {
      BaseComponent.prototype.ngOnDestroy.call(this);
    }
  };
}

import {BaseComponent} from 'primeng/basecomponent';
import {Drawer} from 'primeng/drawer';
import {ScrollPanel} from 'primeng/scrollpanel';
import './primeng-destroy-fix';

describe('primeng destroy fix', () => {
  [Drawer, ScrollPanel].forEach(component => {
    it(`runs the base cleanup when ${component.name} is destroyed`, () => {
      const baseDestroy = spyOn(BaseComponent.prototype, 'ngOnDestroy');
      const instance = Object.create(component.prototype) as InstanceType<typeof component>;
      try {
        instance.ngOnDestroy();
      } catch {
        // the component specific cleanup needs a real instance; only the base call matters here
      }
      expect(baseDestroy).toHaveBeenCalledTimes(1);
    });
  });
});

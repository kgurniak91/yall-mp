import {ActivatedRouteSnapshot, BaseRouteReuseStrategy} from '@angular/router';

export class AppRouteReuseStrategy extends BaseRouteReuseStrategy {
  /**
   * Forces Angular to destroy the current component (running ngOnDestroy)
   * and ALWAYS instantiate a new one (running ngOnInit) whenever the route changes.
   * This is needed to refresh the project details component when navigating between previous / next files.
   */
  override shouldReuseRoute(future: ActivatedRouteSnapshot, curr: ActivatedRouteSnapshot): boolean {
    return false;
  }
}

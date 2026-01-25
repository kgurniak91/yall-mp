import {ChangeDetectionStrategy, Component, computed, input, output} from '@angular/core';
import {BreadcrumbModule} from 'primeng/breadcrumb';
import {MenuItem} from 'primeng/api';
import {ROOT_CATALOG_ID, ROOT_CATALOG_NAME} from '../../../shared/types/catalog.types';
import {Catalog} from '../../../model/project.types';

@Component({
  selector: 'app-catalogs-breadcrumb',
  standalone: true,
  imports: [BreadcrumbModule],
  templateUrl: './catalogs-breadcrumb.component.html',
  styleUrl: './catalogs-breadcrumb.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class CatalogsBreadcrumbComponent {
  public readonly activeCatalogId = input.required<string>();
  public readonly catalogs = input.required<Catalog[]>();
  public readonly selectCatalog = output<string>();

  protected readonly items = computed<MenuItem[]>(() => {
    const activeId = this.activeCatalogId();
    const allCatalogs = this.catalogs();
    const result: MenuItem[] = [];

    const isRoot = (activeId === ROOT_CATALOG_ID);
    result.push({
      icon: 'fa-solid fa-house',
      label: ROOT_CATALOG_NAME,
      command: !isRoot ? () => this.selectCatalog.emit(ROOT_CATALOG_ID) : undefined,
      styleClass: isRoot ? 'breadcrumb-current' : 'breadcrumb-link'
    });

    if (isRoot) {
      return result;
    }

    const path: MenuItem[] = [];
    let current = allCatalogs.find(c => c.id === activeId);

    while (current) {
      const id = current.id;
      const isCurrent = id === activeId;

      path.unshift({
        label: current.name,
        command: !isCurrent ? () => this.selectCatalog.emit(id) : undefined,
        styleClass: isCurrent ? 'breadcrumb-current' : 'breadcrumb-link'
      });

      if (current.parentId === ROOT_CATALOG_ID) {
        break;
      }
      current = allCatalogs.find(c => c.id === current?.parentId);
    }

    return [...result, ...path];
  });
}

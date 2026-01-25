import {ChangeDetectionStrategy, Component, computed, forwardRef, inject, signal} from '@angular/core';
import {TreeSelectModule} from 'primeng/treeselect';
import {ControlValueAccessor, FormsModule, NG_VALUE_ACCESSOR} from '@angular/forms';
import {TreeNode} from 'primeng/api';
import {AppStateService} from '../../../state/app/app-state.service';
import {ROOT_CATALOG_ID, ROOT_CATALOG_NAME} from '../../types/catalog.types';

@Component({
  selector: 'app-catalog-select',
  imports: [
    TreeSelectModule,
    FormsModule
  ],
  templateUrl: './catalog-select.component.html',
  styleUrl: './catalog-select.component.scss',
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => CatalogSelectComponent),
      multi: true
    }
  ],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class CatalogSelectComponent implements ControlValueAccessor {
  protected selectedNode = signal<TreeNode | null>(null);
  protected readonly options = computed<TreeNode[]>(() => {
    const catalogs = this.appStateService.catalogs();

    const rootNode: TreeNode = {
      key: ROOT_CATALOG_ID,
      label: ROOT_CATALOG_NAME,
      data: ROOT_CATALOG_ID,
      expanded: true,
      children: [],
      icon: 'fa-solid fa-folder',
      expandedIcon: 'fa-solid fa-folder-open',
      collapsedIcon: 'fa-solid fa-folder'
    };

    const map = new Map<string, TreeNode>();
    catalogs.forEach(c => {
      map.set(c.id, {
        key: c.id,
        label: c.name,
        data: c.id,
        children: [],
        icon: 'fa-solid fa-folder',
        expandedIcon: 'fa-solid fa-folder-open',
        collapsedIcon: 'fa-solid fa-folder'
      });
    });

    catalogs.forEach(c => {
      const node = map.get(c.id)!;
      const parentId = c.parentId;
      if (map.has(parentId)) {
        map.get(parentId)!.children!.push(node);
      } else {
        rootNode.children!.push(node);
      }
    });

    return [rootNode];
  });

  private readonly appStateService = inject(AppStateService);

  private onChange: (value: string | null) => void = () => {
  };

  private onTouched: () => void = () => {
  };

  writeValue(obj: string | null): void {
    const node = obj ? this.findNode(this.options(), obj) : null;
    this.selectedNode.set(node);
  }

  registerOnChange(fn: any): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: any): void {
    this.onTouched = fn;
  }

  onNodeChange(node: TreeNode | null): void {
    this.selectedNode.set(node);

    if (node) {
      this.onChange(node.data);
    } else {
      this.onChange(null);
    }

    this.onTouched();
  }

  private findNode(nodes: TreeNode[], id: string): TreeNode | null {
    for (const node of nodes) {
      if (node.data === id) {
        return node;
      }
      if (node.children) {
        const found = this.findNode(node.children, id);
        if (found) {
          return found;
        }
      }
    }
    return null;
  }
}

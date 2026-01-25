import {ChangeDetectionStrategy, Component, effect, inject, signal, ViewChild} from '@angular/core';
import {ConfirmationService, MenuItem, TreeDragDropService, TreeNode} from 'primeng/api';
import {ContextMenu, ContextMenuModule} from 'primeng/contextmenu';
import {TreeModule, TreeNodeContextMenuSelectEvent} from 'primeng/tree';
import {DialogService} from 'primeng/dynamicdialog';
import {CatalogFormDialogComponent, CatalogFormDialogData} from '../catalog-form-dialog/catalog-form-dialog.component';
import {v4 as uuidv4} from 'uuid';
import {AppStateService} from '../../../state/app/app-state.service';
import {ToastService} from '../../../shared/services/toast/toast.service';
import {ROOT_CATALOG_ID, ROOT_CATALOG_NAME} from '../../../shared/types/catalog.types';
import {Catalog, MinimalProject} from '../../../model/project.types';
import {
  disableFocusInParentDialog,
  scheduleRestoreFocus
} from '../../../shared/utils/disable-focus-in-parent-dialog/disable-focus-in-parent-dialog';
import {Tag} from 'primeng/tag';

@Component({
  selector: 'app-catalogs-tree',
  standalone: true,
  imports: [
    TreeModule,
    ContextMenuModule,
    Tag
  ],
  providers: [TreeDragDropService],
  templateUrl: './catalogs-tree.component.html',
  styleUrl: './catalogs-tree.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class CatalogsTreeComponent {
  @ViewChild('cm') contextMenu!: ContextMenu;
  protected readonly ROOT_CATALOG_ID = ROOT_CATALOG_ID;
  protected treeNodes = signal<TreeNode[]>([]);
  protected selectedNode = signal<TreeNode | null>(null);
  protected contextMenuItems: MenuItem[] = [];
  private readonly appStateService = inject(AppStateService);
  private readonly confirmationService = inject(ConfirmationService);
  private readonly dialogService = inject(DialogService);
  private readonly toastService = inject(ToastService);
  private expandedNodeKeys = new Set<string>();

  constructor() {
    effect(() => {
      const catalogs = this.appStateService.catalogs();
      const activeId = this.appStateService.activeCatalogId();
      const projects = this.appStateService.projects();
      this.rebuildTree(catalogs, activeId, projects);
    });
  }

  onNodeSelect(event: any) {
    const newNode = event.node;
    const previousNode = this.selectedNode();

    if (previousNode) {
      previousNode.selectable = true;
    }

    newNode.selectable = false;
    this.selectedNode.set(newNode);
    this.appStateService.setActiveCatalog(newNode.data.id);
  }

  onNodeExpand(event: any) {
    if (event.node.key) {
      this.expandedNodeKeys.add(event.node.key);
    }
  }

  onNodeCollapse(event: any) {
    if (event.node.key) {
      this.expandedNodeKeys.delete(event.node.key);
    }
  }

  onNodeDrop(event: any) {
    const dragNode = event.dragNode;
    const dropNode = event.dropNode;

    if (!dragNode || !dropNode) {
      return;
    }

    const destCatalogId: string = dropNode.data.id;
    const catalogId = dragNode.data.id;

    if (catalogId === ROOT_CATALOG_ID) {
      return;
    }

    if (catalogId === destCatalogId) {
      return;
    }

    try {
      this.appStateService.updateCatalog(catalogId, {parentId: destCatalogId});
      this.toastService.success('Catalog moved');
    } catch (e: unknown) {
      if (e instanceof Error) {
        this.toastService.error(e.message);
      }
      // Force refresh to revert visual drag state
      this.rebuildTree(this.appStateService.catalogs(), this.appStateService.activeCatalogId(), this.appStateService.projects());
    }
  }

  onNodeContextMenuSelect(event: TreeNodeContextMenuSelectEvent) {
    const node = event.node;

    if (this.selectedNode() !== node) {
      this.onNodeSelect({node});
    }

    const isRoot = node.data.id === ROOT_CATALOG_ID;
    const catalogId = node.data.id;
    const catalogName = node.label;
    const actualParentId = node.parent?.data?.id || ROOT_CATALOG_ID;

    this.contextMenuItems = [
      {
        label: 'Create Subcatalog',
        icon: 'fa-solid fa-folder-plus',
        command: () => this.openCatalogDialog('create', catalogId)
      }
    ];

    if (!isRoot) {
      this.contextMenuItems.push(
        {separator: true},
        {
          label: 'Rename',
          icon: 'fa-solid fa-pencil',
          command: () => this.openCatalogDialog('edit', actualParentId, {
            id: catalogId,
            name: catalogName!,
            parentId: actualParentId
          })
        },
        {
          label: 'Delete',
          icon: 'fa-solid fa-trash',
          styleClass: 'text-red-500',
          command: () => this.deleteCatalog(catalogId, catalogName)
        }
      );
    }
  }

  private openCatalogDialog(mode: 'create' | 'edit', parentId: string | null, catalog?: Catalog) {
    const restoreFocus = disableFocusInParentDialog();
    const effectiveParentId = parentId || ROOT_CATALOG_ID;

    const data: CatalogFormDialogData = {
      mode,
      parentId: effectiveParentId,
      catalog
    };

    const ref = this.dialogService.open(CatalogFormDialogComponent, {
      header: mode === 'create' ? 'New Catalog' : 'Rename Catalog',
      width: 'clamp(20rem, 95vw, 35rem)',
      modal: true,
      data
    });

    ref.onClose.subscribe((resultName: string | undefined) => {
      scheduleRestoreFocus(restoreFocus);

      if (!resultName) {
        return;
      }

      try {
        if (mode === 'create') {
          this.expandedNodeKeys.add(effectiveParentId);
          const newCatalog: Catalog = {
            id: uuidv4(),
            name: resultName,
            parentId: effectiveParentId
          };
          this.appStateService.createCatalog(newCatalog);
          this.toastService.success('Catalog created');
        } else if (catalog) {
          this.appStateService.updateCatalog(catalog.id, {name: resultName});
          this.toastService.success('Catalog renamed');
        }
      } catch (e: unknown) {
        if (e instanceof Error) {
          this.toastService.error(e.message);
        }
      }
    });
  }

  private deleteCatalog(id: string, name: string | undefined) {
    this.confirmationService.confirm({
      header: 'Delete Catalog',
      message: `Delete catalog "<b>${name}</b>"?<br>It must be empty to be deleted.`,
      icon: 'fa-solid fa-triangle-exclamation',
      accept: () => {
        const projects = this.appStateService.projects().filter(p => p.catalogId === id);
        const subCatalogs = this.appStateService.catalogs().filter(c => c.parentId === id);

        if (projects.length > 0 || subCatalogs.length > 0) {
          this.toastService.error('Cannot delete catalog. It is not empty.');
          return;
        }

        this.appStateService.deleteCatalog(id);
        this.toastService.success('Catalog deleted');
      }
    });
  }

  private rebuildTree(catalogs: Catalog[], activeId: string, projects: MinimalProject[]) {
    const rootId = ROOT_CATALOG_ID;
    const catalogMap = new Map<string, TreeNode>();

    // Calculate project counts per catalog
    const projectCounts = new Map<string, number>();
    projects.forEach(p => {
      const count = projectCounts.get(p.catalogId) || 0;
      projectCounts.set(p.catalogId, count + 1);
    });

    // Create root node
    const rootCount = projectCounts.get(rootId) || 0;
    const rootNode: TreeNode = {
      key: rootId,
      label: ROOT_CATALOG_NAME,
      data: {id: rootId, projectCount: rootCount},
      expanded: true,
      children: [],
      droppable: true,
      draggable: false,
      selectable: true
    };
    catalogMap.set(rootId, rootNode);

    // Create catalog nodes
    catalogs.forEach(c => {
      const projectCount = projectCounts.get(c.id) || 0;
      catalogMap.set(c.id, {
        key: c.id,
        label: c.name,
        data: {id: c.id, projectCount},
        expanded: this.expandedNodeKeys.has(c.id),
        children: [],
        droppable: true,
        draggable: true,
        selectable: true
      });
    });

    // Assemble hierarchy
    catalogs.forEach(c => {
      const node = catalogMap.get(c.id)!;
      const parent = catalogMap.get(c.parentId);

      if (parent) {
        parent.children!.push(node);
        node.parent = parent;
      } else {
        console.warn(`Orphaned catalog found: ${c.name} (${c.id}). Attaching to Root.`);
        rootNode.children!.push(node);
        node.parent = rootNode;
      }
    });

    // Force selection
    const nodes = [rootNode];
    const nodeToSelect = this.findNodeByKey(nodes, activeId);

    if (nodeToSelect) {
      nodeToSelect.selectable = false; // Lock the active node
      this.expandNodeParents(nodeToSelect); // Ensure path is visible
      this.selectedNode.set(nodeToSelect);
    } else {
      // Fallback to root if active ID not found (e.g., deleted)
      rootNode.selectable = false;
      this.selectedNode.set(rootNode);
    }

    this.treeNodes.set(nodes);
  }

  private findNodeByKey(nodes: TreeNode[], key: string): TreeNode | null {
    for (const node of nodes) {
      if (node.key === key) {
        return node;
      }
      if (node.children) {
        const found = this.findNodeByKey(node.children, key);
        if (found) {
          return found;
        }
      }
    }
    return null;
  }

  private expandNodeParents(node: TreeNode) {
    let current = node.parent;
    while (current) {
      current.expanded = true;
      if (current.key) {
        this.expandedNodeKeys.add(current.key);
      }
      current = current.parent;
    }
  }
}

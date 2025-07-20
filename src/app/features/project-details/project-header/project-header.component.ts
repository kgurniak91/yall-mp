import {Component, input, output} from '@angular/core';
import {MenuItem, PrimeTemplate} from 'primeng/api';
import {Button} from 'primeng/button';
import {Menu} from 'primeng/menu';
import {Tooltip} from 'primeng/tooltip';
import {Toolbar} from 'primeng/toolbar';

@Component({
  selector: 'app-project-header',
  imports: [
    PrimeTemplate,
    Button,
    Menu,
    Tooltip,
    Toolbar
  ],
  templateUrl: './project-header.component.html',
  styleUrl: './project-header.component.scss'
})
export class ProjectHeaderComponent {
  mediaFileName = input<string | null>(null);
  subtitleFileName = input<string | null>(null);
  newProjectClicked = output<void>();
  editProjectClicked = output<void>();
  goToProjectsListClicked = output<void>();
  deleteProjectClicked = output<void>();
  helpClicked = output<void>();
  globalSettingsClicked = output<void>();

  readonly projectMenuItems: MenuItem[] = [
    {
      label: 'Create new project',
      icon: 'fa-solid fa-plus',
      command: () => this.newProjectClicked.emit()
    },
    {
      label: 'Edit current project',
      icon: 'fa-solid fa-pencil',
      command: () => this.editProjectClicked.emit()
    },
    {
      label: 'List of projects',
      icon: 'fa-solid fa-list',
      command: () => this.goToProjectsListClicked.emit()
    },
    {
      label: 'Help & Shortcuts',
      icon: 'fa-solid fa-circle-question',
      command: () => this.helpClicked.emit()
    },
    {
      label: 'Global settings',
      icon: 'fa-solid fa-gear',
      command: () => this.globalSettingsClicked.emit()
    },
    {
      separator: true
    },
    {
      label: 'Delete current project',
      icon: 'fa-solid fa-trash',
      command: () => this.deleteProjectClicked.emit(),
      styleClass: 'p-menuitem-danger' // Custom class for styling
    }
  ];
}

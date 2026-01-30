import {ChangeDetectionStrategy, Component, computed, input, OnInit, output, signal} from '@angular/core';
import {MinimalProject} from '../../../model/project.types';
import {Button} from 'primeng/button';
import {DatePipe, DecimalPipe} from '@angular/common';
import {ProgressBar} from 'primeng/progressbar';
import {MenuItem} from 'primeng/api';
import {Menu} from 'primeng/menu';

@Component({
  selector: 'app-project-list-item',
  imports: [
    Button,
    DatePipe,
    ProgressBar,
    DecimalPipe,
    Menu
  ],
  templateUrl: './project-list-item.component.html',
  styleUrl: './project-list-item.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ProjectListItemComponent implements OnInit {
  public readonly project = input.required<MinimalProject>();
  public readonly selectProject = output<void>();
  public readonly editProject = output<void>();
  public readonly removeProject = output<void>();
  public readonly moveProject = output<void>();
  protected readonly menuItems = signal<MenuItem[]>([]);

  protected readonly completionPercentage = computed(() => {
    const project = this.project();

    if (!project.duration || project.subtitleCount === 0) {
      return 0;
    }

    if (project.lastPlaybackTime >= project.lastSubtitleEndTime) {
      return 100;
    }

    return (project.lastPlaybackTime / project.duration) * 100;
  });

  protected readonly createdDate = computed(() => new Date(this.project().createdDate));
  protected readonly lastOpenedDate = computed(() => new Date(this.project().lastOpenedDate));

  ngOnInit() {
    const menuItems = [
      {
        label: 'Change catalog',
        icon: 'fa-solid fa-folder-open',
        command: () => this.moveProject.emit()
      },
      {
        label: 'Edit project',
        icon: 'fa-solid fa-pencil',
        command: () => this.editProject.emit()
      },
      {separator: true},
      {
        label: 'Delete',
        icon: 'fa-solid fa-trash',
        styleClass: 'text-red-500',
        command: () => this.removeProject.emit()
      }
    ];

    this.menuItems.set(menuItems);
  }

  protected onCardClick(event: MouseEvent): void {
    const target = event.target as HTMLElement;
    if (target.closest('.project-actions') || target.closest('.p-menu')) {
      return;
    }
    this.selectProject.emit();
  }
}

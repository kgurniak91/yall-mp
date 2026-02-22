import {Confirmation} from 'primeng/api';

export const DEFAULT_CONFIRMATION: Confirmation = {
  icon: 'fa-solid fa-circle-exclamation',
  rejectButtonStyleClass: 'p-button-secondary',
  acceptLabel: 'Yes',
  rejectLabel: 'No',
  closeOnEscape: true,
  closable: true,
  accept: () => {},
  reject: () => {}
};

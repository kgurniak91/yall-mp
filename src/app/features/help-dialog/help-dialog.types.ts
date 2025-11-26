export interface OpenSourceLicense {
  name: string;
  licenses: string | string[];
  repository?: string;
  publisher?: string;
  licenseText?: string;
  notice?: string;
}

export enum HelpDialogTab {
  About,
  KeyboardShortcuts,
  ThirdPartyLicenses
}

/** Opaque handle issued by the native folder chooser. */
export interface CodeProject {
  id: string;
  name: string;
}

export interface ProjectScan {
  name: string;
  context: string;
  filesFound: number;
  filesRead: number;
  filesIncluded: number;
  limited: boolean;
  warnings: string[];
  paths: string[];
}

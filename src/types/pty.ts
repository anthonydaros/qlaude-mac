export interface PtyWrapperEvents {
  data: (data: string) => void;
  exit: (exitCode: number, signal?: number) => void;
}

export interface CompensationFieldPointer {
  from: "request" | "response";
  pointer: string;
}

export type CompensationMap = Record<string, CompensationFieldPointer>;

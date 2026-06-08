import { customType } from "drizzle-orm/pg-core";

/**
 * pgvector `vector(n)` column type. drizzle-orm has no native pgvector support,
 * so we map it as a custom type — stored/read as a JS number[] via pgvector's
 * text representation `[0.1,0.2,...]`.
 */
export const vector = (dimensions: number) =>
  customType<{ data: number[]; driverData: string }>({
    dataType() {
      return `vector(${dimensions})`;
    },
    toDriver(value: number[]): string {
      return `[${value.join(",")}]`;
    },
    fromDriver(value: string): number[] {
      return value
        .slice(1, -1)
        .split(",")
        .filter(Boolean)
        .map(Number);
    },
  });

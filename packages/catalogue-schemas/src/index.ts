export * from "./types";
export { ghs } from "./ghs";
export { gtl } from "./gtl";
export { gpa } from "./gpa";

import { ghs } from "./ghs";
import { gpa } from "./gpa";
import { gtl } from "./gtl";
import type { ProductTypeSeed } from "./types";

export const seedProductTypes: readonly ProductTypeSeed[] = [ghs, gtl, gpa];

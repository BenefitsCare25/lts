/**
 * Types shared across apps and the future employee portal.
 *
 * Phase 1 puts a small, stable surface here. Most types should live in their
 * domain module under `apps/web/src/server/...` until they actually need to
 * be shared across packages.
 */

export type Brand<T, B extends string> = T & { readonly __brand: B };

export type AgencyId = Brand<string, "AgencyId">;
export type UserId = Brand<string, "UserId">;
export type ClientId = Brand<string, "ClientId">;
export type PolicyId = Brand<string, "PolicyId">;
export type PolicyVersionId = Brand<string, "PolicyVersionId">;
export type ProductTypeId = Brand<string, "ProductTypeId">;
export type ProductTypeVersionId = Brand<string, "ProductTypeVersionId">;
export type ProductId = Brand<string, "ProductId">;

export type CoverageOption = "EO" | "ES" | "EC" | "EF";

export type VersionStatus = "draft" | "published" | "superseded";

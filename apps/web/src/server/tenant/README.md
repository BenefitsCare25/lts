# server/tenant

Tenant scoping. Lands in **S4**:
- `requireAgencyContext()` returns an agency-scoped Prisma client
- middleware that rejects queries without an `agency_id` filter on tenant tables
- `__requireServiceContext()` for explicit cross-tenant reads (with audit)

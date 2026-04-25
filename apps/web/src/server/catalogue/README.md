# server/catalogue

Product type catalogue logic. Lands in **S9–S12**:
- `CatalogueValidator`: Ajv wrapper that loads + caches schemas per `ProductTypeVersion`
- ProductType CRUD + versioning server actions
- Schema rendering helpers for the admin UI

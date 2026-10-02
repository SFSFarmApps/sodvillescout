# Sodville Command Database v1

This branch is intentionally separate from the production Field Scout build.

## System of record
Sodville Farm Services, Inc. is the umbrella organization. Operational hierarchy:
**Sodville Farm Services, Inc. → Client → Farm → Field**.

Landowners are relationships to fields/farms rather than parents in the operational hierarchy.

## Technology
- PostgreSQL
- PostGIS for field boundaries, points, tracks, soils and spatial queries
- UUID primary keys internally
- Human-readable `command_code` identifiers for core master records
- External-ID mapping for John Deere Operations Center, FSA and future integrations
- Dropbox/file storage referenced by persistent provider file IDs; Command stores metadata and relationships

## Migration sequence
1. Provision managed Postgres/PostGIS.
2. Run `001_sodville_command_schema.sql`.
3. Extract the current Field Scout Client → Farm → Field hierarchy and all 120 polygons.
4. Generate permanent Command IDs and migration crosswalk.
5. Import rainfall history without changing the production app.
6. Add a read-only Command API and compare its output against Build 1002-31.
7. Only after parity is verified, switch Field Scout reads to Command.
8. Migrate scouting observations/tasks/pins next.
9. Add employee, documents, equipment, financial and landowner modules incrementally.

## Safety rule
Build 1002-31 remains the production baseline until the new backend passes field-count, geometry, hierarchy and rainfall parity checks.

## Initial hosting recommendation
Use a managed PostgreSQL platform with PostGIS, authentication, storage and API support. Supabase is a strong fit for v1 because it provides managed Postgres, PostGIS support, authentication/storage capabilities and a straightforward path for web/mobile clients. Hosting is not provisioned by this branch; account ownership and billing should remain with Sodville.

# server/ingestion

Excel placement-slip parser. Lands in **S17–S20**:
- file upload handler (streams to Azure Blob)
- template-driven parser (`exceljs`)
- review/commit pipeline
- BullMQ worker definitions
